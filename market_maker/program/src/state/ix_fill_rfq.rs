use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

/// CPI payload for `fill_bet_rfq` / `fill_parlay_rfq` (bytes after the router
/// discriminator), matching `FillRfqIxData` minus `instruction_discriminator`.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillRfqIxPayload {
   pub amount_to_send: u64,
}

pub const FILL_RFQ_IX_PAYLOAD_LEN: usize = <FillRfqIxPayload as ZeroPodFixed>::SIZE;

impl FillRfqIxPayload {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != FILL_RFQ_IX_PAYLOAD_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         amount_to_send: zc.amount_to_send.get(),
      })
   }
}
