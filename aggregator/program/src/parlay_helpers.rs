//! Shared parlay odds layout, ticket folding, and modified-win settlement math.

use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::constants::{MAX_PARLAY_LEGS, ODDS_SCALE};
use crate::state::{
   account_bet::BetResult,
   mm_parlay_quote::{ParlayLegTable, ParlayLegWire},
};

/// Fold ticket-level `result` from active leg results after `grade_parlay` updates.
#[inline(always)]
pub fn fold_parlay_ticket_result(num_legs: usize, legs: &ParlayLegTable) -> BetResult {
   let mut any_lost = false;
   let mut any_modified = false;
   let mut all_won = true;
   let mut all_void = true;
   let mut any_pending = false;

   for i in 0..num_legs {
      let Some(leg) = legs.get(i) else {
         return BetResult::Pending;
      };
      match leg.result {
         BetResult::Pending => {
            any_pending = true;
            all_won = false;
            all_void = false;
         }
         BetResult::Lost => {
            any_lost = true;
            all_won = false;
            all_void = false;
         }
         BetResult::Won => {
            all_void = false;
         }
         BetResult::HalfWon | BetResult::HalfLost => {
            any_modified = true;
            all_won = false;
            all_void = false;
         }
         BetResult::Push | BetResult::Cancelled | BetResult::RolledBack => {
            any_modified = true;
            all_won = false;
         }
         BetResult::ModifiedWin => {
            any_modified = true;
            all_won = false;
            all_void = false;
         }
      }
   }

   if any_lost {
      return BetResult::Lost;
   }
   if all_void {
      return BetResult::Cancelled;
   }
   if all_won {
      return BetResult::Won;
   }
   if any_pending {
      return BetResult::Pending;
   }
   if any_modified {
      return BetResult::ModifiedWin;
   }
   BetResult::Pending
}

/// Product of leg odds with `odds_scaled > 0` (one `/ ODDS_SCALE` per leg).
pub fn product_parlay_odds(num_legs: usize, legs: &ParlayLegTable) -> Option<u32> {
   let mut prod = ODDS_SCALE;
   for i in 0..num_legs {
      let leg = legs.get(i)?;
      if leg.odds_scaled > 0 {
         prod = prod
            .checked_mul(leg.odds_scaled as u128)?
            .checked_div(ODDS_SCALE)?;
      }
   }
   prod.try_into().ok()
}

/// Same-event companion rules for active legs (`0..num_legs`).
pub fn validate_parlay_same_event_odds(num_legs: usize, legs: &ParlayLegTable) -> Result<(), ProgramError> {
   for i in 0..num_legs {
      let leg_i = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      if leg_i.odds_scaled == 0 {
         let mut has_positive = false;
         for j in 0..num_legs {
            let leg_j = legs.get(j).ok_or(ProgramError::InvalidInstructionData)?;
            if leg_i.market_id.event_id.eq(&leg_j.market_id.event_id) && leg_j.odds_scaled > 0 {
               has_positive = true;
               break;
            }
         }
         if unlikely(!has_positive) {
            log!("parlay_helpers: zero-odds leg must share event with positive-odds leg");
            return Err(ProgramError::InvalidInstructionData);
         }
      }
   }

   let mut seen_event = [false; MAX_PARLAY_LEGS];
   for i in 0..num_legs {
      if seen_event[i] {
         continue;
      }
      let leg_i = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      let mut group_has_positive = leg_i.odds_scaled > 0;
      seen_event[i] = true;
      for j in (i + 1)..num_legs {
         let leg_j = legs.get(j).ok_or(ProgramError::InvalidInstructionData)?;
         if leg_i.market_id.event_id.eq(&leg_j.market_id.event_id) {
            seen_event[j] = true;
            if leg_j.odds_scaled > 0 {
               group_has_positive = true;
            }
         }
      }
      if unlikely(!group_has_positive) {
         log!("parlay_helpers: each event group needs at least one positive-odds leg");
         return Err(ProgramError::InvalidInstructionData);
      }
   }
   Ok(())
}

