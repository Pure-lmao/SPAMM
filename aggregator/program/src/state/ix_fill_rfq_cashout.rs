use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use super::{
   ix_common::IX_ED25519_SIGNATURE_LEN,
   other::EventGameState,
};

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillRfqCashoutIxData {
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub amount: u64,
   pub min_payout: u64,
   pub max_payment: u64,
   pub offer_expiry: u32,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
}

pub const FILL_RFQ_CASHOUT_IX_BODY_LEN: usize = <FillRfqCashoutIxData as ZeroPodFixed>::SIZE;
pub const FILL_RFQ_CASHOUT_IX_DATA_LEN: usize = FILL_RFQ_CASHOUT_IX_BODY_LEN + IX_ED25519_SIGNATURE_LEN;

impl FillRfqCashoutIxData {
   #[inline(always)]
   pub fn decode_with_signature(data: &[u8]) -> Result<(Self, [u8; IX_ED25519_SIGNATURE_LEN]), ProgramError> {
      if data.len() != FILL_RFQ_CASHOUT_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(&data[..FILL_RFQ_CASHOUT_IX_BODY_LEN])
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      let parsed = Self {
         orig_bet_id: zc.orig_bet_id.get(),
         cashout_id: zc.cashout_id.get(),
         amount: zc.amount.get(),
         min_payout: zc.min_payout.get(),
         max_payment: zc.max_payment.get(),
         offer_expiry: zc.offer_expiry.get(),
         event_state_sequence: zc.event_state_sequence.get(),
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
      };
      let mut sig = [0u8; IX_ED25519_SIGNATURE_LEN];
      sig.copy_from_slice(&data[FILL_RFQ_CASHOUT_IX_BODY_LEN..]);
      Ok((parsed, sig))
   }

   #[inline(always)]
   pub fn write_wire_with_signature(
      &self,
      signature: &[u8; IX_ED25519_SIGNATURE_LEN],
      out: &mut [u8],
   ) -> Result<(), ProgramError> {
      if out.len() != FILL_RFQ_CASHOUT_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillRfqCashoutIxDataZc {
         orig_bet_id: self.orig_bet_id.into(),
         cashout_id: self.cashout_id.into(),
         amount: self.amount.into(),
         min_payout: self.min_payout.into(),
         max_payment: self.max_payment.into(),
         offer_expiry: self.offer_expiry.into(),
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      out[FILL_RFQ_CASHOUT_IX_BODY_LEN..].copy_from_slice(signature);
      Ok(())
   }
}
