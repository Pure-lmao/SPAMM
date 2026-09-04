use pinocchio::error::ProgramError;

use crate::constants::ODDS_SCALE;

pub fn calc_potential_profit(amount: u64, odds_scaled: u32) -> Result<u64, ProgramError> {
   let profit = (odds_scaled as u128)
      .checked_sub(ODDS_SCALE).ok_or_else(|| ProgramError::ArithmeticOverflow)?
      .checked_mul(amount as u128).ok_or_else(|| ProgramError::ArithmeticOverflow)?
      .checked_div(ODDS_SCALE).ok_or_else(|| ProgramError::ArithmeticOverflow)?
      .try_into().map_err(|_| ProgramError::ArithmeticOverflow)?;

   Ok(profit)
}

pub fn calc_potential_payout(amount: u64, odds_scaled: u32) -> Result<u64, ProgramError> {
   let payout = (odds_scaled as u128)
      .checked_mul(amount as u128).ok_or_else(|| ProgramError::ArithmeticOverflow)?
      .checked_div(ODDS_SCALE).ok_or_else(|| ProgramError::ArithmeticOverflow)?
      .try_into().map_err(|_| ProgramError::ArithmeticOverflow)?;

   Ok(payout)
}
