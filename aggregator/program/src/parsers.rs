use pinocchio::{AccountView, error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{constants::{MAX_PARLAY_LEGS, ODDS_SCALE}, instructions::{FillBetIxData, FillParlayIxData}, readers::{read_i64_le_unchecked, read_u32_le_unchecked, read_u64_le_unchecked}, state::{ParlayLegTable, Sport, mm_quote::{QUOTE_DATA_LEN, QUOTE_DATA_MAX_AMOUNT_OFFSET, QUOTE_DATA_ODDS_SCALED_OFFSET}, other::{MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, MM_ENCUMBRANCE_PDA_LEN}
   }
};

#[inline(always)]
pub fn parse_fill_bet_data(data: &[u8]) -> Result<FillBetIxData, ProgramError> {
   let parsed_data = FillBetIxData::decode(data)?;

   if unlikely(parsed_data.amount == 0) {
      log!("fill_bet: amount must be greater than 0");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(parsed_data.min_odds_scaled <= ODDS_SCALE as u32) {
      log!("fill_bet: min_odds_scaled must be greater than ODDS_SCALE (1.0)");
      return Err(ProgramError::InvalidInstructionData);
   }

   let side = parsed_data.side;
   let mkt = parsed_data.market_id.mkt;
   if unlikely(side > 2) {
      log!("fill_bet: side must be 0=home, 1=away, or 2=draw");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(side == 2 && mkt != 1 && mkt != 5) {
      log!("fill_bet: side 2 (draw) is only valid for soccer mkt 1 or 5");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(parsed_data.event_state_sequence == 0) {
      log!("fill_bet: event_state_sequence must be greater than 0");
      return Err(ProgramError::InvalidInstructionData);
   }

   let sport = parsed_data.market_id.event_id.sport;
   if unlikely(!matches!(
      sport,
      Sport::Soccer
         | Sport::IceHockey
         | Sport::AmericanFootball
         | Sport::Basketball
         | Sport::Baseball
   )) {
      log!("fill_bet: invalid sport");
      return Err(ProgramError::InvalidInstructionData);
   }

   Ok(parsed_data)
}

/// Parsed `fill_parlay` body after structural and per-leg checks (distinct events, sides, sports).
pub struct ParsedFillParlay {
   pub bet_id: u64,
   pub amount: u64,
   pub min_odds_scaled: u32,
   pub num_legs: u8,
   pub legs: ParlayLegTable,
}

pub fn parse_fill_parlay_data(data: &[u8]) -> Result<ParsedFillParlay, ProgramError> {
   let parsed = FillParlayIxData::decode(data)?;
   let num = parsed.num_legs as usize;

   if unlikely(num < 2 || num > MAX_PARLAY_LEGS) {
      log!("fill_parlay: num_legs must be in 2..={}", MAX_PARLAY_LEGS);
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(parsed.amount == 0) {
      log!("fill_parlay: amount must be greater than 0");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(parsed.min_odds_scaled <= ODDS_SCALE as u32) {
      log!("fill_parlay: min_odds_scaled must be greater than ODDS_SCALE (1.0)");
      return Err(ProgramError::InvalidInstructionData);
   }

   for i in 0..num {
      let leg = parsed.legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      let side = leg.side;
      let mkt = leg.market_id.mkt;
      if unlikely(side > 2) {
         log!("fill_parlay: side must be 0=home, 1=away, or 2=draw");
         return Err(ProgramError::InvalidInstructionData);
      }
      if unlikely(side == 2 && mkt != 1 && mkt != 5) {
         log!("fill_parlay: side 2 (draw) is only valid for soccer mkt 1 or 5");
         return Err(ProgramError::InvalidInstructionData);
      }
      if unlikely(leg.event_state_sequence == 0) {
         log!("fill_parlay: event_state_sequence must be greater than 0");
         return Err(ProgramError::InvalidInstructionData);
      }
      let sport = leg.market_id.event_id.sport;
      if unlikely(!matches!(
         sport,
         Sport::Soccer
            | Sport::IceHockey
            | Sport::AmericanFootball
            | Sport::Basketball
            | Sport::Baseball
      )) {
         log!("fill_parlay: invalid sport");
         return Err(ProgramError::InvalidInstructionData);
      }
   }

   Ok(ParsedFillParlay {
      bet_id: parsed.bet_id,
      amount: parsed.amount,
      min_odds_scaled: parsed.min_odds_scaled,
      num_legs: parsed.num_legs,
      legs: parsed.legs,
   })
}

pub fn parse_quote_data(data: &[u8]) -> Result<(u64, u32), ProgramError> {
   if data.len() != QUOTE_DATA_LEN {
      return Err(ProgramError::InvalidInstructionData);
   }

   let amt = unsafe { 
      read_u64_le_unchecked(data.as_ptr(), QUOTE_DATA_MAX_AMOUNT_OFFSET) };
   let odds = unsafe { 
      read_u32_le_unchecked(data.as_ptr(), QUOTE_DATA_ODDS_SCALED_OFFSET) };
   Ok((amt, odds))
}

pub fn get_token_account_balance(token_account: &AccountView) -> Result<u64, ProgramError> {
   const TOKEN_ACCOUNT_AMOUNT_OFFSET: usize = 64;
   const TOKEN_ACCOUNT_AMOUNT_END: usize = TOKEN_ACCOUNT_AMOUNT_OFFSET + 8;

   if token_account.data_len() < TOKEN_ACCOUNT_AMOUNT_END {
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(unsafe { read_u64_le_unchecked(token_account.data_ptr(), TOKEN_ACCOUNT_AMOUNT_OFFSET) })
}

pub fn get_encumbrance(encumbrance_pda: &AccountView) -> Result<i64, ProgramError> {
   if encumbrance_pda.data_len() != MM_ENCUMBRANCE_PDA_LEN {
      log!("get_encumbrance: encumbrance pda data length mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(unsafe { 
      read_i64_le_unchecked(encumbrance_pda.data_ptr(), MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET)
   })
}