/// Sanity: product of positive leg odds equals quoted total.
pub fn ensure_parlay_odds_product_matches(
   num_legs: usize,
   legs: &ParlayLegTable,
   total_odds_scaled: u32,
) -> Result<(), ProgramError> {
   let product = product_parlay_odds(num_legs, legs).ok_or(ProgramError::ArithmeticOverflow)?;
   if unlikely(product != total_odds_scaled) {
      log!(
         "parlay_helpers: leg odds product {} != total {}",
         product,
         total_odds_scaled
      );
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(())
}

/// Force unused slots (`num_legs..MAX`) to [`ParlayLegWire::placeholder`] so only signed/active legs remain.
#[inline(always)]
pub fn force_placeholder_legs_after(num_legs: usize, legs: &mut ParlayLegTable) {
   for i in num_legs..MAX_PARLAY_LEGS {
      legs.set(i, ParlayLegWire::placeholder());
   }
}

/// Apply per-leg odds from MM return wire into a leg table (preserves selection fields).
pub fn apply_leg_odds_to_table(
   num_legs: usize,
   legs: &mut ParlayLegTable,
   leg_odds: [u32; MAX_PARLAY_LEGS],
) {
   for i in 0..num_legs {
      if let Some(leg) = legs.get_mut(i) {
         leg.odds_scaled = leg_odds[i];
         leg.result = BetResult::Pending;
      }
   }
   force_placeholder_legs_after(num_legs, legs);
}

/// Modified-win settlement: returns `(user_return, is_full_loss)`.
pub fn compute_modified_parlay_settlement(
   stake: u64,
   num_legs: usize,
   legs: &ParlayLegTable,
) -> Result<(u64, bool), ProgramError> {
   let mut dropped = [false; MAX_PARLAY_LEGS];

   // Same-event drop: cancelled event or void on a zero-odds leg drops the whole event group.
   for i in 0..num_legs {
      if dropped[i] {
         continue;
      }
      let leg_i = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      let mut group_indices = [0usize; MAX_PARLAY_LEGS];
      let mut group_len = 0usize;
      group_indices[group_len] = i;
      group_len += 1;
      for j in (i + 1)..num_legs {
         if dropped[j] {
            continue;
         }
         let leg_j = legs.get(j).ok_or(ProgramError::InvalidInstructionData)?;
         if leg_i.market_id.event_id.eq(&leg_j.market_id.event_id) {
            group_indices[group_len] = j;
            group_len += 1;
         }
      }

      let mut drop_group = false;
      for k in 0..group_len {
         let idx = group_indices[k];
         let leg = legs.get(idx).ok_or(ProgramError::InvalidInstructionData)?;
         if leg.result == BetResult::Cancelled {
            drop_group = true;
            break;
         }
         if leg.odds_scaled == 0 && leg.result.is_void_like() {
            drop_group = true;
            break;
         }
      }
      if drop_group {
         for k in 0..group_len {
            dropped[group_indices[k]] = true;
         }
      }
   }

   let mut active_stake = stake;
   let mut immediate_refund = 0u64;

   for i in 0..num_legs {
      if dropped[i] {
         continue;
      }
      let leg = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      if leg.result == BetResult::Lost {
         return Ok((0, true));
      }
   }

   // Half results: process in leg order.
   for i in 0..num_legs {
      if dropped[i] {
         continue;
      }
      let leg = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      match leg.result {
         BetResult::HalfWon => {
            let half = active_stake
               .checked_div(2)
               .ok_or(ProgramError::ArithmeticOverflow)?;
            immediate_refund = immediate_refund
               .checked_add(half)
               .ok_or(ProgramError::ArithmeticOverflow)?;
            active_stake = active_stake
               .checked_sub(half)
               .ok_or(ProgramError::ArithmeticOverflow)?;
         }
         BetResult::HalfLost => {
            let half = active_stake
               .checked_div(2)
               .ok_or(ProgramError::ArithmeticOverflow)?;
            active_stake = active_stake
               .checked_sub(half)
               .ok_or(ProgramError::ArithmeticOverflow)?;
            dropped[i] = true;
         }
         _ => {}
      }
   }

   let mut combined = ODDS_SCALE;
   let mut any_active = false;
   for i in 0..num_legs {
      if dropped[i] {
         continue;
      }
      let leg = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      any_active = true;
      let effective_odds = if leg.result.is_void_like() {
         ODDS_SCALE as u32
      } else if leg.odds_scaled > 0 {
         leg.odds_scaled
      } else {
         ODDS_SCALE as u32
      };
      combined = combined
         .checked_mul(effective_odds as u128)
         .and_then(|x| x.checked_div(ODDS_SCALE))
         .ok_or(ProgramError::ArithmeticOverflow)?;
   }

   if !any_active {
      return Ok((stake, false));
   }

   let win_portion = (active_stake as u128)
      .checked_mul(combined)
      .and_then(|x| x.checked_div(ODDS_SCALE))
      .ok_or(ProgramError::ArithmeticOverflow)?
      .try_into()
      .map_err(|_| ProgramError::ArithmeticOverflow)?;

   let user_return = immediate_refund
      .checked_add(win_portion)
      .ok_or(ProgramError::ArithmeticOverflow)?;

   Ok((user_return, false))
}
