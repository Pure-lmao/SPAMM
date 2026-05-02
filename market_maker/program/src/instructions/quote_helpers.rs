//! Shared helpers for MM `get_quote` and `get_quote_parlay` (odds body layout, parlay math).

use pinocchio::{ProgramResult, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use spamm_aggregator::state::{MarketId, ParlayLegTable, Sport};

/// Soccer Full-Time (`mkt` 1) and Double Chance (`mkt` 5): three `u32` odds in the market-data body; `side` picks the word.
#[inline(always)]
pub fn soccer_mkt_is_three_outcome_1x2_or_double_chance(m: &MarketId) -> bool {
   m.event_id.sport == Sport::Soccer && matches!(m.mkt, 1 | 5)
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
   if soccer_mkt_is_three_outcome_1x2_or_double_chance(m) {
      if unlikely(body.len() < 12) {
         log!("quote_helpers: market data body needs 3 outcomes (3 x u32)");
         return Err(ProgramError::InvalidAccountData);
      }
      u32_le_at(body, side as usize).ok_or(ProgramError::InvalidAccountData)
   } else {
      if unlikely(body.len() < 8) {
         log!("quote_helpers: market data body needs 2 outcomes (2 x u32)");
         return Err(ProgramError::InvalidAccountData);
      }
      u32_le_at(body, side as usize).ok_or(ProgramError::InvalidAccountData)
   }
}

/// Example parlay rule: no two legs may reference the same `EventId`.
#[inline(always)]
pub fn ensure_distinct_parlay_event_ids(num_legs: usize, legs: &ParlayLegTable) -> ProgramResult {
   for i in 0..num_legs {
      let li = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      for j in (i + 1)..num_legs {
         let lj = legs.get(j).ok_or(ProgramError::InvalidInstructionData)?;
         if unlikely(li.market_id.event_id.eq(&lj.market_id.event_id)) {
            log!("quote_helpers: parlay legs must be on distinct events");
            return Err(ProgramError::InvalidInstructionData);
         }
      }
   }
   Ok(())
}