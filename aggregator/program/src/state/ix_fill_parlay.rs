use core::mem::offset_of;

use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

#[cfg(not(target_os = "solana"))]
extern crate alloc;

use crate::{
   constants::MAX_PARLAY_LEGS,
   errors::SpammError,
};

use super::{
   ix_common::{
      validate_amount_over_min, validate_odds_above_scale,
      validate_parlay_leg_sels_at,
   },
   mm_parlay_quote::{
      decode_packed_leg, ParlayLegSel, PARLAY_LEG_SEL_LEN,
   },
};
#[cfg(not(target_os = "solana"))]
use super::mm_parlay_quote::write_parlay_leg_sels;

/// `num_legs` is last so trailing live legs start immediately after the header.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillParlayIxHeader {
   pub bet_id: u64,
   pub amount: u64,
   pub min_odds_scaled: u32,
   pub num_legs: u8,
}

pub const FILL_PARLAY_IX_HEADER_LEN: usize = <FillParlayIxHeader as ZeroPodFixed>::SIZE;

/// Header fields plus the packed live-leg bytes already in the instruction.
/// On-chain code reads one leg at a time from `leg_bytes`.
#[derive(Copy, Clone)]
pub struct FillParlayView<'a> {
   pub bet_id: u64,
   pub amount: u64,
   pub min_odds_scaled: u32,
   pub num_legs: u8,
   pub leg_bytes: &'a [u8],
}

impl<'a> FillParlayView<'a> {
   #[inline(always)]
   pub fn leg(&self, index: usize) -> Result<ParlayLegSel, ProgramError> {
      decode_packed_leg(self.leg_bytes, index)
   }

   #[inline(never)]
   pub fn decode(data: &'a [u8]) -> Result<Self, ProgramError> {
      if data.len() < FILL_PARLAY_IX_HEADER_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <FillParlayIxHeader as ZeroPodFixed>::from_bytes(&data[..FILL_PARLAY_IX_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      let num = zc.num_legs as usize;
      const LABEL: &str = "fill_parlay";
      if unlikely(num < 2 || num > MAX_PARLAY_LEGS) {
         log!("{}: num_legs must be in 2..={}", LABEL, MAX_PARLAY_LEGS);
         return Err(SpammError::InvalidParlayLegCount.into());
      }
      let legs_len = num.checked_mul(PARLAY_LEG_SEL_LEN).ok_or(ProgramError::ArithmeticOverflow)?;
      let body_end = FILL_PARLAY_IX_HEADER_LEN
         .checked_add(legs_len).ok_or(ProgramError::ArithmeticOverflow)?;
      if data.len() != body_end {
         return Err(ProgramError::InvalidInstructionData);
      }
      let parsed = Self {
         bet_id: zc.bet_id.get(),
         amount: zc.amount.get(),
         min_odds_scaled: zc.min_odds_scaled.get(),
         num_legs: zc.num_legs,
         leg_bytes: &data[FILL_PARLAY_IX_HEADER_LEN..body_end],
      };
      validate_amount_over_min(parsed.amount, 1, LABEL)?;
      validate_odds_above_scale(parsed.min_odds_scaled, LABEL)?;
      validate_parlay_leg_sels_at(num, |i| parsed.leg(i), LABEL)?;
      Ok(parsed)
   }
}

/// Host builder for `fill_parlay` wire bytes. On-chain decode is [`FillParlayView`].
pub struct FillParlayIxData {
   pub bet_id: u64,
   pub amount: u64,
   pub min_odds_scaled: u32,
   pub num_legs: u8,
   /// Capacity buffer; only `0..num_legs` are written on the wire.
   #[cfg(not(target_os = "solana"))]
   pub legs: alloc::boxed::Box<[ParlayLegSel; MAX_PARLAY_LEGS]>,
}

impl FillParlayIxData {
   pub const NUM_LEGS_OFFSET: usize = offset_of!(FillParlayIxHeaderZc, num_legs);

   #[inline(always)]
   pub fn wire_len(num_legs: usize) -> usize {
      FILL_PARLAY_IX_HEADER_LEN + num_legs * PARLAY_LEG_SEL_LEN
   }

   #[cfg(not(target_os = "solana"))]
   #[inline(always)]
   pub fn live_legs(&self) -> &[ParlayLegSel] {
      &self.legs[..self.num_legs as usize]
   }

   #[cfg(not(target_os = "solana"))]
   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      let n = self.num_legs as usize;
      let expected = Self::wire_len(n);
      if out.len() != expected {
         return Err(ProgramError::InvalidInstructionData);
      }
      let hzc = FillParlayIxHeaderZc {
         bet_id: self.bet_id.into(),
         amount: self.amount.into(),
         min_odds_scaled: self.min_odds_scaled.into(),
         num_legs: self.num_legs,
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), hzc);
      }
      write_parlay_leg_sels(&mut out[FILL_PARLAY_IX_HEADER_LEN..], &self.legs[..n])
   }
}
