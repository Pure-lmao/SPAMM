//! Shared promo tag and voucher lifecycle. Wire values stay stable: none `0`, freebet `1`, boost `2`.

use pinocchio::{error::ProgramError, hint::unlikely, ProgramResult};
use pinocchio_log::log;
use zeropod::ZeroPod;

use crate::errors::SpammError;

/// Ticket promo tag. `None` is a vanilla bet, and only that tag stores a default `promo_account`.
#[repr(u8)]
#[derive(Copy, Clone, ZeroPod, PartialEq, Eq, Debug)]
pub enum PromoType {
   None = 0,
   Freebet = 1,
   Boost = 2,
}

impl PromoType {
   #[inline(always)]
   pub fn from_u8(value: u8) -> Result<Self, ProgramError> {
      match value {
         0 => Ok(Self::None),
         1 => Ok(Self::Freebet),
         2 => Ok(Self::Boost),
         _ => Err(ProgramError::InvalidAccountData),
      }
   }
}

/// Freebet and boost voucher lifecycle.
#[repr(u8)]
#[derive(Copy, Clone, ZeroPod, PartialEq, Eq, Debug)]
pub enum PromoState {
   Available = 0,
   Used = 1,
}

impl PromoState {
   #[inline(always)]
   pub fn from_u8(value: u8) -> Result<Self, ProgramError> {
      match value {
         0 => Ok(Self::Available),
         1 => Ok(Self::Used),
         _ => Err(ProgramError::InvalidAccountData),
      }
   }
}

/// `boost_bps` scale. `10_000` is 100% of profit. Any non-zero value is accepted.
pub const BOOST_BPS_SCALE: u32 = 10_000;

/// Vanilla tickets only. A freebet or boost returns its own error.
#[inline(always)]
pub fn require_not_promo(promo_type: PromoType) -> ProgramResult {
   match promo_type {
      PromoType::None => Ok(()),
      PromoType::Freebet => {
         log!("promo: ticket is a freebet");
         Err(SpammError::InvalidFreebet.into())
      }
      PromoType::Boost => {
         log!("promo: ticket is a boost");
         Err(SpammError::InvalidBoost.into())
      }
   }
}

#[inline(always)]
pub fn require_is_freebet(promo_type: PromoType) -> ProgramResult {
   if unlikely(promo_type != PromoType::Freebet) {
      log!("freebet: ticket is not a freebet");
      return Err(SpammError::InvalidFreebet.into());
   }
   Ok(())
}

#[inline(always)]
pub fn require_is_boost(promo_type: PromoType) -> ProgramResult {
   if unlikely(promo_type != PromoType::Boost) {
      log!("boost: ticket is not a boost");
      return Err(SpammError::InvalidBoost.into());
   }
   Ok(())
}
