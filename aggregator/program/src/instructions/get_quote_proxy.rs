//! Loop over the MMs and get their quotes and return them in the return data for the UI
//!
//! Accounts: **1 + 5 × N** (`N` = number of market makers, `N` ≤ [`MAX_NUMBER_OF_MMS_PROXY`]).
//!
//! **Fixed (1)**
//! 0. `user` (readonly)
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
   AccountView, ProgramResult, address::address_eq,
   cpi::invoke,
   error::ProgramError,
   instruction::{InstructionAccount, InstructionView},
};

use pinocchio_log::log;
use pinocchio_system::ID as SYSTEM_ID;
use crate::{
   constants::MAX_NUMBER_OF_MMS_PROXY,
   helpers::{
      set_proxy_return_data, verify_event_state, verify_mm_config_pda, verify_mm_market_data_pda,
      verify_quote_buffer,
   },
   instructions::fill_helpers::parse_quote_return_for_mm,
   parsers::parse_fill_bet_data,
   state::{
      GET_QUOTE_IX_DISCRIMINATOR, GetQuoteIxData, MarketId, EventGameState,
      mm_quote::{ProxyQuoteData},
   },
};

const MM_ACCOUNTS_PER_MM: usize = 5;

pub const GET_QUOTE_PROXY_IX_DISCRIMINATOR: u8 = 8;

/// CPI `get_quote` for one MM; ix buffers live only in this frame.
#[inline(never)]
fn cpi_get_quote_for_proxy(
   user: &AccountView,
   mm_program_account: &AccountView,
   mm_config_pda: &AccountView,
   mm_event_state_pda: &AccountView,
   mm_market_data_pda: &AccountView,
   mm_quote_buffer: &AccountView,
   amount: u64,
   min_odds_scaled: u32,
   market_id: MarketId,
   side: u8,
   event_game_state: EventGameState,
   event_state_sequence: u16,
) -> Option<(u64, u32)> {
   if !verify_mm_config_pda(mm_config_pda, mm_program_account) {
      return None;
   }
   if !verify_quote_buffer(mm_quote_buffer, mm_program_account) {
      return None;
   }
   if !verify_mm_market_data_pda(mm_market_data_pda, mm_program_account, &market_id) {
      return None;
   }
   if !verify_event_state(
      mm_event_state_pda,
      mm_program_account,
      &market_id.event_id,
      &event_game_state,
      &event_state_sequence,
   ) {
      return None;
   }

   let get_quote_ix_data = GetQuoteIxData {
      instruction_discriminator: GET_QUOTE_IX_DISCRIMINATOR,
      amount,
      odds_scaled: min_odds_scaled,
      market_id,
      side,
      event_game_state,
      event_state_sequence,
   };

   let mut get_quote_ix_buf = [0u8; GetQuoteIxData::WIRE_LEN];
   if get_quote_ix_data.write_wire(&mut get_quote_ix_buf).is_err() {
      return None;
   }
   let get_quote_ix_accounts = [
      InstructionAccount::new(user.address(), false, false),
      InstructionAccount::new(mm_market_data_pda.address(), false, false),
      InstructionAccount::new(mm_event_state_pda.address(), false, false),
      InstructionAccount::new(mm_config_pda.address(), false, false),
      InstructionAccount::new(mm_quote_buffer.address(), true, false),
   ];
   let get_quote_ix = InstructionView {
      program_id: mm_program_account.address(),
      accounts: &get_quote_ix_accounts,
      data: &get_quote_ix_buf,
   };
   if invoke(
      &get_quote_ix,
      &[
         user.as_ref(),
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
   if max_amount == 0 && odds_scaled == 0 {
      return None;
   }
   Some((max_amount, odds_scaled))
}

#[inline(never)]
pub fn get_quote_proxy(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      mm_accounts @ ..,
   ] = accounts else {
      log!("get_quote_proxy: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if mm_accounts.len() < MM_ACCOUNTS_PER_MM || mm_accounts.len() % MM_ACCOUNTS_PER_MM != 0 {
      log!("get_quote_proxy: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parsed_data = parse_fill_bet_data(data)?;
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

   let mut mm_quotes = [const { MaybeUninit::<ProxyQuoteData>::uninit() }; MAX_NUMBER_OF_MMS_PROXY];
   let mut valid_quote_count = 0usize;
   let mut previous_mms = [&SYSTEM_ID; MAX_NUMBER_OF_MMS_PROXY];

   for i in 0..number_of_mms {
      let base = i * MM_ACCOUNTS_PER_MM;
      let mm_program_account = &mm_accounts[base];
      let mm_config_pda = &mm_accounts[base + 1];
      let mm_event_state_pda = &mm_accounts[base + 2];
      let mm_market_data_pda = &mm_accounts[base + 3];
      let mm_quote_buffer = &mm_accounts[base + 4];

      if previous_mms[..i]
         .iter()
         .any(|prev| address_eq(mm_program_account.address(), *prev))
      {
         log!("get_quote_proxy: duplicate mm program account");
         return Err(ProgramError::InvalidInstructionData);
      }
      previous_mms[i] = mm_program_account.address();

      let Some((max_amount, odds_scaled)) = cpi_get_quote_for_proxy(
         user,
         mm_program_account,
         mm_config_pda,
         mm_event_state_pda,
         mm_market_data_pda,
         mm_quote_buffer,
         amount,
         min_odds_scaled,
         market_id,
         side,
         event_game_state,
         event_state_sequence,
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
      return Err(ProgramError::InvalidInstructionData);
   }

   set_proxy_return_data(mm_quotes, valid_quote_count);
   Ok(())
}
