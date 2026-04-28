use pinocchio::{AccountView, error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{constants::ODDS_SCALE, instructions::FillBetIxData, readers::{read_u32_le_unchecked, read_u64_le_unchecked}, state::{Sport, mm_quote::{QUOTE_DATA_LEN, QUOTE_DATA_MAX_AMOUNT_OFFSET, QUOTE_DATA_ODDS_SCALED_OFFSET}}};

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
   if unlikely(side != 0 && side != 1) {
      log!("fill_bet: side must be 0 or 1");
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