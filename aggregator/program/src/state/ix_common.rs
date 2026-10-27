//! Shared domain checks for full `IxData::decode` (not used by field-peek helpers).

use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{
   constants::ODDS_SCALE,
   errors::SpammError,
   helpers::parlay_helpers::{
      validate_parlay_same_event_odds_at, validate_unique_parlay_market_ids_at,
   },
};

use super::{
   ids::{num_sides_for_mkt},
   mm_parlay_quote::{ParlayLegQuoted, ParlayLegSel},
};

pub const IX_ED25519_SIGNATURE_LEN: usize = 64;
pub const FREEBET_ID_PREFIX_LEN: usize = 4;

#[inline(always)]
pub fn split_freebet_id_prefix(data: &[u8]) -> Result<(u32, &[u8]), ProgramError> {
   split_promo_id_prefix(data, SpammError::InvalidFreebet)
}

/// `u32` promo id, then the rest of the instruction. `id == 0` is `empty`.
#[inline(always)]
pub fn split_promo_id_prefix(data: &[u8], empty: SpammError) -> Result<(u32, &[u8]), ProgramError> {
   if unlikely(data.len() < FREEBET_ID_PREFIX_LEN) {
      return Err(ProgramError::InvalidInstructionData);
   }
   let id = u32::from_le_bytes(data[0..4].try_into().unwrap());
   if unlikely(id == 0) {
      return Err(empty.into());
   }
   Ok((id, &data[FREEBET_ID_PREFIX_LEN..]))
}

#[inline(always)]
pub fn validate_side_for_mkt(side: u8, mkt: u16, label: &str) -> Result<(), ProgramError> {
   let Some(num_sides) = num_sides_for_mkt(mkt) else {
      log!("{}: invalid mkt {}", label, mkt);
      return Err(ProgramError::InvalidInstructionData);
   };
   if unlikely(side >= num_sides) {
      log!("{}: side {} out of range for mkt {} (num_sides={})", label, side, mkt, num_sides);
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(())
}

#[inline(always)]
pub fn validate_event_state_sequence(
   event_state_sequence: u16,
   is_pregame: bool,
   label: &str,
) -> Result<(), ProgramError> {
   if unlikely(event_state_sequence == 0) {
      log!("{}: event_state_sequence must be greater than 0", label);
      return Err(ProgramError::InvalidInstructionData);
   }
   if is_pregame {
      if unlikely(event_state_sequence != 1) {
         log!("{}: pregame event_state_sequence must be 1", label);
         return Err(ProgramError::InvalidInstructionData);
      }
   } else if unlikely(event_state_sequence < 2) {
      log!("{}: live event_state_sequence must be >= 2", label);
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(())
}

#[inline(always)]
pub fn validate_amount_over_min(amount: u64, min: u64, label: &str) -> Result<(), ProgramError> {
   if unlikely(amount < min) {
      log!("{}: amount below mint minimum", label);
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(())
}

#[inline(always)]
pub fn validate_odds_above_scale(odds_scaled: u32, label: &str) -> Result<(), ProgramError> {
   if unlikely(odds_scaled <= ODDS_SCALE as u32) {
      log!("{}: odds_scaled must be greater than ODDS_SCALE (1.0)", label);
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(())
}

#[inline(never)]
pub fn validate_parlay_leg_sels_at<F>(num: usize, mut leg_at: F, label: &str) -> Result<(), ProgramError>
where
   F: FnMut(usize) -> Result<ParlayLegSel, ProgramError>,
{
   for i in 0..num {
      let leg = leg_at(i)?;
      validate_event_state_sequence(leg.event_state_sequence, leg.market_id.is_pregame(), label)?;
      validate_side_for_mkt(leg.side, leg.market_id.mkt, label)?;
   }
   validate_unique_parlay_market_ids_at(num, leg_at)?;
   Ok(())
}

#[inline(always)]
pub fn validate_parlay_leg_sels(num: usize, legs: &[ParlayLegSel], label: &str) -> Result<(), ProgramError> {
   validate_parlay_leg_sels_at(
      num,
      |i| legs.get(i).copied().ok_or(ProgramError::InvalidInstructionData),
      label,
   )
}

#[inline(never)]
pub fn validate_parlay_leg_quoted_at<F>(num: usize, mut leg_at: F, label: &str) -> Result<(), ProgramError>
where
   F: FnMut(usize) -> Result<ParlayLegQuoted, ProgramError>,
{
   for i in 0..num {
      let leg = leg_at(i)?;
      validate_event_state_sequence(leg.event_state_sequence, leg.market_id.is_pregame(), label)?;
      validate_side_for_mkt(leg.side, leg.market_id.mkt, label)?;
   }
   validate_parlay_same_event_odds_at(num, &mut leg_at)?;
   validate_unique_parlay_market_ids_at(num, leg_at)?;
   Ok(())
}

#[inline(always)]
pub fn validate_parlay_leg_quoted(num: usize, legs: &[ParlayLegQuoted], label: &str) -> Result<(), ProgramError> {
   validate_parlay_leg_quoted_at(
      num,
      |i| legs.get(i).copied().ok_or(ProgramError::InvalidInstructionData),
      label,
   )
}
