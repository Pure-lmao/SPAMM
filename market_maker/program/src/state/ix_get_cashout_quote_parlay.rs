use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

/// `get_cashout_quote_parlay` header payload (bytes after the MM router discriminator), matching
/// aggregator `GetCashoutQuoteParlayIxHeader` minus `instruction_discriminator`.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct GetCashoutQuoteParlayIxHeaderPayload {
   pub amount: u64,
   pub payout: u64,
   pub min_payout: u64,
   pub num_legs: u8,
}

pub const GET_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN: usize =
   <GetCashoutQuoteParlayIxHeaderPayload as ZeroPodFixed>::SIZE;

impl GetCashoutQuoteParlayIxHeaderPayload {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != GET_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         amount: zc.amount.get(),
         payout: zc.payout.get(),
         min_payout: zc.min_payout.get(),
         num_legs: zc.num_legs,
      })
   }
}
