use core::mem::offset_of;

use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::MAX_RFQ_PARLAY_LEGS,
   errors::SpammError,
   helpers::parlay_helpers::ensure_parlay_odds_product_matches,
};

use super::{
   ix_common::{
      validate_amount_over_min, validate_odds_above_scale,
      validate_parlay_leg_quoted, IX_ED25519_SIGNATURE_LEN,
   },
   mm_parlay_quote::{
      decode_trailing_parlay_leg_quoted, write_parlay_leg_quoted,
      ParlayLegQuoted, PARLAY_LEG_QUOTED_LEN,
   },
};

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

/// Owned RFQ parlay ix (wire = header + live legs only + 64-byte signature).
///
/// Host `size_of` ≈ 3240 with `MAX_RFQ_PARLAY_LEGS = 40` (padded `ParlayLegQuoted`). Never
/// return this by value from a decode helper — SBF frames are 4096 and a return slot doubles it.
#[derive(Clone)]
pub struct FillRfqParlayIxData {
   pub bet_id: u64,
   pub amount: u64,
   pub max_stake: u64,
   pub odds_scaled: u32,
   pub offer_expiry: u32,
   pub num_legs: u8,
   /// Capacity buffer; only `0..num_legs` are live / written on the wire.
   pub legs: [ParlayLegQuoted; MAX_RFQ_PARLAY_LEGS],
}

impl FillRfqParlayIxData {
   pub const NUM_LEGS_OFFSET: usize = offset_of!(FillRfqParlayIxHeaderZc, num_legs);

   #[inline(always)]
   pub fn body_len(num_legs: usize) -> usize {
      FILL_RFQ_PARLAY_IX_HEADER_LEN + num_legs * PARLAY_LEG_QUOTED_LEN
   }

   #[inline(always)]
   pub fn wire_len(num_legs: usize) -> usize {
      Self::body_len(num_legs) + IX_ED25519_SIGNATURE_LEN
   }

   #[inline(always)]
   pub fn live_legs(&self) -> &[ParlayLegQuoted] {
      &self.legs[..self.num_legs as usize]
   }

   /// Decode into `out` in place. Do not assign `empty_parlay_leg_quoted_buf()` into `out.legs`
   /// (that materializes a second 3200-byte temporary on this frame).
   #[inline(never)]
   pub fn decode_into(
      out: &mut Self,
      data: &[u8],
   ) -> Result<[u8; IX_ED25519_SIGNATURE_LEN], ProgramError> {
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
      out.bet_id = zc.bet_id.get();
      out.amount = zc.amount.get();
      out.odds_scaled = zc.odds_scaled.get();
      out.max_stake = zc.max_stake.get();
      out.offer_expiry = zc.offer_expiry.get();
      out.num_legs = zc.num_legs;
      unsafe {
         core::ptr::write_bytes(out.legs.as_mut_ptr(), 0, MAX_RFQ_PARLAY_LEGS);
      }
      decode_trailing_parlay_leg_quoted(
         data,
         FILL_RFQ_PARLAY_IX_HEADER_LEN,
         num,
         MAX_RFQ_PARLAY_LEGS,
         IX_ED25519_SIGNATURE_LEN,
         &mut out.legs,
      )?;
      validate_amount_over_min(out.amount, LABEL)?;
      if unlikely(out.amount > out.max_stake) {
         log!("{}: amount exceeds max_stake", LABEL);
         return Err(SpammError::StakeExceedsMaxStake.into());
      }
      validate_odds_above_scale(out.odds_scaled, LABEL)?;
      validate_parlay_leg_quoted(num, out.live_legs(), LABEL)?;
      ensure_parlay_odds_product_matches(num, out.live_legs(), out.odds_scaled)?;
      let body_len = Self::body_len(num);
      let mut sig = [0u8; IX_ED25519_SIGNATURE_LEN];
      sig.copy_from_slice(&data[body_len..]);
      Ok(sig)
   }

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
