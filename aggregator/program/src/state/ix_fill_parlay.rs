use core::mem::offset_of;

use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::MAX_PARLAY_LEGS,
   errors::SpammError,
};

use super::{
   ix_common::{
      validate_amount_over_min, validate_odds_above_scale,
      validate_parlay_leg_sels,
   },
   mm_parlay_quote::{
      decode_trailing_parlay_leg_sels, empty_parlay_leg_sel_buf, write_parlay_leg_sels,
      ParlayLegSel, PARLAY_LEG_SEL_LEN,
   },
};

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

/// Router payload for `fill_parlay` (wire = header + live legs only).
#[derive(Clone)]
pub struct FillParlayIxData {
   pub bet_id: u64,
   pub amount: u64,
   pub min_odds_scaled: u32,
   pub num_legs: u8,
   /// Capacity buffer; only `0..num_legs` are live / written on the wire.
   pub legs: [ParlayLegSel; MAX_PARLAY_LEGS],
}

impl FillParlayIxData {
   pub const NUM_LEGS_OFFSET: usize = offset_of!(FillParlayIxHeaderZc, num_legs);

   #[inline(always)]
   pub fn wire_len(num_legs: usize) -> usize {
      FILL_PARLAY_IX_HEADER_LEN + num_legs * PARLAY_LEG_SEL_LEN
   }

   #[inline(always)]
   pub fn live_legs(&self) -> &[ParlayLegSel] {
      &self.legs[..self.num_legs as usize]
   }

   /// Never inlined: owns a `[ParlayLegSel; MAX_PARLAY_LEGS]` plus a zeroed decode temp.
   #[inline(never)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
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
      let mut legs = empty_parlay_leg_sel_buf::<MAX_PARLAY_LEGS>();
      decode_trailing_parlay_leg_sels(
         data,
         FILL_PARLAY_IX_HEADER_LEN,
         num,
         MAX_PARLAY_LEGS,
         0,
         &mut legs,
      )?;
      let parsed = Self {
         bet_id: zc.bet_id.get(),
         amount: zc.amount.get(),
         min_odds_scaled: zc.min_odds_scaled.get(),
         num_legs: zc.num_legs,
         legs,
      };
      validate_amount_over_min(parsed.amount, LABEL)?;
      validate_odds_above_scale(parsed.min_odds_scaled, LABEL)?;
      validate_parlay_leg_sels(num, parsed.live_legs(), LABEL)?;
      Ok(parsed)
   }

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
