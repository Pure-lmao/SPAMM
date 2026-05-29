//! CPI each MM `get_quote` for every side in the market; return packed quotes for the UI.
//!
//! Accounts: **1 + 5 × N** (same as [`get_quote_proxy`]). `N` ≤ `min(20, max_proxy_mms_for_market_quotes(num_sides))`.
//!
//! Data: [`FillBetIxData`] (`bet_id` and `side` decoded but unused).
//!
//! Return data (`≤ 1024` bytes): concatenation of MM chunks, each
//! `mm_address: [u8; 32]` then `num_sides` × `odds_scaled: u32`.
//! Decoders derive `num_sides` from `mkt` and walk fixed-size chunks.

use pinocchio::{
   AccountView, ProgramResult,
   error::ProgramError,
};
use pinocchio_log::log;

use crate::{
   constants::MAX_NUMBER_OF_MMS_PROXY,
   helpers::set_market_quotes_proxy_return_data,
   instructions::get_quote_proxy::cpi_get_quote_for_proxy,
   parsers::parse_fill_bet_data,
   state::{
      mm_quote::{
         MARKET_QUOTES_PROXY_RETURN_MAX, PROXY_MM_MARKET_QUOTES_ADDR_LEN,
         PROXY_MARKET_SIDE_ODDS_WIRE_LEN, max_proxy_mms_for_market_quotes,
         proxy_market_mm_entry_wire_len,
      },
   },
};

const MM_ACCOUNTS_PER_MM: usize = 5;

pub const GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR: u8 = 10;

#[inline(always)]
fn write_proxy_side_odds(out: &mut [u8], off: usize, odds_scaled: u32) {
   unsafe {
      core::ptr::write_unaligned(out.as_mut_ptr().add(off) as *mut u32, odds_scaled);
   }
}

#[inline(never)]
pub fn get_market_quotes_proxy(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      mm_accounts @ ..,
   ] = accounts else {
      log!("get_market_quotes_proxy: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if mm_accounts.len() < MM_ACCOUNTS_PER_MM || mm_accounts.len() % MM_ACCOUNTS_PER_MM != 0 {
      log!("get_market_quotes_proxy: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parsed_data = parse_fill_bet_data(data)?;
   let amount = parsed_data.amount;
   let min_odds_scaled = parsed_data.min_odds_scaled;
   let market_id = parsed_data.market_id;
   let event_game_state = parsed_data.event_game_state;
   let event_state_sequence = parsed_data.event_state_sequence;

   let Some(num_sides) = market_id.num_sides() else {
      log!("get_market_quotes_proxy: invalid mkt for side count");
      return Err(ProgramError::InvalidInstructionData);
   };

   let number_of_mms = mm_accounts.len() / MM_ACCOUNTS_PER_MM;
   let max_mms = max_proxy_mms_for_market_quotes(num_sides);
   if number_of_mms == 0 || number_of_mms > MAX_NUMBER_OF_MMS_PROXY || number_of_mms > max_mms {
      log!("get_market_quotes_proxy: mm count out of range for side count");
      return Err(ProgramError::NotEnoughAccountKeys);
   }

   let entry_len = proxy_market_mm_entry_wire_len(num_sides);
   if number_of_mms * entry_len > MARKET_QUOTES_PROXY_RETURN_MAX {
      log!("get_market_quotes_proxy: return data too large");
      return Err(ProgramError::InvalidInstructionData);
   }

   let mut out = [0u8; MARKET_QUOTES_PROXY_RETURN_MAX];
   let mut valid_mm_count: usize = 0;
   let mut offset = 0usize;

   for i in 0..number_of_mms {
      let base = i * MM_ACCOUNTS_PER_MM;
      let mm_program_account = &mm_accounts[base];
      let mm_config_pda = &mm_accounts[base + 1];
      let mm_event_state_pda = &mm_accounts[base + 2];
      let mm_market_data_pda = &mm_accounts[base + 3];
      let mm_quote_buffer = &mm_accounts[base + 4];

      let mm_entry_start = offset;
      out[offset..offset + PROXY_MM_MARKET_QUOTES_ADDR_LEN]
         .copy_from_slice(mm_program_account.address().as_ref());
      offset += PROXY_MM_MARKET_QUOTES_ADDR_LEN;

      let mut any_valid = false;
      for side in 0..num_sides {
         let side_off = offset + (side as usize) * PROXY_MARKET_SIDE_ODDS_WIRE_LEN;
         let (max_amount, odds_scaled) = cpi_get_quote_for_proxy(
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
         )
         .unwrap_or((0, 0));
         if max_amount != 0 || odds_scaled != 0 {
            any_valid = true;
         }
         write_proxy_side_odds(&mut out, side_off, odds_scaled);
      }
      offset += (num_sides as usize) * PROXY_MARKET_SIDE_ODDS_WIRE_LEN;

      if any_valid {
         valid_mm_count += 1;
      } else {
         offset = mm_entry_start;
      }
   }

   if valid_mm_count == 0 {
      log!("get_market_quotes_proxy: no valid quotes");
      return Err(ProgramError::InvalidInstructionData);
   }

   let packed_len = valid_mm_count * entry_len;
   set_market_quotes_proxy_return_data(&out[..packed_len]);
   Ok(())
}
