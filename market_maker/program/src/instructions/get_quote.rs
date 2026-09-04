//! CPI entry used by the aggregator (and RPC) to read a quote for one MM.
//! Validates PDAs, event state, market-data layout, writes the quote buffer, sets return data (matches
//! [`spamm_aggregator::state::GetQuoteIxData`] wire after the router byte).
//!
//! Accounts **(6)** — must match aggregator CPI account order:
//! 0. `user`
//! 1. `clock_sysvar`
//! 2. `mm_market_data_pda` — [`crate::mm_helpers::mm_market_data_pda_ok`]; layout `[disc u8][bump u8][u32 seq LE][u32 odds…]` (`init_market`)
//! 3. `event_state_pda` — [`crate::mm_helpers::verify_event_state`]
//! 4. `mm_config_pda` — MM `["config"]` PDA
//! 5. `mm_quote_buffer` — single program PDA [`crate::constants::MM_QUOTE_BUFFER_SEED`]
//!
//! Instruction `data` (bytes after the router discriminator): [`crate::state::GetQuoteIxPayload`]
//! (`amount` u64, `odds_scaled` u32 min-odds hint, `MarketId`, `side` u8, `EventGameState`, `event_state_sequence` u16).
//!
//! Return data (`sol_set_return_data`): packed `max_amount` (u64 LE) + `odds_scaled` (u32 LE).

use pinocchio::{AccountView, Address, address::address_eq, hint::unlikely};
use pinocchio_log::log;
use zeropod::ZeroPodFixed;

use crate::{
   constants::{MAX_QUOTE_STAKE_UNITS, MM_CONFIG_PDA, QUOTE_BUFFER_PDA},
   instructions::quote_helpers::{odds_from_market_data_body, validate_quote_leg_context},
   mm_helpers::{mm_market_data_pda_ok, verify_event_state},
   state::{GetQuoteIxPayload, GetQuoteReturnWire},
};
use spamm_aggregator::{
   QuoteResult,
   state::{
      MMQuoteBuffer, MM_QUOTE_BUFFER_LEN,
      mm_quote::MM_QUOTE_BUFFER_DISCRIMINATOR,
   },
};

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> QuoteResult {
   let [
      user,
      _clock_sysvar,
      mm_market_data_pda,
      event_state_pda,
      mm_config_pda,
      mm_quote_buffer,
   ] = accounts else {
      log!("get_quote: mm accounts mismatch");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   };
   let parsed_data = match GetQuoteIxPayload::decode(data) {
      Ok(p) => p,
      Err(_) => {
         log!("get_quote: decode failed");
         set_get_quote_return_data(0, 0)?;
         return Ok(());
      }
   };
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
   if unlikely(validate_quote_leg_context(&market_id, side, parsed_data.event_state_sequence).is_err()) {
      log!("get_quote: invalid leg context");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }

   let event_state_sequence = parsed_data.event_state_sequence;
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

   let market_data = match mm_market_data_pda.try_borrow() {
      Ok(d) if d.len() >= 6 => d,
      _ => {
         log!("get_quote: market data borrow failed or too short");
         set_get_quote_return_data(0, 0)?;
         return Ok(());
      }
   };
   log!("get_quote: market_data_len {}", market_data.len());
   // Market data: [disc][bump][u32 seq][body]; odds start at byte 6 (`init_market`).
   let body = &market_data[6..] as &[u8];
   log!("get_quote: body_len {} side {}", body.len(), side);
   let odds_scaled = match odds_from_market_data_body(&market_id, body, side) {
      Ok(o) => o,
      Err(_e) => {
         log!("get_quote: odds_from_market_data_body failed");
         set_get_quote_return_data(0, 0)?;
         return Ok(());
      }
   };

   if unlikely(odds_scaled < parsed_data.odds_scaled) {
      log!("get_quote: odds below caller min hint");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }

   let max_amount = core::cmp::min(parsed_data.amount, MAX_QUOTE_STAKE_UNITS);
   log!("get_quote: max_amount: {}, odds_scaled: {} (min_odds_scaled {})", 
      max_amount, odds_scaled, parsed_data.odds_scaled);

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

   let mut buf = match mm_quote_buffer.try_borrow_mut() {
      Ok(b) if b.len() == MM_QUOTE_BUFFER_LEN => b,
      _ => {
         log!("get_quote: quote buffer borrow failed or len mismatch");
         set_get_quote_return_data(0, 0)?;
         return Ok(());
      }
   };
   if unlikely(quote.write_wire(&mut buf).is_err()) {
      log!("get_quote: quote write failed");
      set_get_quote_return_data(0, 0)?;
      return Ok(());
   }

   set_get_quote_return_data(max_amount, odds_scaled)?;
   Ok(())
}

#[inline(always)]
fn set_get_quote_return_data(max_amount: u64, odds_scaled: u32) -> QuoteResult {
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
