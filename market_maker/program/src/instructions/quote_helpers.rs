//! Shared helpers for MM `get_quote` and `get_quote_parlay` (odds body layout, parlay math).

use pinocchio::{account::AccountView, error::ProgramError, hint::unlikely, Address};
use pinocchio_log::log;
use spamm_aggregator::{
   QuoteResult,
   state::{
      ix_common::{validate_event_state_sequence, validate_side_for_mkt},
      CASHOUT_QUOTE_RETURN_LEN, MarketId, ParlayLegQuoted, ParlayLegSel,
   },
};

use crate::mm_helpers::{mm_market_data_pda_ok, verify_event_state};

pub use spamm_aggregator::parlay_helpers::{
   product_parlay_odds, validate_parlay_same_event_odds,
};

#[inline(always)]
pub fn set_cashout_return(max_payment: u64) -> QuoteResult {
   let mut out = [0u8; CASHOUT_QUOTE_RETURN_LEN];
   out.copy_from_slice(&max_payment.to_le_bytes());
   #[cfg(any(target_os = "solana", target_arch = "bpf"))]
   unsafe {
      pinocchio::syscalls::sol_set_return_data(out.as_ptr(), out.len() as u64);
   }
   #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
   {
      let _ = out;
      log!("set_cashout_return: return data skipped (host)");
   }
   Ok(())
}

/// Side / pregame / sequence checks shared by single-leg and parlay quote paths.
#[inline(always)]
pub fn validate_quote_leg_context(
   market_id: &MarketId,
   side: u8,
   event_state_sequence: u16,
) -> Result<(), ProgramError> {
   validate_side_for_mkt(side, market_id.mkt, "get_quote")?;
   validate_event_state_sequence(
      event_state_sequence,
      market_id.is_pregame(),
      "get_quote",
   )?;
   Ok(())
}

/// Three `u32` LE odds in the body (home, away, draw) when `num_sides_for_mkt` is 3 (`mkt` 1 or 5).
#[inline(always)]
pub fn mkt_is_three_outcome(m: &MarketId) -> bool {
   m.num_sides() == Some(3)
}

#[inline(always)]
pub fn u32_le_at(slice: &[u8], word_index: usize) -> Option<u32> {
   let off = word_index.checked_mul(4)?;
   let b: [u8; 4] = slice.get(off..off + 4)?.try_into().ok()?;
   Some(u32::from_le_bytes(b))
}

/// Read scaled odds for `side` from market-data body (bytes after the 6-byte header in `init_market`).
#[inline(always)]
pub fn odds_from_market_data_body(m: &MarketId, body: &[u8], side: u8) -> Result<u32, ProgramError> {
   if mkt_is_three_outcome(m) {
      if unlikely(body.len() < 12) {
         log!(
            "quote_helpers: 3-outcome body too short len {} need 12",
            body.len()
         );
         return Err(ProgramError::InvalidAccountData);
      }
      u32_le_at(body, side as usize).ok_or(ProgramError::InvalidAccountData)
   } else {
      if unlikely(body.len() < 8) {
         log!(
            "quote_helpers: 2-outcome body too short len {} need 8",
            body.len()
         );
         return Err(ProgramError::InvalidAccountData);
      }
      u32_le_at(body, side as usize).ok_or(ProgramError::InvalidAccountData)
   }
}

/// Per-leg market-data PDA, event state, and scaled odds for parlay quote paths.
#[inline(always)]
pub fn read_parlay_leg_market_odds(
   program_id: &Address,
   mm_market_data_pda: &AccountView,
   event_state_pda: &AccountView,
   leg: &ParlayLegSel,
) -> Result<u32, ProgramError> {
   let market_id = &leg.market_id;
   if unlikely(!mm_market_data_pda_ok(mm_market_data_pda, program_id, market_id)) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!verify_event_state(
      event_state_pda,
      program_id,
      &market_id.event_id,
      &leg.event_game_state,
      leg.event_state_sequence,
   )) {
      return Err(ProgramError::InvalidAccountData);
   }
   let market_data = mm_market_data_pda
      .try_borrow()
      .map_err(|_| ProgramError::InvalidAccountData)?;
   if unlikely(market_data.len() < 6) {
      return Err(ProgramError::InvalidAccountData);
   }
   odds_from_market_data_body(market_id, &market_data[6..], leg.side)
}

/// Assign per-leg odds for quote buffer: first leg per `EventId` keeps market odds; companions get `0`.
#[inline(always)]
pub fn assign_same_event_companion_odds(
   num_legs: usize,
   sels: &[ParlayLegSel],
   market_odds: &[u32],
   out: &mut [ParlayLegQuoted],
) -> Result<(), ProgramError> {
   if unlikely(sels.len() < num_legs || market_odds.len() < num_legs || out.len() < num_legs) {
      return Err(ProgramError::InvalidInstructionData);
   }
   for i in 0..num_legs {
      out[i] = sels[i].with_odds(market_odds[i]);
   }
   for i in 0..num_legs {
      let event_i = out[i].market_id.event_id;
      for j in (i + 1)..num_legs {
         if out[j].market_id.event_id.eq(&event_i) {
            out[j].odds_scaled = 0;
         }
      }
   }
   Ok(())
}
