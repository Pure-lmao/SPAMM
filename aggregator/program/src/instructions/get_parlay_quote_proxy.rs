//! Loop over MMs, CPI `get_quote_parlay` for each, return [`ProxyQuoteData`] slice in return data.
//!
//! Accounts: **1 + (3 + 2 × L) × N** (`L` = `num_legs`, `N` = number of market makers).
//!
//! **Fixed (1)**
//! 0. `user` (readonly)
//!
//! **Per MM (3 + 2 × L)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (readonly)
//! 2. `mm_parlay_quote_buffer` (writable)
//! 3+2*i. `mm_market_data_pda`, `mm_event_state_pda` per leg *i*
//!
//! Data (after router discriminator): [`FillParlayIxData`] — same wire as `fill_parlay`
//! (`bet_id` is decoded but unused).

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, ProgramResult,
   cpi::invoke,
   error::ProgramError,
   instruction::{InstructionAccount, InstructionView},
};

use pinocchio_log::log;

use crate::{
   constants::{MAX_NUMBER_OF_MMS_PROXY, MAX_PARLAY_LEGS, MAX_PARLAY_QUOTE_CPI_ACCOUNTS},
   helpers::{
      set_proxy_return_data, verify_event_state, verify_mm_config_pda, verify_mm_market_data_pda,
      verify_parlay_quote_buffer,
   },
   instructions::fill_helpers::parse_quote_return_for_mm,
   parsers::parse_fill_parlay_data,
   state::{
      GET_QUOTE_PARLAY_IX_DISCRIMINATOR, GetQuoteParlayIxData, ParlayLegTable,
      mm_quote::ProxyQuoteData,
   },
};

const MM_PARLAY_PROXY_FIXED_ACCOUNTS: usize = 3;

pub const GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR: u8 = 9;

#[inline(always)]
fn mm_accounts_per_mm(num_legs: usize) -> usize {
   MM_PARLAY_PROXY_FIXED_ACCOUNTS + 2 * num_legs
}

/// CPI `get_quote_parlay` for one MM (quote-only validations; large buffers live only in this frame).
#[inline(never)]
fn cpi_get_quote_parlay_for_proxy(
   num_legs: usize,
   amount: u64,
   min_odds_scaled: u32,
   legs: ParlayLegTable,
   user: &AccountView,
   mm_program_account: &AccountView,
   mm_config_pda: &AccountView,
   mm_parlay_quote_buffer: &AccountView,
   leg_accounts: &[AccountView],
) -> Option<(u64, u32)> {
   if !verify_mm_config_pda(mm_config_pda, mm_program_account) {
      #[cfg(feature = "log")]
      log!("get_parlay_quote_proxy: invalid mm config pda");
      return None;
   }

   if !verify_parlay_quote_buffer(mm_parlay_quote_buffer, mm_program_account) {
      #[cfg(feature = "log")]
      log!("get_parlay_quote_proxy: invalid parlay quote buffer");
      return None;
   }

   let get_quote_ix_data = GetQuoteParlayIxData {
      instruction_discriminator: GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
      amount,
      odds_scaled: min_odds_scaled,
      num_legs: num_legs as u8,
      legs,
   };

   let mut get_quote_ix_buf = [0u8; GetQuoteParlayIxData::WIRE_LEN];
   if get_quote_ix_data.write_wire(&mut get_quote_ix_buf).is_err() {
      #[cfg(feature = "log")]
      log!("get_parlay_quote_proxy: invalid get quote parlay ix data");
      return None;
   }

   let mut maybe_metas: [MaybeUninit<InstructionAccount>; MAX_PARLAY_QUOTE_CPI_ACCOUNTS] = unsafe {
      MaybeUninit::uninit().assume_init()
   };
   maybe_metas[0].write(InstructionAccount::new(user.address(), false, false));
   maybe_metas[1].write(InstructionAccount::new(mm_config_pda.address(), false, false));
   maybe_metas[2].write(InstructionAccount::new(mm_parlay_quote_buffer.address(), true, false));

   for (leg_i, leg_pair) in leg_accounts.chunks_exact(2).enumerate().take(num_legs) {
      let market_data_pda = &leg_pair[0];
      let event_state_pda = &leg_pair[1];
      let md_index = 3 + leg_i * 2;
      let es_index = 4 + leg_i * 2;
      let Some(leg) = legs.get(leg_i) else {
         return None;
      };
      let market_id = &leg.market_id;
      if !verify_mm_market_data_pda(market_data_pda, mm_program_account, market_id) {
         #[cfg(feature = "log")]
         log!("get_parlay_quote_proxy: invalid market data pda");
         return None;
      }
      if !verify_event_state(
         event_state_pda,
         mm_program_account,
         &market_id.event_id,
         &leg.event_game_state,
         &leg.event_state_sequence,
      ) {
         #[cfg(feature = "log")]
         log!("get_parlay_quote_proxy: invalid event state");
         return None;
      }

      maybe_metas[md_index].write(InstructionAccount::new(market_data_pda.address(), false, false));
      maybe_metas[es_index].write(InstructionAccount::new(event_state_pda.address(), false, false));
   }

   let number_of_accounts: usize = 3 + 2 * num_legs;
   let metas_slice: &[InstructionAccount] = unsafe {
      core::slice::from_raw_parts(
         maybe_metas.as_ptr().cast::<InstructionAccount>(),
         number_of_accounts,
      )
   };
   let ix = InstructionView {
      program_id: mm_program_account.address(),
      accounts: metas_slice,
      data: &get_quote_ix_buf,
   };

   let invoke_ok = match num_legs {
      2 => invoke(
         &ix,
         &[
            user.as_ref(),
            mm_config_pda.as_ref(),
            mm_parlay_quote_buffer.as_ref(),
            leg_accounts[0].as_ref(),
            leg_accounts[1].as_ref(),
            leg_accounts[2].as_ref(),
            leg_accounts[3].as_ref(),
         ],
      )
      .is_ok(),
      3 => invoke(
         &ix,
         &[
            user.as_ref(),
            mm_config_pda.as_ref(),
            mm_parlay_quote_buffer.as_ref(),
            leg_accounts[0].as_ref(),
            leg_accounts[1].as_ref(),
            leg_accounts[2].as_ref(),
            leg_accounts[3].as_ref(),
            leg_accounts[4].as_ref(),
            leg_accounts[5].as_ref(),
         ],
      )
      .is_ok(),
      4 => invoke(
         &ix,
         &[
            user.as_ref(),
            mm_config_pda.as_ref(),
            mm_parlay_quote_buffer.as_ref(),
            leg_accounts[0].as_ref(),
            leg_accounts[1].as_ref(),
            leg_accounts[2].as_ref(),
            leg_accounts[3].as_ref(),
            leg_accounts[4].as_ref(),
            leg_accounts[5].as_ref(),
            leg_accounts[6].as_ref(),
            leg_accounts[7].as_ref(),
         ],
      )
      .is_ok(),
      5 => invoke(
         &ix,
         &[
            user.as_ref(),
            mm_config_pda.as_ref(),
            mm_parlay_quote_buffer.as_ref(),
            leg_accounts[0].as_ref(),
            leg_accounts[1].as_ref(),
            leg_accounts[2].as_ref(),
            leg_accounts[3].as_ref(),
            leg_accounts[4].as_ref(),
            leg_accounts[5].as_ref(),
            leg_accounts[6].as_ref(),
            leg_accounts[7].as_ref(),
            leg_accounts[8].as_ref(),
            leg_accounts[9].as_ref(),
         ],
      )
      .is_ok(),
      _ => false,
   };
   if !invoke_ok {
      #[cfg(feature = "log")]
      log!("get_parlay_quote_proxy: failed to invoke get quote parlay ix");
      return None;
   }

   let mut max_amount = 0u64;
   let mut odds_scaled = 0u32;
   if let Some(parsed_ret) = parse_quote_return_for_mm(mm_program_account) {
      (max_amount, odds_scaled) = parsed_ret;
   }

   #[cfg(feature = "log")]
   log!(
      "get_parlay_quote_proxy: max_amount: {}, odds_scaled: {}",
      max_amount,
      odds_scaled
   );

   if max_amount == 0 && odds_scaled == 0 {
      return None;
   }

   Some((max_amount, odds_scaled))
}

