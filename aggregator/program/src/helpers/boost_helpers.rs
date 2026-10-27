//! Boost PDA checks, post-fill odds/MM checks, and settle top-up state.

use core::mem::MaybeUninit;

use pinocchio::{AccountView, Address, ProgramResult, address::address_eq, error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{
   ID,
   constants::{FREEBET_REINSTATE_SECS, MAX_NUMBER_OF_MMS, ODDS_SCALE},
   errors::SpammError,
   helpers::{
      freebet_helpers::{consume_freebet, verify_freebet_issuer_pda},
      derive_pdas::derive_boost_pda,
      verify_token_account,
   },
   state::{
      account_bet::BetResult, BetAccountData, BetFiller, BoostAccountData, BoostAccountHeader,
      BOOST_BPS_SCALE, PromoState, PromoType, ParlayBetAccountData,
   },
};

#[inline(always)]
pub fn verify_boost_pda(
   boost_pda: &AccountView,
   issuer_auth: &Address,
   mint: &Address,
   boost_id: u32,
   bump: u8,
) -> ProgramResult {
   if unlikely(!address_eq(boost_pda.owner(), &ID)) {
      return Err(ProgramError::InvalidAccountOwner);
   }
   let expected = derive_boost_pda(issuer_auth, mint, boost_id, bump);
   if unlikely(!address_eq(boost_pda.address(), &expected)) {
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(())
}

#[inline(never)]
pub fn decode_and_verify_boost(
   boost_pda: &AccountView,
   issuer_pda: &AccountView,
   boost_id: u32,
   mint: &Address,
) -> Result<BoostAccountData, ProgramError> {
   let boost = {
      let data = boost_pda.try_borrow()?;
      BoostAccountData::decode(data.as_ref())?
   };
   if unlikely(boost.boost_id != boost_id || !address_eq(&boost.mint, mint)) {
      return Err(SpammError::InvalidBoost.into());
   }
   verify_boost_pda(boost_pda, &boost.issuer_auth, &boost.mint, boost.boost_id, boost.bump)?;
   verify_freebet_issuer_pda(issuer_pda, &boost.issuer_auth)?;
   Ok(boost)
}

/// Checks that run before the generic fill. Odds and filler MMs are checked after.
#[inline(never)]
pub fn verify_boost_before_fill(
   boost: &BoostAccountData,
   user: &Address,
   mint: &Address,
   stake: u64,
   num_legs: u8,
   operators: &[Address],
   now: u32,
) -> ProgramResult {
   if unlikely(boost.state != PromoState::Available) {
      return Err(SpammError::BoostNotAvailable.into());
   }
   if unlikely(now >= boost.expiry) {
      return Err(SpammError::BoostExpired.into());
   }
   if unlikely(!address_eq(&boost.user, user) || !address_eq(&boost.mint, mint)) {
      return Err(SpammError::InvalidBoost.into());
   }
   if unlikely(stake > boost.max_stake) {
      return Err(SpammError::BoostAmountMismatch.into());
   }
   if unlikely(num_legs < boost.min_legs) {
      return Err(SpammError::BoostLegCount.into());
   }
   for op in operators {
      if unlikely(!boost.operator_allowed(op)) {
         return Err(SpammError::BoostOperatorNotAllowed.into());
      }
   }
   Ok(())
}

pub fn odds_in_boost_range(odds_scaled: u32, boost: &BoostAccountData) -> bool {
   odds_scaled >= boost.min_odds_scaled && odds_scaled <= boost.max_odds_scaled
}

#[inline(never)]
pub fn assert_boost_single_fillers(bet_pda: &AccountView, boost: &BoostAccountData) -> ProgramResult {
   let raw = bet_pda.try_borrow()?;
   let header = BetAccountData::decode_header(raw.as_ref())?;
   if unlikely(header.promo_type != PromoType::Boost) {
      return Err(SpammError::InvalidBoost.into());
   }
   let n = header.num_fillers as usize;
   let mut buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   BetAccountData::decode_fillers_into(raw.as_ref(), n, &mut buf)?;
   let fillers = unsafe { core::slice::from_raw_parts(buf.as_ptr().cast::<BetFiller>(), n) };
   for filler in fillers {
      if filler.amount == 0 { continue; }
      if unlikely(!odds_in_boost_range(filler.odds_scaled, boost)) {
         return Err(SpammError::BoostOddsOutOfRange.into());
      }
      if unlikely(!boost.mm_allowed(&filler.mm_address)) {
         return Err(SpammError::BoostMmNotAllowed.into());
      }
   }
   Ok(())
}

#[inline(never)]
pub fn assert_boost_parlay(bet_pda: &AccountView, boost: &BoostAccountData) -> ProgramResult {
   let raw = bet_pda.try_borrow()?;
   let header = ParlayBetAccountData::decode_header(raw.as_ref())?;
   if unlikely(header.promo_type != PromoType::Boost || header.amount == 0) {
      return Err(SpammError::InvalidBoost.into());
   }
   if unlikely(!boost.mm_allowed(&header.filler_address)) {
      return Err(SpammError::BoostMmNotAllowed.into());
   }
   let n = header.num_legs as usize;
   if unlikely(n < boost.min_legs as usize) {
      return Err(SpammError::BoostLegCount.into());
   }
   let mut prod = ODDS_SCALE;
   for i in 0..n {
      let leg = ParlayBetAccountData::decode_leg(raw.as_ref(), i)?;
      if leg.odds_scaled > 0 {
         prod = prod
            .checked_mul(leg.odds_scaled as u128).ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(ODDS_SCALE).ok_or(ProgramError::ArithmeticOverflow)?;
      }
      if unlikely(!boost.operator_allowed(&leg.market_id.operator)) {
         return Err(SpammError::BoostOperatorNotAllowed.into());
      }
   }
   let odds_scaled = u32::try_from(prod).map_err(|_| ProgramError::ArithmeticOverflow)?;
   if unlikely(!odds_in_boost_range(odds_scaled, boost)) {
      return Err(SpammError::BoostOddsOutOfRange.into());
   }
   Ok(())
}

pub fn mark_boost_used(boost_pda: &mut AccountView) -> ProgramResult {
   let mut data = boost_pda.try_borrow_mut()?;
   let header = BoostAccountData::decode_header(data.as_ref())?;
   if unlikely(header.state != PromoState::Available) {
      return Err(SpammError::BoostNotAvailable.into());
   }
   BoostAccountData::patch_state(&mut data, PromoState::Used)
}

fn reinstate_boost(boost_pda: &mut AccountView, now: u32) -> ProgramResult {
   let expiry = now.checked_add(FREEBET_REINSTATE_SECS).ok_or(ProgramError::ArithmeticOverflow)?;
   let mut data = boost_pda.try_borrow_mut()?;
   BoostAccountData::patch_expiry(&mut data, expiry)?;
   BoostAccountData::patch_state(&mut data, PromoState::Available)
}

/// `Won` / `ModifiedWin` / `HalfWon`: `profit * boost_bps / 10_000`.
/// `profit` is what the market maker already paid. Losses pay nothing.
/// Voids transfer nothing and reinstate. The multiply runs only for a win.
pub fn boost_topup(profit: u64, boost_bps: u32, result: BetResult) -> Result<(u64, bool), ProgramError> {
   match result {
      BetResult::Won | BetResult::ModifiedWin | BetResult::HalfWon => {
         let pay = (profit as u128)
            .checked_mul(boost_bps as u128).ok_or(ProgramError::ArithmeticOverflow)?
            / BOOST_BPS_SCALE as u128;
         let pay = u64::try_from(pay).map_err(|_| ProgramError::ArithmeticOverflow)?;
         Ok((pay, false))
      }
      BetResult::Lost | BetResult::HalfLost => Ok((0, false)),
      BetResult::Push | BetResult::Cancelled | BetResult::RolledBack => Ok((0, true)),
      BetResult::Pending => Err(SpammError::BetNotGraded.into()),
      BetResult::CashedOut => Err(SpammError::InvalidCashout.into()),
   }
}

pub fn apply_boost_settle_state(
   result: BetResult,
   actual_profit: u64,
   boost_bps: u32,
   now: u32,
   boost_pda: &mut AccountView,
   issuer_pda: &mut AccountView,
   rent_dest: &mut AccountView,
) -> Result<u64, ProgramError> {
   let (pay, reinstate) = boost_topup(actual_profit, boost_bps, result)?;
   if reinstate {
      reinstate_boost(boost_pda, now)?;
   } else {
      consume_freebet(boost_pda, issuer_pda, rent_dest)?;
   }
   Ok(pay)
}

/// Issuer ATA must already match `mint`. Used by settle after `settle_fillers`.
pub fn verify_boost_settle_accounts(
   boost_pda: &AccountView,
   issuer_auth: &AccountView,
   issuer_pda: &AccountView,
   issuer_ata: &AccountView,
   user: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   promo_account: &Address,
) -> Result<(BoostAccountHeader, u8), ProgramError> {
   let header = {
      let data = boost_pda.try_borrow()?;
      BoostAccountData::decode_header(data.as_ref())?
   };
   if unlikely(!address_eq(boost_pda.address(), promo_account) || header.state != PromoState::Used) {
      return Err(SpammError::InvalidBoost.into());
   }
   if unlikely(!address_eq(&header.issuer_auth, issuer_auth.address())) {
      log!("boost: settle issuer_auth mismatch");
      return Err(SpammError::InvalidBoost.into());
   }
   if unlikely(!address_eq(&header.user, user.address()) || !address_eq(&header.mint, mint.address())) {
      return Err(SpammError::InvalidBoost.into());
   }
   verify_boost_pda(boost_pda, &header.issuer_auth, &header.mint, header.boost_id, header.bump)?;
   let issuer_bump = verify_freebet_issuer_pda(issuer_pda, &header.issuer_auth)?;
   verify_token_account(true, issuer_ata, issuer_pda, mint, token_program, true)?;
   Ok((header, issuer_bump))
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn topup_uses_u128_and_skips_non_wins() {
      let bps = u32::MAX;
      let profit = u64::MAX / 2;
      assert!(boost_topup(profit, bps, BetResult::Lost).unwrap().0 == 0);
      assert!(boost_topup(profit, bps, BetResult::Push).unwrap().1);
      let (pay, reinstate) = boost_topup(10_000, BOOST_BPS_SCALE, BetResult::Won).unwrap();
      assert_eq!(pay, 10_000);
      assert!(!reinstate);
      let (half, _) = boost_topup(5_000, BOOST_BPS_SCALE, BetResult::HalfWon).unwrap();
      assert_eq!(half, 5_000);
      let (modified, _) = boost_topup(4_000, 5_000, BetResult::ModifiedWin).unwrap();
      assert_eq!(modified, 2_000);
      assert!(boost_topup(profit, bps, BetResult::Won).is_err());
   }
}
