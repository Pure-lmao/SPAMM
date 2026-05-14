//! CPI entry for parlay quotes: distinct events, per-leg event state + market data, combined scaled odds
//! (product with `ODDS_SCALE` normalization), writes [`MMParlayQuoteBuffer`], return data matches single-leg quote.
//!
//! Accounts **(3 + 2×L)** — must match aggregator CPI order in `fill_parlay`:
//! 0. `user`
//! 1. `mm_config_pda`
//! 2. `mm_parlay_quote_buffer` — PDA [`crate::constants::MM_PARLAY_QUOTE_BUFFER_SEED`]
//! 3..3+2L−1: alternating `mm_market_data_pda`, `event_state_pda` per leg
//!
//! Instruction `data`: [`crate::state::GetQuoteParlayIxPayload`] (after MM router discriminator).

use pinocchio::{AccountView, Address, ProgramResult, address::address_eq, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use zeropod::ZeroPodFixed;

use crate::constants::{MAX_QUOTE_STAKE_UNITS, MM_CONFIG_PDA, PARLAY_QUOTE_BUFFER_PDA};
use crate::instructions::quote_helpers::{ensure_distinct_parlay_event_ids, odds_from_market_data_body};
use crate::mm_helpers::{mm_market_data_pda_ok, verify_event_state};
use crate::state::{GetQuoteParlayIxPayload, GetQuoteReturnWire};
use spamm_aggregator::constants::{MAX_PARLAY_LEGS, ODDS_SCALE};
use spamm_aggregator::state::mm_parlay_quote::{MMParlayQuoteBuffer, MM_PARLAY_QUOTE_BUFFER_LEN};
use spamm_aggregator::state::Sport;
pub use spamm_aggregator::state::GET_QUOTE_PARLAY_IX_DISCRIMINATOR;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      mm_config_pda,
      mm_parlay_quote_buffer,
      leg_accounts @ ..,
   ] = accounts else {
      log!("get_quote_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   let parsed = GetQuoteParlayIxPayload::decode(data)?;
   log!(
      "get_quote_parlay: decoded num_legs {} amount {} min_odds_scaled {}",
      parsed.num_legs,
      parsed.amount,
      parsed.odds_scaled
   );
   let n = parsed.num_legs as usize;
   if unlikely(n < 2 || n > MAX_PARLAY_LEGS) {
      log!("get_quote_parlay: num_legs must be 2..=MAX_PARLAY_LEGS");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(leg_accounts.len() != 2 * n) {
      log!("get_quote_parlay: leg accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   }

   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      log!("get_quote_parlay: mm config pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   if unlikely(!address_eq(mm_parlay_quote_buffer.address(), &PARLAY_QUOTE_BUFFER_PDA)) {
      log!("get_quote_parlay: parlay quote buffer invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   ensure_distinct_parlay_event_ids(n, &parsed.legs)?;

   let mut odds_scaled_prod = ODDS_SCALE;
   for (i, leg_pair) in leg_accounts.chunks_exact(2).enumerate() {
      let md = &leg_pair[0];
      let es = &leg_pair[1];
      let leg = parsed.legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      let side = leg.side;
      let mkt = leg.market_id.mkt;
      // SIDECHECK
      if unlikely(side > 2) {
         log!("get_quote_parlay: side must be 0, 1, or 2");
         return Err(ProgramError::InvalidInstructionData);
      }
      // SIDECHECK
      if unlikely(side == 2 && mkt != 1 && mkt != 5) {
         log!("get_quote_parlay: side 2 is only valid for mkt 1 or 5");
         return Err(ProgramError::InvalidInstructionData);
      }
      if unlikely(leg.event_state_sequence == 0) {
         log!("get_quote_parlay: leg event_state_sequence must be greater than 0");
         return Err(ProgramError::InvalidInstructionData);
      }
      if leg.market_id.is_pregame() {
         if unlikely(leg.event_state_sequence != 1) {
            log!("get_quote_parlay: pregame leg event_state_sequence must be 1");
            return Err(ProgramError::InvalidInstructionData);
         }
      } else if unlikely(leg.event_state_sequence < 2) {
         log!("get_quote_parlay: live leg event_state_sequence must be >= 2");
         return Err(ProgramError::InvalidInstructionData);
      }
      let sport = leg.market_id.event_id.sport;
      if unlikely(!matches!(
         sport,
         Sport::Soccer | Sport::IceHockey | Sport::AmericanFootball | Sport::Basketball | Sport::Baseball
      )) {
         log!("get_quote_parlay: invalid sport");
         return Err(ProgramError::InvalidInstructionData);
      }

      let mid = &leg.market_id;
      if unlikely(!mm_market_data_pda_ok(md, program_id, mid)) {
         log!("get_quote_parlay: market data pda invalid");
         return Err(ProgramError::InvalidSeeds);
      }
      if unlikely(!verify_event_state(
         es,
         program_id,
         &mid.event_id,
         &leg.event_game_state,
         leg.event_state_sequence,
      )) {
         log!("get_quote_parlay: event state invalid");
         return Err(ProgramError::InvalidAccountData);
      }

      let market_data = md.try_borrow()?;
      if unlikely(market_data.len() < 8) {
         log!("get_quote_parlay: market data too short");
         return Err(ProgramError::InvalidAccountData);
      }
      let body = &market_data[6..];
      let leg_odds = odds_from_market_data_body(mid, body, side)?;

      odds_scaled_prod = odds_scaled_prod
         .checked_mul(leg_odds as u128)
         .ok_or(ProgramError::ArithmeticOverflow)?
         .checked_div(ODDS_SCALE)
         .ok_or(ProgramError::ArithmeticOverflow)?;
   }

   let odds_scaled: u32 = odds_scaled_prod.try_into().map_err(|_| ProgramError::ArithmeticOverflow)?;
   if unlikely(odds_scaled <= ODDS_SCALE as u32) {
      log!("get_quote_parlay: combined odds below ODDS_SCALE (1.0): {}", odds_scaled);
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(odds_scaled < parsed.odds_scaled) {
      log!("get_quote_parlay: combined odds below caller min hint");
      return Err(ProgramError::InvalidInstructionData);
   }

   let max_amount = MAX_QUOTE_STAKE_UNITS;
   log!(
      "get_quote_parlay: max_amount: {}, odds_scaled: {} (min_odds_scaled {})",
      max_amount,
      odds_scaled,
      parsed.odds_scaled
   );
   set_get_quote_return_data(max_amount, odds_scaled)?;

   let quote = MMParlayQuoteBuffer::new_fresh_quote(*user.address(), parsed.num_legs, max_amount, odds_scaled, parsed.legs);

   let mut buf = mm_parlay_quote_buffer.try_borrow_mut()?;
   if unlikely(buf.len() != MM_PARLAY_QUOTE_BUFFER_LEN) {
      log!("get_quote_parlay: quote buffer len mismatch");
      return Err(ProgramError::InvalidAccountData);
   }
   quote.write_wire(&mut buf)?;

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
   }
   #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
   {
      let _ = out;
   }
   Ok(())
}