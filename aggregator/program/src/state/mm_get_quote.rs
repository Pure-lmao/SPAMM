use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::state::MarketId;

pub const GET_QUOTE_IX_DISCRIMINATOR: u8 = 5;

#[derive(Copy, Clone, ZeroPod)]
pub struct GetQuoteIxData {
   pub instruction_discriminator: u8,
   pub amount: u64,
   pub odds_scaled: u32,
   pub market_id: MarketId,
   pub side: u8,
   pub event_state_hash: [u8; 32],
   pub event_state_sequence: u16,
}

impl GetQuoteIxData {
   pub const WIRE_LEN: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn to_zc(self) -> GetQuoteIxDataZc {
      GetQuoteIxDataZc {
         instruction_discriminator: self.instruction_discriminator,
         amount: self.amount.into(),
         odds_scaled: self.odds_scaled.into(),
         market_id: self.market_id.to_zc(false),
         side: self.side,
         event_state_hash: self.event_state_hash,
         event_state_sequence: self.event_state_sequence.into(),
      }
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != Self::WIRE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}

const _: () = assert!(GetQuoteIxData::WIRE_LEN == 75);