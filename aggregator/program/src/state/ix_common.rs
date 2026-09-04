//! Shared domain checks for full `IxData::decode` (not used by field-peek helpers).

use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{
   constants::{MIN_BET_AMOUNT, ODDS_SCALE},
   errors::SpammError,
   helpers::parlay_helpers::{
      validate_parlay_same_event_odds, validate_unique_parlay_market_ids,
   },
};

use super::{
   ids::{num_sides_for_mkt, Sport},
   mm_parlay_quote::{ParlayLegQuoted, ParlayLegSel},
};

pub const IX_ED25519_SIGNATURE_LEN: usize = 64;
pub const FREEBET_ID_PREFIX_LEN: usize = 4;

#[inline(always)]
pub fn split_freebet_id_prefix(data: &[u8]) -> Result<(u32, &[u8]), ProgramError> {
   if unlikely(data.len() < FREEBET_ID_PREFIX_LEN) {
      return Err(ProgramError::InvalidInstructionData);
   }
   let id = u32::from_le_bytes(data[0..4].try_into().unwrap());
   if unlikely(id == 0) {
      return Err(SpammError::InvalidFreebet.into());
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
pub fn validate_sport(sport: Sport, label: &str) -> Result<(), ProgramError> {
   if unlikely(!matches!(
      sport,
      Sport::Soccer
         | Sport::IceHockey
         | Sport::AmericanFootball
         | Sport::Basketball
         | Sport::Baseball
         | Sport::Tennis
         | Sport::Cs2
         | Sport::Dota
         | Sport::Lol
         | Sport::Valorant
   )) {
      log!("{}: invalid sport", label);
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
pub fn validate_amount_over_min(amount: u64, label: &str) -> Result<(), ProgramError> {
   if unlikely(amount < MIN_BET_AMOUNT) {
      log!("{}: amount must be >= MIN_BET_AMOUNT", label);
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

#[inline(always)]
pub fn validate_parlay_leg_sels(num: usize, legs: &[ParlayLegSel], label: &str) -> Result<(), ProgramError> {
   for i in 0..num {
      let leg = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      validate_event_state_sequence(leg.event_state_sequence, leg.market_id.is_pregame(), label)?;
      validate_sport(leg.market_id.event_id.sport, label)?;
      validate_side_for_mkt(leg.side, leg.market_id.mkt, label)?;
   }
   validate_unique_parlay_market_ids(num, legs)?;
   Ok(())
}

#[inline(always)]
pub fn validate_parlay_leg_quoted(num: usize, legs: &[ParlayLegQuoted], label: &str) -> Result<(), ProgramError> {
   for i in 0..num {
      let leg = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      validate_event_state_sequence(leg.event_state_sequence, leg.market_id.is_pregame(), label)?;
      validate_sport(leg.market_id.event_id.sport, label)?;
      validate_side_for_mkt(leg.side, leg.market_id.mkt, label)?;
   }
   validate_parlay_same_event_odds(num, legs)?;
   validate_unique_parlay_market_ids(num, legs)?;
   Ok(())
}
