use pinocchio::{AccountView, error::ProgramError, hint::unlikely};

use pinocchio_log::log;



use zeropod::ZeroPodFixed;



use crate::{

   constants::{MAX_PARLAY_LEGS, ODDS_SCALE},

   instructions::{FillBetIxData, FillParlayIxData, FillRfqBetIxData},

   parlay_helpers::{ensure_parlay_odds_product_matches, validate_parlay_same_event_odds},

   readers::{read_i64_le_unchecked, read_u32_le_unchecked, read_u64_le_unchecked},

   state::{

      ParlayLegTable, Sport,

      ids::num_sides_for_mkt,

      mm_quote::{

         GetParlayQuoteReturnWire, PARLAY_QUOTE_RETURN_WIRE_LEN, QUOTE_DATA_LEN,

         QUOTE_DATA_MAX_AMOUNT_OFFSET, QUOTE_DATA_ODDS_SCALED_OFFSET,

      },

      other::{MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, MM_ENCUMBRANCE_PDA_LEN},

   },

};



#[inline(always)]

fn validate_side_for_mkt(side: u8, mkt: u16, label: &str) -> Result<(), ProgramError> {

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

fn validate_sport(sport: Sport, label: &str) -> Result<(), ProgramError> {

   if unlikely(!matches!(

      sport,

      Sport::Soccer

         | Sport::IceHockey

         | Sport::AmericanFootball

         | Sport::Basketball

         | Sport::Baseball

   )) {

      log!("{}: invalid sport", label);

      return Err(ProgramError::InvalidInstructionData);

   }

   Ok(())

}



#[inline(always)]

fn validate_event_state_sequence(

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

fn validate_amount_nonzero(amount: u64, label: &str) -> Result<(), ProgramError> {

   if unlikely(amount == 0) {

      log!("{}: amount must be greater than 0", label);

      return Err(ProgramError::InvalidInstructionData);

   }

   Ok(())

}



#[inline(always)]

fn validate_odds_above_scale(odds_scaled: u32, label: &str) -> Result<(), ProgramError> {

   if unlikely(odds_scaled <= ODDS_SCALE as u32) {

      log!("{}: odds_scaled must be greater than ODDS_SCALE (1.0)", label);

      return Err(ProgramError::InvalidInstructionData);

   }

   Ok(())

}



#[inline(always)]

pub fn parse_fill_bet_data(data: &[u8]) -> Result<FillBetIxData, ProgramError> {

   let parsed_data = FillBetIxData::decode(data)?;

   const LABEL: &str = "fill_bet";



   validate_amount_nonzero(parsed_data.amount, LABEL)?;

   validate_odds_above_scale(parsed_data.min_odds_scaled, LABEL)?;

   validate_event_state_sequence(

      parsed_data.event_state_sequence,

      parsed_data.market_id.is_pregame(),

      LABEL,

   )?;

   validate_sport(parsed_data.market_id.event_id.sport, LABEL)?;

   validate_side_for_mkt(parsed_data.side, parsed_data.market_id.mkt, LABEL)?;



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



#[inline(always)]

fn validate_parlay_legs(num: usize, legs: &ParlayLegTable, label: &str) -> Result<(), ProgramError> {

   for i in 0..num {

      let leg = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;

      validate_event_state_sequence(leg.event_state_sequence, leg.market_id.is_pregame(), label)?;

      validate_sport(leg.market_id.event_id.sport, label)?;

      validate_side_for_mkt(leg.side, leg.market_id.mkt, label)?;

   }

   validate_parlay_same_event_odds(num, legs)?;

   Ok(())

}



pub fn parse_fill_parlay_data(data: &[u8]) -> Result<ParsedFillParlay, ProgramError> {

   let parsed = FillParlayIxData::decode(data)?;

   let num = parsed.num_legs as usize;

   const LABEL: &str = "fill_parlay";



   if unlikely(num < 2 || num > MAX_PARLAY_LEGS) {

      log!("{}: num_legs must be in 2..={}", LABEL, MAX_PARLAY_LEGS);

      return Err(ProgramError::InvalidInstructionData);

   }



   validate_amount_nonzero(parsed.amount, LABEL)?;

   validate_odds_above_scale(parsed.min_odds_scaled, LABEL)?;

   validate_parlay_legs(num, &parsed.legs, LABEL)?;



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



   let amt = unsafe { read_u64_le_unchecked(data.as_ptr(), QUOTE_DATA_MAX_AMOUNT_OFFSET) };

   let odds = unsafe { read_u32_le_unchecked(data.as_ptr(), QUOTE_DATA_ODDS_SCALED_OFFSET) };

   Ok((amt, odds))

}



pub fn parse_parlay_quote_data(

   data: &[u8],

) -> Result<(u64, u32, u8, [u32; MAX_PARLAY_LEGS]), ProgramError> {

   if data.len() != PARLAY_QUOTE_RETURN_WIRE_LEN {

      return Err(ProgramError::InvalidInstructionData);

   }

   let zc = <GetParlayQuoteReturnWire as ZeroPodFixed>::from_bytes(data)

      .map_err(|_| ProgramError::InvalidInstructionData)?;

   let wire = GetParlayQuoteReturnWire::from_zc(zc);

   Ok((wire.max_amount, wire.odds_scaled, wire.num_legs, wire.leg_odds()))

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



pub fn parse_fill_rfq_bet_data(parsed: &FillRfqBetIxData) -> Result<(), ProgramError> {

   const LABEL: &str = "fill_rfq_bet";

   validate_amount_nonzero(parsed.amount, LABEL)?;

   if unlikely(parsed.amount > parsed.max_stake) {

      log!("{}: amount exceeds max_stake", LABEL);

      return Err(ProgramError::InvalidInstructionData);

   }

   validate_odds_above_scale(parsed.odds_scaled, LABEL)?;

   validate_event_state_sequence(

      parsed.event_state_sequence,

      parsed.market_id.is_pregame(),

      LABEL,

   )?;

   validate_sport(parsed.market_id.event_id.sport, LABEL)?;

   validate_side_for_mkt(parsed.side, parsed.market_id.mkt, LABEL)?;

   Ok(())

}



/// Validate RFQ parlay ix fields without copying the leg table onto another stack frame.

pub fn validate_fill_rfq_parlay_ix(

   parsed: &crate::instructions::fill_rfq_parlay::FillRfqParlayIxData,

) -> Result<(u64, u64, u32, u8), ProgramError> {

   let num = parsed.num_legs as usize;

   const LABEL: &str = "fill_rfq_parlay";

   if unlikely(num < 2 || num > MAX_PARLAY_LEGS) {

      log!("{}: num_legs must be in 2..={}", LABEL, MAX_PARLAY_LEGS);

      return Err(ProgramError::InvalidInstructionData);

   }

   validate_amount_nonzero(parsed.amount, LABEL)?;

   if unlikely(parsed.amount > parsed.max_stake) {

      log!("{}: amount exceeds max_stake", LABEL);

      return Err(ProgramError::InvalidInstructionData);

   }

   validate_odds_above_scale(parsed.odds_scaled, LABEL)?;

   validate_parlay_legs(num, &parsed.legs, LABEL)?;

   ensure_parlay_odds_product_matches(num, &parsed.legs, parsed.odds_scaled)?;

   Ok((parsed.bet_id, parsed.amount, parsed.odds_scaled, parsed.num_legs))

}


