//! Loop over the MMs and get their quotes and return them in the return data for the UI
//!
//! Accounts: **2 + 5 × N** (`N` ≤ MAX_NUMBER_OF_MMS_PROXY).
//!
//! **Fixed (2)**
//! 0. `user` (readonly)
//! 1. `clock_sysvar` (readonly)
//!
//! **Per MM (5 each)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (readonly)
//! 2. `mm_event_state_pda` (readonly)
//! 3. `mm_market_data_pda` (readonly)
//! 4. `mm_quote_buffer` (writable)
//!
//! Data (after router discriminator): [`FillBetIxData`] (`bet_id` is decoded but unused).

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, ProgramResult,
   cpi::invoke,
   error::ProgramError,
   instruction::{InstructionAccount, InstructionView},
};

use pinocchio_log::log;
use crate::{
   constants::MAX_NUMBER_OF_MMS_PROXY,
   errors::SpammError,
   helpers::{
      set_proxy_return_data, verify_clock_sysvar, verify_event_state, verify_mm_config_pda,
      verify_mm_market_data_pda, verify_mm_program_executable, verify_quote_buffer,
      parse_quote_return_for_mm,
      reject_duplicate_mm_programs,
   },
   state::{
      FillBetIxData, GET_QUOTE_IX_DISCRIMINATOR, GetQuoteIxData, MarketId, EventGameState,
      event_id_wire_from_market_wire, mm_quote::{ProxyQuoteData},
   },
};

const MM_ACCOUNTS_PER_MM: usize = 5;

pub const GET_QUOTE_PROXY_IX_DISCRIMINATOR: u8 = 30;

/// Pack `GetQuoteIxData` once; callers reuse the buffer and patch `side` as needed.
#[inline(always)]
pub(crate) fn write_get_quote_ix_buf(
   buf: &mut [u8; GetQuoteIxData::WIRE_LEN],
   amount: u64,
   min_odds_scaled: u32,
   market_id: MarketId,
   side: u8,
   event_game_state: EventGameState,
   event_state_sequence: u16,
) -> bool {
   GetQuoteIxData {
      instruction_discriminator: GET_QUOTE_IX_DISCRIMINATOR,
      amount,
      odds_scaled: min_odds_scaled,
      market_id,
      side,
      event_game_state,
      event_state_sequence,
   }
   .write_wire(buf)
   .is_ok()
}

/// CPI `get_quote` for one MM from a pre-packed ix buffer. Caller already verified accounts.
#[inline(never)]
pub(crate) fn cpi_get_quote_for_proxy(
   user: &AccountView,
   clock_sysvar: &AccountView,
   mm_program_account: &AccountView,
   mm_config_pda: &AccountView,
   mm_event_state_pda: &AccountView,
   mm_market_data_pda: &AccountView,
   mm_quote_buffer: &AccountView,
   get_quote_ix_buf: &[u8],
) -> Option<(u64, u32)> {
   let get_quote_ix_accounts = [
      InstructionAccount::new(user.address(), false, false),
      InstructionAccount::new(clock_sysvar.address(), false, false),
      InstructionAccount::new(mm_market_data_pda.address(), false, false),
      InstructionAccount::new(mm_event_state_pda.address(), false, false),
      InstructionAccount::new(mm_config_pda.address(), false, false),
      InstructionAccount::new(mm_quote_buffer.address(), true, false),
   ];
   let get_quote_ix = InstructionView {
      program_id: mm_program_account.address(),
      accounts: &get_quote_ix_accounts,
      data: get_quote_ix_buf,
   };
   if invoke(
      &get_quote_ix,
      &[
         user.as_ref(),
         clock_sysvar.as_ref(),
         mm_market_data_pda.as_ref(),
         mm_event_state_pda.as_ref(),
         mm_config_pda.as_ref(),
         mm_quote_buffer.as_ref(),
      ],
   )
   .is_err()
   {
      return None;
   }

   let mut max_amount = 0;
   let mut odds_scaled = 0;
   if let Some(parsed) = parse_quote_return_for_mm(mm_program_account) {
      (max_amount, odds_scaled) = parsed;
   }
   if max_amount == 0 {
      return None;
   }
   Some((max_amount, odds_scaled))
}

