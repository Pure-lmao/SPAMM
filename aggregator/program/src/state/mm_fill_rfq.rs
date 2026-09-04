//! MM CPI payload for `fill_bet_rfq` / `fill_parlay_rfq` (aggregator → market maker).

use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

/// Single-bet RFQ collateral CPI (`fill_bet_rfq`).
pub const FILL_BET_RFQ_IX_DISCRIMINATOR: u8 = 130;
/// Parlay RFQ collateral CPI (`fill_parlay_rfq`).
pub const FILL_PARLAY_RFQ_IX_DISCRIMINATOR: u8 = 131;
/// Cashout RFQ payment CPI (`fill_cashout_rfq`).
pub const FILL_CASHOUT_RFQ_IX_DISCRIMINATOR: u8 = 144;
/// Parlay cashout RFQ payment CPI (`fill_parlay_cashout_rfq`).
pub const FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR: u8 = 145;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillRfqIxData {
   pub instruction_discriminator: u8,
   pub amount_to_send: u64,
}

impl FillRfqIxData {
   pub const WIRE_LEN: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != Self::WIRE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      if data[0] != FILL_BET_RFQ_IX_DISCRIMINATOR
         && data[0] != FILL_PARLAY_RFQ_IX_DISCRIMINATOR
         && data[0] != FILL_CASHOUT_RFQ_IX_DISCRIMINATOR
         && data[0] != FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR
      {
         return Err(ProgramError::InvalidInstructionData);
      }
      let z = <Self as ZeroPodFixed>::from_bytes(data).map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         instruction_discriminator: z.instruction_discriminator,
         amount_to_send: z.amount_to_send.get(),
      })
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != Self::WIRE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillRfqIxDataZc {
         instruction_discriminator: self.instruction_discriminator,
         amount_to_send: self.amount_to_send.into(),
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}
