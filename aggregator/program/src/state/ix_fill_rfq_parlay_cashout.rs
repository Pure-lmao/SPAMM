use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::MAX_RFQ_PARLAY_LEGS,
   errors::SpammError,
};

use super::{
   ix_common::IX_ED25519_SIGNATURE_LEN,
   ix_fill_parlay_cashout::{CashoutSnapshot, CASHOUT_SNAPSHOT_LEN},
};

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillRfqParlayCashoutIxHeader {
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub amount: u64,
   pub min_payout: u64,
   pub max_payment: u64,
   pub offer_expiry: u32,
   pub num_legs: u8,
}

pub const FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN: usize =
   <FillRfqParlayCashoutIxHeader as ZeroPodFixed>::SIZE;

pub struct FillRfqParlayCashoutIxData {
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub amount: u64,
   pub min_payout: u64,
   pub max_payment: u64,
   pub offer_expiry: u32,
   pub num_legs: u8,
   pub snapshots: [CashoutSnapshot; MAX_RFQ_PARLAY_LEGS],
}

impl FillRfqParlayCashoutIxData {
   /// Never inlined: owns `[...; MAX_RFQ_PARLAY_LEGS]` snapshots plus decode temps.
   #[inline(never)]
   pub fn decode_with_signature(
      data: &[u8],
   ) -> Result<(Self, [u8; IX_ED25519_SIGNATURE_LEN]), ProgramError> {
      if data.len() < FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN + IX_ED25519_SIGNATURE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <FillRfqParlayCashoutIxHeader as ZeroPodFixed>::from_bytes(
         &data[..FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN],
      )
      .map_err(|_| ProgramError::InvalidInstructionData)?;
      let n = zc.num_legs as usize;
      if unlikely(n < 2 || n > MAX_RFQ_PARLAY_LEGS) {
         log!("fill_rfq_parlay_cashout: num_legs must be in 2..={}", MAX_RFQ_PARLAY_LEGS);
         return Err(SpammError::InvalidParlayLegCount.into());
      }
      let body_len = FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN + n * CASHOUT_SNAPSHOT_LEN;
      if data.len() != body_len + IX_ED25519_SIGNATURE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let mut parsed = Self {
         orig_bet_id: zc.orig_bet_id.get(),
         cashout_id: zc.cashout_id.get(),
         amount: zc.amount.get(),
         min_payout: zc.min_payout.get(),
         max_payment: zc.max_payment.get(),
         offer_expiry: zc.offer_expiry.get(),
         num_legs: zc.num_legs,
         snapshots: [CashoutSnapshot::zeroed(); MAX_RFQ_PARLAY_LEGS],
      };
      for i in 0..n {
         let off = FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN + i * CASHOUT_SNAPSHOT_LEN;
         parsed.snapshots[i] = CashoutSnapshot::decode_at(data, off)?;
      }
      let mut sig = [0u8; IX_ED25519_SIGNATURE_LEN];
      sig.copy_from_slice(&data[body_len..]);
      Ok((parsed, sig))
   }

   #[inline(always)]
   pub fn write_wire_with_signature(
      &self,
      signature: &[u8; IX_ED25519_SIGNATURE_LEN],
      out: &mut [u8],
   ) -> Result<(), ProgramError> {
      let n = self.num_legs as usize;
      let body_len = FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN + n * CASHOUT_SNAPSHOT_LEN;
      if out.len() != body_len + IX_ED25519_SIGNATURE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillRfqParlayCashoutIxHeaderZc {
         orig_bet_id: self.orig_bet_id.into(),
         cashout_id: self.cashout_id.into(),
         amount: self.amount.into(),
         min_payout: self.min_payout.into(),
         max_payment: self.max_payment.into(),
         offer_expiry: self.offer_expiry.into(),
         num_legs: self.num_legs,
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      for i in 0..n {
         let off = FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN + i * CASHOUT_SNAPSHOT_LEN;
         self.snapshots[i].write_at(out, off)?;
      }
      out[body_len..].copy_from_slice(signature);
      Ok(())
   }
}
