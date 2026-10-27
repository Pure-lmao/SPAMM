use core::mem::offset_of;

use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

#[cfg(not(target_os = "solana"))]
extern crate alloc;

use crate::{
   constants::MAX_RFQ_PARLAY_LEGS,
   errors::SpammError,
   helpers::parlay_helpers::ensure_parlay_odds_product_matches_at,
};

use super::{
   ix_common::{
      validate_amount_over_min, validate_odds_above_scale,
      validate_parlay_leg_quoted_at, IX_ED25519_SIGNATURE_LEN,
   },
   mm_parlay_quote::{
      decode_packed_leg, ParlayLegQuoted, PARLAY_LEG_QUOTED_LEN,
   },
};
#[cfg(not(target_os = "solana"))]
use super::mm_parlay_quote::write_parlay_leg_quoted;

/// Fixed prefix; `num_legs` is last so trailing legs start immediately after the header.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillRfqParlayIxHeader {
   pub bet_id: u64,
   pub amount: u64,
   pub odds_scaled: u32,
   pub max_stake: u64,
   pub offer_expiry: u32,
   pub num_legs: u8,
}

pub const FILL_RFQ_PARLAY_IX_HEADER_LEN: usize = <FillRfqParlayIxHeader as ZeroPodFixed>::SIZE;

/// Header fields plus the packed live-leg bytes already in the instruction.
#[derive(Copy, Clone)]
pub struct FillRfqParlayView<'a> {
   pub bet_id: u64,
   pub amount: u64,
   pub max_stake: u64,
   pub odds_scaled: u32,
   pub offer_expiry: u32,
   pub num_legs: u8,
   pub leg_bytes: &'a [u8],
}

impl<'a> FillRfqParlayView<'a> {
   #[inline(always)]
   pub fn leg(&self, index: usize) -> Result<ParlayLegQuoted, ProgramError> {
      decode_packed_leg(self.leg_bytes, index)
   }

   /// Checks the header, one leg at a time, and the odds product. Returns the trailing signature.
   #[inline(never)]
   pub fn decode(data: &'a [u8]) -> Result<(Self, [u8; IX_ED25519_SIGNATURE_LEN]), ProgramError> {
      if data.len() < FILL_RFQ_PARLAY_IX_HEADER_LEN + IX_ED25519_SIGNATURE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <FillRfqParlayIxHeader as ZeroPodFixed>::from_bytes(&data[..FILL_RFQ_PARLAY_IX_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      let num = zc.num_legs as usize;
      const LABEL: &str = "fill_rfq_parlay";
      if unlikely(num < 2 || num > MAX_RFQ_PARLAY_LEGS) {
         log!("{}: num_legs must be in 2..={}", LABEL, MAX_RFQ_PARLAY_LEGS);
         return Err(SpammError::InvalidParlayLegCount.into());
      }
      let legs_len = num.checked_mul(PARLAY_LEG_QUOTED_LEN).ok_or(ProgramError::ArithmeticOverflow)?;
      let body_len = FILL_RFQ_PARLAY_IX_HEADER_LEN
         .checked_add(legs_len).ok_or(ProgramError::ArithmeticOverflow)?;
      let expected = body_len
         .checked_add(IX_ED25519_SIGNATURE_LEN).ok_or(ProgramError::ArithmeticOverflow)?;
      if data.len() != expected {
         return Err(ProgramError::InvalidInstructionData);
      }
      let parsed = Self {
         bet_id: zc.bet_id.get(),
         amount: zc.amount.get(),
         max_stake: zc.max_stake.get(),
         odds_scaled: zc.odds_scaled.get(),
         offer_expiry: zc.offer_expiry.get(),
         num_legs: zc.num_legs,
         leg_bytes: &data[FILL_RFQ_PARLAY_IX_HEADER_LEN..body_len],
      };
      validate_amount_over_min(parsed.amount, 1, LABEL)?;
      if unlikely(parsed.amount > parsed.max_stake) {
         log!("{}: amount exceeds max_stake", LABEL);
         return Err(SpammError::StakeExceedsMaxStake.into());
      }
      validate_odds_above_scale(parsed.odds_scaled, LABEL)?;
      validate_parlay_leg_quoted_at(num, |i| parsed.leg(i), LABEL)?;
      ensure_parlay_odds_product_matches_at(num, |i| parsed.leg(i), parsed.odds_scaled)?;
      let mut sig = [0u8; IX_ED25519_SIGNATURE_LEN];
      sig.copy_from_slice(&data[body_len..]);
      Ok((parsed, sig))
   }
}

/// Host builder for `fill_rfq_parlay` wire bytes. On-chain decode is [`FillRfqParlayView`].
pub struct FillRfqParlayIxData {
   pub bet_id: u64,
   pub amount: u64,
   pub max_stake: u64,
   pub odds_scaled: u32,
   pub offer_expiry: u32,
   pub num_legs: u8,
   /// Capacity buffer; only `0..num_legs` are written on the wire.
   #[cfg(not(target_os = "solana"))]
   pub legs: alloc::boxed::Box<[ParlayLegQuoted; MAX_RFQ_PARLAY_LEGS]>,
}

impl FillRfqParlayIxData {
   pub const NUM_LEGS_OFFSET: usize = offset_of!(FillRfqParlayIxHeaderZc, num_legs);

   pub fn body_len(num_legs: usize) -> usize {
      FILL_RFQ_PARLAY_IX_HEADER_LEN + num_legs * PARLAY_LEG_QUOTED_LEN
   }

   #[inline(always)]
   pub fn wire_len(num_legs: usize) -> usize {
      Self::body_len(num_legs) + IX_ED25519_SIGNATURE_LEN
   }

   #[cfg(not(target_os = "solana"))]
   #[inline(always)]
   pub fn live_legs(&self) -> &[ParlayLegQuoted] {
      &self.legs[..self.num_legs as usize]
   }

   #[cfg(not(target_os = "solana"))]
   #[inline(always)]
   pub fn write_wire_with_signature(
      &self,
      signature: &[u8; IX_ED25519_SIGNATURE_LEN],
      out: &mut [u8],
   ) -> Result<(), ProgramError> {
      let n = self.num_legs as usize;
      let expected = Self::wire_len(n);
      if out.len() != expected {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillRfqParlayIxHeaderZc {
         bet_id: self.bet_id.into(),
         amount: self.amount.into(),
         odds_scaled: self.odds_scaled.into(),
         max_stake: self.max_stake.into(),
         offer_expiry: self.offer_expiry.into(),
         num_legs: self.num_legs,
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      write_parlay_leg_quoted(&mut out[FILL_RFQ_PARLAY_IX_HEADER_LEN..Self::body_len(n)], self.live_legs())?;
      out[Self::body_len(n)..].copy_from_slice(signature);
      Ok(())
   }
}
