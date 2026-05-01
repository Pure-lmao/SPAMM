//! CPI entry used by the aggregator (and RPC) to read a quote for one MM.
//! Validates PDAs, event state, market-data layout, writes the quote buffer, sets return data (matches
//! [`spamm_aggregator::state::GetQuoteIxData`] wire after the router byte).
//!
//! Accounts **(5)** — must match aggregator CPI account order:
//! 0. `user`
//! 1. `mm_market_data_pda` — [`crate::mm_helpers::find_market_data_pda`]; layout `[disc u8][bump u8][pad u8;2][u32 seq LE][u32 odds…]` (`init_market`)
//! 2. `event_state_pda` — [`crate::mm_helpers::verify_event_state`]
//! 3. `mm_config_pda` — MM `["config"]` PDA (validated; unused for pricing)
//! 4. `mm_quote_buffer` — single program PDA [`crate::constants::MM_QUOTE_BUFFER_SEED`]
//!
//! Instruction `data` (bytes after the router discriminator in `lib.rs`): **73 bytes**, zeropod layout, in order:
//! - `amount` (u64 LE)
//! - `odds_scaled` (u32 LE) — min odds hint from caller
//! - `market_id` (**26** bytes): nested `event_id` (`u64` LE `event_id`, `u32` LE `league`, `u8` `sport`) then `u64` LE `player`, `u32` LE `mkt`, `u8` `period`
//! - `side` (u8): `0` or `1` on two-outcome markets; `0`, `1`, or `2` on soccer `mkt` 1 or 5 (three-way)
//! - `event_state_hash` (`[u8; 32]`)
//! - `event_state_sequence` (u16 LE), must be `> 0`
//!
//! Return data (`sol_set_return_data`): **12** bytes — `max_amount` (u64 LE), `odds_scaled` (u32 LE).

use pinocchio::{AccountView, Address, ProgramResult, address::address_eq, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use crate::mm_helpers::{mm_market_data_pda_ok, verify_event_state};
use zeropod::ZeroPodFixed;

use crate::constants::{MAX_QUOTE_STAKE_UNITS, MM_CONFIG_PDA, QUOTE_BUFFER_PDA};
use crate::state::{GetQuoteIxPayload, GetQuoteReturnWire};
use spamm_aggregator::state::mm_quote::MM_QUOTE_BUFFER_DISCRIMINATOR;
use spamm_aggregator::state::{MarketId, Sport, MMQuoteBuffer, MM_QUOTE_BUFFER_LEN};

pub const GET_QUOTE_IX_DISCRIMINATOR: u8 = 5;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      mm_market_data_pda,
      event_state_pda,
      mm_config_pda,
      mm_quote_buffer,
   ] = accounts else {
      log!("get_quote: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   let parsed_data = GetQuoteIxPayload::decode(data)?;
   let side = parsed_data.side;
   let market_id = parsed_data.market_id;
   let mkt = market_id.mkt;
   if unlikely(side > 2) {
      log!("get_quote: side must be 0, 1, or 2");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(side == 2 && mkt != 1 && mkt != 5) {
      log!("get_quote: side 2 is only valid for mkt 1 or 5");
      return Err(ProgramError::InvalidInstructionData);
   }

   let event_state_sequence = parsed_data.event_state_sequence;
   if unlikely(event_state_sequence == 0) {
      log!("get_quote: event_state_sequence must be > 0");
      return Err(ProgramError::InvalidInstructionData);
   }

   let event_state_hash = parsed_data.event_state_hash;

   if unlikely(!address_eq(mm_quote_buffer.address(), &QUOTE_BUFFER_PDA)) {
      log!("get_quote: quote buffer invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      log!("get_quote: mm config pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   if unlikely(!verify_event_state(
      event_state_pda,
      program_id,
      &market_id.event_id,
      &event_state_hash,
      event_state_sequence,
   )) {
      log!("get_quote: event state invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(!mm_market_data_pda_ok(mm_market_data_pda, program_id, &market_id)) {
      log!("get_quote: market data pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   let market_data = mm_market_data_pda.try_borrow()?;
   if unlikely(market_data.len() < 8) {
      log!("get_quote: market data too short (need 8-byte oracle header + body)");
      return Err(ProgramError::InvalidAccountData);
   }
   // Market data: [disc][bump][u32 seq][body]; odds start at byte 6 (`init_market`).
   let body = &market_data[6..];
   let odds_scaled = if soccer_mkt_is_three_outcome_1x2_or_double_chance(&market_id) {
      if unlikely(body.len() < 12) {
         log!("get_quote: market data body needs 3 outcomes (3 x u32)");
         return Err(ProgramError::InvalidAccountData);
      }
      u32_le_at(body, side as usize)
         .ok_or(ProgramError::InvalidAccountData)?
   } else {
      if unlikely(body.len() < 8) {
         log!("get_quote: market data body needs 2 outcomes (2 x u32)");
         return Err(ProgramError::InvalidAccountData);
      }
      u32_le_at(body, side as usize)
         .ok_or(ProgramError::InvalidAccountData)?
   };

   let max_amount = MAX_QUOTE_STAKE_UNITS;
   log!("get_quote: max_amount: {}, odds_scaled: {}", max_amount, odds_scaled);
   set_get_quote_return_data(max_amount, odds_scaled)?;

   let quote = MMQuoteBuffer {
      discriminator: MM_QUOTE_BUFFER_DISCRIMINATOR,
      is_used: 0,
      user_address: *user.address(),
      market_id,
      side,
      max_amount,
      odds_scaled,
      event_state_hash,
      event_state_sequence,
   };

   let mut buf = mm_quote_buffer.try_borrow_mut()?;
   if unlikely(buf.len() != MM_QUOTE_BUFFER_LEN) {
      log!("get_quote: quote buffer len mismatch");
      return Err(ProgramError::InvalidAccountData);
   }
   quote.write_wire(&mut buf)?;

   Ok(())
}

/// Soccer Full-Time (`mkt` 1) and Double Chance (`mkt` 5): three `u32` odds in the market-data body; `side` picks the word.
#[inline(always)]
fn soccer_mkt_is_three_outcome_1x2_or_double_chance(m: &MarketId) -> bool {
   m.event_id.sport == Sport::Soccer && matches!(m.mkt, 1 | 5)
}

#[inline(always)]
fn u32_le_at(slice: &[u8], word_index: usize) -> Option<u32> {
   let off = word_index.checked_mul(4)?;
   let b: [u8; 4] = slice.get(off..off + 4)?.try_into().ok()?;
   Some(u32::from_le_bytes(b))
}

#[inline(always)]
fn set_get_quote_return_data(max_amount: u64, odds_scaled: u32) -> ProgramResult {
   let ret = GetQuoteReturnWire {
      max_amount,
      odds_scaled,
   };
   let zc = ret.to_zc();
   let mut out = [0u8; <GetQuoteReturnWire as ZeroPodFixed>::SIZE];
   unsafe {
      core::ptr::write(out.as_mut_ptr().cast(), zc);
   }
   #[cfg(any(target_os = "solana", target_arch = "bpf"))]
   unsafe {
      pinocchio::syscalls::sol_set_return_data(out.as_ptr(), out.len() as u64);
   }
   #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
   {
      let _ = out;
   }
   Ok(())
}