#[inline(never)]
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      clock_sysvar,
      mm_accounts @ ..,
   ] = accounts else {
      log!("get_quote_proxy: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_clock_sysvar(clock_sysvar)?;

   if mm_accounts.len() < MM_ACCOUNTS_PER_MM || mm_accounts.len() % MM_ACCOUNTS_PER_MM != 0 {
      log!("get_quote_proxy: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parsed_data = FillBetIxData::decode(data)?;
   let amount = parsed_data.amount;
   let min_odds_scaled = parsed_data.min_odds_scaled;
   let market_id = parsed_data.market_id;
   let side = parsed_data.side;
   let event_game_state = parsed_data.event_game_state;
   let event_state_sequence = parsed_data.event_state_sequence;

   let number_of_mms = mm_accounts.len() / MM_ACCOUNTS_PER_MM;
   if number_of_mms > MAX_NUMBER_OF_MMS_PROXY {
      log!("get_quote_proxy: too many mm accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   reject_duplicate_mm_programs(mm_accounts, MM_ACCOUNTS_PER_MM)?;

   let market_wire = market_id.as_bytes();
   let event_id_wire = event_id_wire_from_market_wire(&market_wire);

   let mut get_quote_ix_buf = [0u8; GetQuoteIxData::WIRE_LEN];
   if !write_get_quote_ix_buf(
      &mut get_quote_ix_buf,
      amount,
      min_odds_scaled,
      market_id,
      side,
      event_game_state,
      event_state_sequence,
   ) {
      return Err(ProgramError::InvalidInstructionData);
   }

   let mut mm_quotes = [const { MaybeUninit::<ProxyQuoteData>::uninit() }; MAX_NUMBER_OF_MMS_PROXY];
   let mut valid_quote_count = 0usize;

   for i in 0..number_of_mms {
      let base = i * MM_ACCOUNTS_PER_MM;
      let mm_program_account = &mm_accounts[base];
      let mm_config_pda = &mm_accounts[base + 1];
      let mm_event_state_pda = &mm_accounts[base + 2];
      let mm_market_data_pda = &mm_accounts[base + 3];
      let mm_quote_buffer = &mm_accounts[base + 4];

      if verify_mm_program_executable(mm_program_account).is_err() {
         continue;
      }

      if !verify_mm_config_pda(mm_config_pda, mm_program_account) {
         continue;
      }
      if !verify_quote_buffer(mm_quote_buffer, mm_program_account) {
         continue;
      }
      if !verify_mm_market_data_pda(mm_market_data_pda, mm_program_account, &market_wire) {
         continue;
      }
      if !verify_event_state(
         mm_event_state_pda,
         mm_program_account,
         event_id_wire,
         &event_game_state,
         event_state_sequence,
      ) {
         continue;
      }

      let Some((max_amount, odds_scaled)) = cpi_get_quote_for_proxy(
         user,
         clock_sysvar,
         mm_program_account,
         mm_config_pda,
         mm_event_state_pda,
         mm_market_data_pda,
         mm_quote_buffer,
         &get_quote_ix_buf,
      ) else {
         continue;
      };

      if valid_quote_count >= MAX_NUMBER_OF_MMS_PROXY {
         break;
      }

      mm_quotes[valid_quote_count].write(ProxyQuoteData {
         max_amount,
         odds_scaled,
         mm_address: *mm_program_account.address(),
      });
      valid_quote_count += 1;
   }

   if valid_quote_count == 0 {
      log!("get_quote_proxy: no valid quotes");
      return Err(SpammError::NoQuotesAvailable.into());
   }

   set_proxy_return_data(&mm_quotes, valid_quote_count);
   Ok(())
}

