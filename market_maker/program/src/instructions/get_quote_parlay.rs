//! CPI entry for parlay quotes: per-leg event state + market data, combined scaled odds
//! (product with `ODDS_SCALE` normalization), writes [`MMParlayQuoteBuffer`], return data includes per-leg odds.
//!
//! Accounts **(3 + 2×L)** — must match aggregator CPI order in `fill_parlay`:
//! 0. `user`
//! 1. `mm_config_pda`
//! 2. `mm_parlay_quote_buffer` — PDA [`crate::constants::MM_PARLAY_QUOTE_BUFFER_SEED`]
//! 3..3+2L−1: alternating `mm_market_data_pda`, `event_state_pda` per leg
//!
//! Instruction `data`: [`crate::state::GetQuoteParlayIxPayload`] (after MM router discriminator).

use pinocchio::{AccountView, Address, address::address_eq, hint::unlikely};
use pinocchio_log::log;
use zeropod::ZeroPodFixed;

use crate::constants::{MAX_QUOTE_STAKE_UNITS, MM_CONFIG_PDA, PARLAY_QUOTE_BUFFER_PDA};
use crate::instructions::quote_helpers::{
   assign_same_event_companion_odds, odds_from_market_data_body, product_parlay_odds,
   validate_parlay_same_event_odds,
};
use spamm_aggregator::QuoteResult;
use crate::mm_helpers::{mm_market_data_pda_ok, verify_event_state};
use crate::state::GetQuoteParlayIxPayload;
use spamm_aggregator::constants::{MAX_PARLAY_LEGS, ODDS_SCALE};
use spamm_aggregator::state::mm_parlay_quote::{MMParlayQuoteBuffer, MM_PARLAY_QUOTE_BUFFER_LEN, ParlayLegTable};
use spamm_aggregator::state::mm_quote::GetParlayQuoteReturnWire;
use spamm_aggregator::state::Sport;
pub use spamm_aggregator::state::GET_QUOTE_PARLAY_IX_DISCRIMINATOR;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> QuoteResult {
   let [
      user,
      _clock_program,
      mm_config_pda,
      mm_parlay_quote_buffer,
      leg_accounts @ ..,
   ] = accounts else {
      log!("get_quote_parlay: accounts mismatch");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   };
   let parsed = GetQuoteParlayIxPayload::decode(data);
   if unlikely(parsed.is_err()) {
      log!("get_quote_parlay: decode failed");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }
   let parsed = parsed.unwrap();
   log!(
      "get_quote_parlay: decoded num_legs {} amount {} min_odds_scaled {}",
      parsed.num_legs,
      parsed.amount,
      parsed.odds_scaled
   );
   let n = parsed.num_legs as usize;
   if unlikely(n < 2 || n > MAX_PARLAY_LEGS) {
      log!("get_quote_parlay: num_legs must be 2..=MAX_PARLAY_LEGS");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   if unlikely(leg_accounts.len() != 2 * n) {
      log!("get_quote_parlay: leg accounts mismatch");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      log!("get_quote_parlay: mm config pda invalid");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   if unlikely(!address_eq(mm_parlay_quote_buffer.address(), &PARLAY_QUOTE_BUFFER_PDA)) {
      log!("get_quote_parlay: parlay quote buffer invalid");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   let mut legs_out = parsed.legs;
   let mut market_odds = [0u32; MAX_PARLAY_LEGS];

   for (i, leg_pair) in leg_accounts.chunks_exact(2).enumerate() {
      let md = &leg_pair[0];
      let es = &leg_pair[1];
      let leg = parsed.legs.get(i);
      if unlikely(leg.is_none()) {
         log!("get_quote_parlay: leg index out of bounds");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
      let leg = leg.unwrap();
      let side = leg.side;
      let mkt = leg.market_id.mkt;
      if unlikely(side > 2) {
         log!("get_quote_parlay: side must be 0, 1, or 2");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
      if unlikely(side == 2 && mkt != 1 && mkt != 5) {
         log!("get_quote_parlay: side 2 is only valid for mkt 1 or 5");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
      if unlikely(leg.event_state_sequence == 0) {
         log!("get_quote_parlay: leg event_state_sequence must be greater than 0");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
      if leg.market_id.is_pregame() {
         if unlikely(leg.event_state_sequence != 1) {
            log!("get_quote_parlay: pregame leg event_state_sequence must be 1");
            set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
            return Ok(());
         }
      } else if unlikely(leg.event_state_sequence < 2) {
         log!("get_quote_parlay: live leg event_state_sequence must be >= 2");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
      let sport = leg.market_id.event_id.sport;
      if unlikely(!matches!(
         sport,
         Sport::Soccer | Sport::IceHockey | Sport::AmericanFootball | Sport::Basketball | Sport::Baseball
      )) {
         log!("get_quote_parlay: invalid sport");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }

      let mid = &leg.market_id;
      if unlikely(!mm_market_data_pda_ok(md, program_id, mid)) {
         log!("get_quote_parlay: market data pda invalid");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
      if unlikely(!verify_event_state(
         es,
         program_id,
         &mid.event_id,
         &leg.event_game_state,
         leg.event_state_sequence,
      )) {
         log!("get_quote_parlay: event state invalid");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }

      let market_data = md.try_borrow();
      if unlikely(market_data.is_err()) {
         log!("get_quote_parlay: market data borrow failed");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
      let market_data = market_data.unwrap();
      if unlikely(market_data.len() < 8) {
         log!("get_quote_parlay: market data too short");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
      let body = &market_data[6..] as &[u8];
      let leg_odds = odds_from_market_data_body(mid, body, side);
      if unlikely(leg_odds.is_err()) {
         log!("get_quote_parlay: odds from market data body failed");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
      market_odds[i] = leg_odds.unwrap();
   }

   assign_same_event_companion_odds(n, &mut legs_out, &market_odds);

   if unlikely(validate_parlay_same_event_odds(n, &legs_out).is_err()) {
      log!("get_quote_parlay: same-event odds layout invalid");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   let odds_scaled = match product_parlay_odds(n, &legs_out) {
      Some(v) => v,
      None => {
         log!("get_quote_parlay: arithmetic overflow");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
   };

   if unlikely(odds_scaled <= ODDS_SCALE as u32) {
      log!("get_quote_parlay: combined odds below ODDS_SCALE (1.0): {}", odds_scaled);
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   if unlikely(odds_scaled < parsed.odds_scaled) {
      log!("get_quote_parlay: combined odds below caller min hint");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   let max_amount = MAX_QUOTE_STAKE_UNITS;
   let leg_odds_arr = {
      let mut out = [0u32; MAX_PARLAY_LEGS];
      for i in 0..n {
         out[i] = legs_out.get(i).map(|l| l.odds_scaled).unwrap_or(0);
      }
      out
   };

   log!(
      "get_quote_parlay: max_amount: {}, odds_scaled: {} (min_odds_scaled {})",
      max_amount,
      odds_scaled,
      parsed.odds_scaled
   );
   set_get_parlay_quote_return_data(max_amount, odds_scaled, parsed.num_legs, leg_odds_arr)?;

   let quote = MMParlayQuoteBuffer::new_fresh_quote(
      *user.address(),
      parsed.num_legs,
      max_amount,
      odds_scaled,
      legs_out,
   );

   let buf = mm_parlay_quote_buffer.try_borrow_mut();
   if unlikely(buf.is_err()) {
      log!("get_quote_parlay: quote buffer borrow failed");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }
   let mut buf = buf.unwrap();
   if unlikely(buf.len() != MM_PARLAY_QUOTE_BUFFER_LEN) {
      log!("get_quote_parlay: quote buffer len mismatch");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }
   let result = quote.write_wire(&mut buf);
   if unlikely(result.is_err()) {
      log!("get_quote_parlay: quote write failed");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   Ok(())
}

#[inline(always)]
fn set_get_parlay_quote_return_data(
   max_amount: u64,
   odds_scaled: u32,
   num_legs: u8,
   leg_odds: [u32; MAX_PARLAY_LEGS],
) -> QuoteResult {
   let ret = GetParlayQuoteReturnWire {
      max_amount,
      odds_scaled,
      num_legs,
      leg_odds_0: leg_odds[0],
      leg_odds_1: leg_odds[1],
      leg_odds_2: leg_odds[2],
      leg_odds_3: leg_odds[3],
      leg_odds_4: leg_odds[4],
   };
   let zc = ret.to_zc();
   let mut out = [0u8; <GetParlayQuoteReturnWire as ZeroPodFixed>::SIZE];
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

// silence unused import
const _: () = assert!(core::mem::size_of::<ParlayLegTable>() > 0);