#[inline(never)]
pub fn get_parlay_quote_proxy(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      mm_accounts @ ..,
   ] = accounts else {
      log!("get_parlay_quote_proxy: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parsed = parse_fill_parlay_data(data)?;
   let amount = parsed.amount;
   let min_odds_scaled = parsed.min_odds_scaled;
   let num_legs = parsed.num_legs as usize;
   let legs = parsed.legs;

   if num_legs > MAX_PARLAY_LEGS {
      log!("get_parlay_quote_proxy: too many legs");
      return Err(ProgramError::InvalidInstructionData);
   }

   let accounts_per_mm = mm_accounts_per_mm(num_legs);
   if mm_accounts.len() < accounts_per_mm || mm_accounts.len() % accounts_per_mm != 0 {
      log!("get_parlay_quote_proxy: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   }

   let number_of_mms = mm_accounts.len() / accounts_per_mm;
   if number_of_mms > MAX_NUMBER_OF_MMS_PROXY {
      log!("get_parlay_quote_proxy: too many mm accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   }

   let mut mm_quotes = [const { MaybeUninit::<ProxyQuoteData>::uninit() }; MAX_NUMBER_OF_MMS_PROXY];
   let mut valid_quote_count = 0usize;

   for i in 0..number_of_mms {
      let base = i * accounts_per_mm;
      let mm_program_account = &mm_accounts[base];
      let mm_config_pda = &mm_accounts[base + 1];
      let mm_parlay_quote_buffer = &mm_accounts[base + 2];
      let leg_accounts = &mm_accounts[base + MM_PARLAY_PROXY_FIXED_ACCOUNTS..base + accounts_per_mm];

      let Some((max_amount, odds_scaled)) = cpi_get_quote_parlay_for_proxy(
         num_legs,
         amount,
         min_odds_scaled,
         legs,
         user,
         mm_program_account,
         mm_config_pda,
         mm_parlay_quote_buffer,
         leg_accounts,
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
      log!("get_parlay_quote_proxy: no valid quotes");
      return Err(ProgramError::InvalidInstructionData);
   }

   set_proxy_return_data(mm_quotes, valid_quote_count);
   Ok(())
}
