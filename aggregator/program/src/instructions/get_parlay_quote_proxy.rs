//! Loop over MMs, CPI `get_quote_parlay` for each, return [`ProxyParlayQuoteData`] slice in return data.
//!
//! Accounts: **2 + (3 + 2 × L) × N** (`L` = `num_legs`, `N` = number of market makers).
//!
//! **Fixed (2)**
//! 0. `user` (readonly)
//! 1. `clock_sysvar` (readonly)
//!
//! **Per MM (3 + 2 × L)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (readonly)
//! 2. `mm_parlay_quote_buffer` (writable)
//! 3+2*i. `mm_market_data_pda` (readonly), `mm_event_state_pda` (readonly) per leg *i*
//!
//! Data (after router discriminator): [`FillParlayIxData`] — same wire as `fill_parlay`
//! (`bet_id` is decoded but unused).

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, ProgramResult,
   error::ProgramError,
};

use pinocchio_log::log;

use crate::{
   constants::{MAX_NUMBER_OF_MMS_PROXY, MAX_PARLAY_LEGS},
   errors::SpammError,
   helpers::{
      set_proxy_parlay_return_data, verify_clock_sysvar, verify_mm_config_pda,
      verify_mm_program_executable, verify_parlay_quote_buffer,
      fill_helpers::{invoke_mm_get_quote_parlay, parse_parlay_quote_return_for_mm},
      reject_duplicate_mm_programs,
   },
   state::{
      FillParlayIxData, ParlayLegSel,
      mm_quote::ProxyParlayQuoteData,
   },
};

const MM_PARLAY_PROXY_FIXED_ACCOUNTS: usize = 3;

pub const GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR: u8 = 31;

#[inline(always)]
fn mm_accounts_per_mm(num_legs: usize) -> usize {
   MM_PARLAY_PROXY_FIXED_ACCOUNTS + 2 * num_legs
}

/// Build wire + metas and CPI `get_quote_parlay` (large buffers stay in this frame only).
#[inline(never)]
fn invoke_get_quote_parlay_proxy(
   num_legs: usize,
   amount: u64,
   min_odds_scaled: u32,
   legs: &[ParlayLegSel],
   user: &AccountView,
   clock_sysvar: &AccountView,
   mm_program_account: &AccountView,
   mm_config_pda: &AccountView,
   mm_parlay_quote_buffer: &AccountView,
   leg_accounts: &[AccountView],
) -> bool {
   invoke_mm_get_quote_parlay(
      num_legs,
      amount,
      min_odds_scaled,
      legs,
      user,
      clock_sysvar,
      mm_program_account,
      mm_config_pda,
      mm_parlay_quote_buffer,
      leg_accounts,
   )
}

/// Validate MM accounts, CPI get-quote, parse return into `leg_odds_out`.
#[inline(never)]
fn cpi_get_quote_parlay_for_proxy(
   num_legs: usize,
   amount: u64,
   min_odds_scaled: u32,
   legs: &[ParlayLegSel],
   user: &AccountView,
   clock_sysvar: &AccountView,
   mm_program_account: &AccountView,
   mm_config_pda: &AccountView,
   mm_parlay_quote_buffer: &AccountView,
   leg_accounts: &[AccountView],
   leg_odds_out: &mut [u32],
) -> Option<(u64, u32, u8)> {
   if verify_mm_program_executable(mm_program_account).is_err() {
      return None;
   }
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

   if !invoke_get_quote_parlay_proxy(
      num_legs,
      amount,
      min_odds_scaled,
      legs,
      user,
      clock_sysvar,
      mm_program_account,
      mm_config_pda,
      mm_parlay_quote_buffer,
      leg_accounts,
   ) {
      #[cfg(feature = "log")]
      log!("get_parlay_quote_proxy: failed to invoke get quote parlay ix");
      return None;
   }

   let Some((max_amount, odds_scaled, num_legs_ret)) =
      parse_parlay_quote_return_for_mm(mm_program_account, leg_odds_out)
   else {
      #[cfg(feature = "log")]
      log!("get_parlay_quote_proxy: failed to parse parlay quote return");
      return None;
   };

   #[cfg(feature = "log")]
   log!(
      "get_parlay_quote_proxy: max_amount: {}, odds_scaled: {}",
      max_amount,
      odds_scaled
   );

   if max_amount == 0 {
      return None;
   }

   Some((max_amount, odds_scaled, num_legs_ret))
}

#[inline(never)]
fn collect_and_set_parlay_proxy_quotes(
   amount: u64,
   min_odds_scaled: u32,
   num_legs: usize,
   legs: &[ParlayLegSel],
   user: &AccountView,
   clock_sysvar: &AccountView,
   mm_accounts: &[AccountView],
) -> ProgramResult {
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
   reject_duplicate_mm_programs(mm_accounts, accounts_per_mm)?;

   let mut quotes: [MaybeUninit<ProxyParlayQuoteData>; MAX_NUMBER_OF_MMS_PROXY] =
      [const { MaybeUninit::uninit() }; MAX_NUMBER_OF_MMS_PROXY];
   let mut valid_quote_count = 0usize;
   let mut leg_odds = [0u32; MAX_PARLAY_LEGS];

   for i in 0..number_of_mms {
      let base = i * accounts_per_mm;
      let mm_program_account = &mm_accounts[base];
      let mm_config_pda = &mm_accounts[base + 1];
      let mm_parlay_quote_buffer = &mm_accounts[base + 2];
      let leg_accounts = &mm_accounts[base + MM_PARLAY_PROXY_FIXED_ACCOUNTS..base + accounts_per_mm];

      let Some((max_amount, odds_scaled, num_legs_ret)) = cpi_get_quote_parlay_for_proxy(
         num_legs,
         amount,
         min_odds_scaled,
         legs,
         user,
         clock_sysvar,
         mm_program_account,
         mm_config_pda,
         mm_parlay_quote_buffer,
         leg_accounts,
         &mut leg_odds,
      ) else {
         continue;
      };

      if valid_quote_count >= MAX_NUMBER_OF_MMS_PROXY {
         break;
      }

      quotes[valid_quote_count].write(ProxyParlayQuoteData {
         mm_address: *mm_program_account.address(),
         max_amount,
         odds_scaled,
         num_legs: num_legs_ret,
         leg_odds,
      });
      valid_quote_count += 1;
   }

   if valid_quote_count == 0 {
      log!("get_parlay_quote_proxy: no valid quotes");
      return Err(SpammError::NoQuotesAvailable.into());
   }

   set_proxy_parlay_return_data(&quotes, valid_quote_count);
   Ok(())
}

#[inline(never)]
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      clock_sysvar,
      mm_accounts @ ..,
   ] = accounts else {
      log!("get_parlay_quote_proxy: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_clock_sysvar(clock_sysvar)?;

   let FillParlayIxData {
      bet_id: _,
      amount,
      min_odds_scaled,
      num_legs: num_legs_u8,
      legs,
   } = FillParlayIxData::decode(data)?;
   let num_legs = num_legs_u8 as usize;

   if num_legs > MAX_PARLAY_LEGS {
      log!("get_parlay_quote_proxy: too many legs");
      return Err(ProgramError::InvalidInstructionData);
   }

   collect_and_set_parlay_proxy_quotes(
      amount,
      min_odds_scaled,
      num_legs,
      &legs[..num_legs],
      user,
      clock_sysvar,
      mm_accounts,
   )
}

