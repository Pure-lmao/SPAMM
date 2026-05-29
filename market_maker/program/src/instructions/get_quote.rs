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
//! Instruction `data` (bytes after the router discriminator in `lib.rs`): **49 bytes**, zeropod layout, in order:
//! - `amount` (u64 LE)
//! - `odds_scaled` (u32 LE) — min odds hint from caller
//! - `market_id` (**26** bytes): nested `event_id` (`u64` LE `event_id`, `u32` LE `league`, `u8` `sport`) then `u64` LE `player`, `u32` LE `mkt`, `u8` `period`
//! - `side` (u8): two-outcome — `0` home, `1` away; soccer `mkt` 1 or 5 — `0` home, `1` away, `2` draw
//! - `event_game_state` (`EventGameState`, 8 bytes)
//! - `event_state_sequence` (u16 LE): **1** for pregame markets (event state at PG); **≥ 2** for live markets (e.g. **2** once the match has started)
//!
//! Return data (`sol_set_return_data`): **12** bytes — `max_amount` (u64 LE), `odds_scaled` (u32 LE).

use pinocchio::{AccountView, Address, ProgramResult, address::address_eq, hint::unlikely};
use pinocchio_log::log;
use crate::mm_helpers::{mm_market_data_pda_ok, verify_event_state};
use zeropod::ZeroPodFixed;

use crate::constants::{MAX_QUOTE_STAKE_UNITS, MM_CONFIG_PDA, QUOTE_BUFFER_PDA};
use crate::instructions::quote_helpers::odds_from_market_data_body;
use crate::state::{GetQuoteIxPayload, GetQuoteReturnWire};
use spamm_aggregator::state::mm_quote::MM_QUOTE_BUFFER_DISCRIMINATOR;
use spamm_aggregator::state::{MMQuoteBuffer, MM_QUOTE_BUFFER_LEN};
pub use spamm_aggregator::state::GET_QUOTE_IX_DISCRIMINATOR;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      mm_market_data_pda,
      event_state_pda,
      mm_config_pda,
      mm_quote_buffer,
   ] = accounts else {
      log!("get_quote: mm accounts mismatch");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   };
   let parsed_data = GetQuoteIxPayload::decode(data);
   if unlikely(parsed_data.is_err()) {
      log!("get_quote: decode failed");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }
   let parsed_data = parsed_data.unwrap();
   log!(
      "get_quote: decoded amount {} min_odds_scaled {} side {} ev_seq {} mkt {} sport {} pregame {}",
      parsed_data.amount,
      parsed_data.odds_scaled,
      parsed_data.side,
      parsed_data.event_state_sequence,
      parsed_data.market_id.mkt,
      parsed_data.market_id.event_id.sport as u8,
      parsed_data.market_id.is_pregame() as u8
   );
   let side = parsed_data.side;
   let market_id = parsed_data.market_id;
   let mkt = market_id.mkt;
   // SIDECHECK
   if unlikely(side > 2) {
      log!("get_quote: side must be 0, 1, or 2");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }
   // SIDECHECK
   if unlikely(side == 2 && mkt != 1 && mkt != 5) {
      log!("get_quote: side 2 is only valid for mkt 1 or 5");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }

   let event_state_sequence = parsed_data.event_state_sequence;
   if unlikely(event_state_sequence == 0) {
      log!("get_quote: event_state_sequence must be greater than 0");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }
   if market_id.is_pregame() {
      if unlikely(event_state_sequence != 1) {
         log!("get_quote: pregame event_state_sequence must be 1");
         set_get_quote_return_data(0, 0)?;
         return Ok(());
      }
   } else if unlikely(event_state_sequence < 2) {
      log!("get_quote: live event_state_sequence must be >= 2");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }

   let event_game_state = parsed_data.event_game_state;

   if unlikely(!address_eq(mm_quote_buffer.address(), &QUOTE_BUFFER_PDA)) {
      log!("get_quote: quote buffer invalid");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }

   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      log!("get_quote: mm config pda invalid");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }

   if unlikely(!verify_event_state(
      event_state_pda,
      program_id,
      &market_id.event_id,
      &event_game_state,
      event_state_sequence,
   )) {
      log!("get_quote: event state invalid (see verify_event_state logs)");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }

   if unlikely(!mm_market_data_pda_ok(mm_market_data_pda, program_id, &market_id)) {
      log!("get_quote: market data pda invalid");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }

   let market_data = mm_market_data_pda.try_borrow();
   if unlikely(market_data.is_err()) {
      log!("get_quote: market data borrow failed");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }
   let market_data = market_data.unwrap();
   log!("get_quote: market_data_len {}", market_data.len());
   if unlikely(market_data.len() < 8) {
      log!("get_quote: market data too short (need 8-byte oracle header + body)");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }
   // Market data: [disc][bump][u32 seq][body]; odds start at byte 6 (`init_market`).
   let body = &market_data[6..];
   log!("get_quote: body_len {} side {}", body.len(), side);
   let odds_scaled = match odds_from_market_data_body(&market_id, body, side) {
      Ok(o) => o,
      Err(_e) => {
         log!("get_quote: odds_from_market_data_body failed");
         set_get_quote_return_data(0, 0)?;
         return Ok(());
      }
   };

   let max_amount = MAX_QUOTE_STAKE_UNITS;
   log!("get_quote: max_amount: {}, odds_scaled: {} (min_odds_scaled {})", 
      max_amount, odds_scaled, parsed_data.odds_scaled);
   set_get_quote_return_data(max_amount, odds_scaled)?;

   let quote = MMQuoteBuffer {
      discriminator: MM_QUOTE_BUFFER_DISCRIMINATOR,
      is_used: 0,
      user_address: *user.address(),
      market_id,
      side,
      max_amount,
      odds_scaled,
      event_game_state,
      event_state_sequence,
   };

   let buf = mm_quote_buffer.try_borrow_mut();
   if unlikely(buf.is_err()) {
      log!("get_quote: quote buffer borrow failed");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }

   let mut buf = buf.unwrap();
   if unlikely(buf.len() != MM_QUOTE_BUFFER_LEN) {
      log!("get_quote: quote buffer len mismatch");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }
   let result = quote.write_wire(&mut buf);
   if unlikely(result.is_err()) {
      log!("get_quote: quote write failed");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }

   Ok(())
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
      log!("get_quote: sol_set_return_data len {}", out.len());
   }
   #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
   {
      let _ = out;
      log!("get_quote: sol_set_return_data skipped (host build)");
   }
   Ok(())
}
