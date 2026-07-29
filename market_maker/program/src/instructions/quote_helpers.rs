//! Shared helpers for MM `get_quote` and `get_quote_parlay` (odds body layout, parlay math).

use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use spamm_aggregator::state::{MarketId, ParlayLegTable, Sport};

pub use spamm_aggregator::parlay_helpers::{
   product_parlay_odds, validate_parlay_same_event_odds,
};

/// Soccer Full-Time (`mkt` 1) and Double Chance (`mkt` 5): three `u32` LE odds in the body in order
/// **home, away, draw**; wire `side` is `0` / `1` / `2` for the same three outcomes.
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

/// Assign per-leg odds for quote buffer: first leg per `EventId` keeps market odds; companions get `0`.
#[inline(always)]
pub fn assign_same_event_companion_odds(
   num_legs: usize,
   legs: &mut ParlayLegTable,
   market_odds: &[u32],
) {
   for i in 0..num_legs {
      let Some(leg) = legs.get_mut(i) else {
         return;
      };
      leg.odds_scaled = market_odds[i];
      leg.result = spamm_aggregator::state::account_bet::BetResult::Pending;
   }
   for i in 0..num_legs {
      let event_i = legs.get(i).map(|l| l.market_id.event_id);
      let Some(event_i) = event_i else {
         return;
      };
      for j in (i + 1)..num_legs {
         let leg_j = legs.get(j);
         if leg_j.is_some_and(|l| l.market_id.event_id.eq(&event_i)) {
            if let Some(leg) = legs.get_mut(j) {
               leg.odds_scaled = 0;
            }
         }
      }
   }
}
