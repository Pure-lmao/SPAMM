use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

/// `fill_cashout_quote_parlay` payload (bytes after the MM router discriminator), matching
/// [`FillCashoutQuoteParlayIxData`] minus `instruction_discriminator`.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillCashoutQuoteParlayIxPayload {
   pub amount: u64,
   pub amount_to_send: u64,
}

pub const FILL_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_LEN: usize =
   <FillCashoutQuoteParlayIxPayload as ZeroPodFixed>::SIZE;

impl FillCashoutQuoteParlayIxPayload {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != FILL_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         amount: zc.amount.get(),
         amount_to_send: zc.amount_to_send.get(),
      })
   }
}
