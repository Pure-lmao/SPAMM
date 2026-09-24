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

#[cfg(test)]
mod tests {
   use super::*;
   use pinocchio::error::ProgramError;

   #[test]
   fn profit_is_zero_when_odds_equal_scale() {
      assert_eq!(calc_potential_profit(10_000_000, 10_000).unwrap(), 0);
   }

   #[test]
   fn profit_rejects_odds_one_below_scale() {
      assert_eq!(
         calc_potential_profit(10_000_000, 9_999).unwrap_err(),
         ProgramError::ArithmeticOverflow
      );
   }

   #[test]
   fn profit_exact_even_multiple() {
      assert_eq!(calc_potential_profit(10_000_000, 20_000).unwrap(), 10_000_000);
      assert_eq!(calc_potential_profit(10_000_000, 19_000).unwrap(), 9_000_000);
   }

   #[test]
   fn profit_floors_sub_unit_remainder() {
      assert_eq!(calc_potential_profit(1, 10_001).unwrap(), 0);
      assert_eq!(calc_potential_profit(10_000, 10_001).unwrap(), 1);
   }

   #[test]
   fn payout_is_stake_at_even_money() {
      assert_eq!(calc_potential_payout(10_000_000, 10_000).unwrap(), 10_000_000);
      assert_eq!(calc_potential_payout(10_000_000, 20_000).unwrap(), 20_000_000);
   }

   #[test]
   fn profit_overflow_on_huge_amount_and_odds() {
      assert_eq!(
         calc_potential_profit(u64::MAX, u32::MAX).unwrap_err(),
         ProgramError::ArithmeticOverflow
      );
   }
}
