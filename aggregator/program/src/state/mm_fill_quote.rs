use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::state::{EventGameState, MarketId};

pub const FILL_QUOTE_IX_DISCRIMINATOR: u8 = 121;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillQuoteIxData {
   pub instruction_discriminator: u8,
   pub amount_to_fill: u64,
   pub odds_scaled: u32,
   pub market_id: MarketId,
   pub side: u8,
   pub event_game_state: EventGameState,
   pub event_state_sequence: u16,
   pub amount_to_send: u64
}

impl FillQuoteIxData {
   pub const WIRE_LEN: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn to_zc(&self) -> FillQuoteIxDataZc {
      FillQuoteIxDataZc {
         instruction_discriminator: self.instruction_discriminator,
         amount_to_fill: self.amount_to_fill.into(),
         odds_scaled: self.odds_scaled.into(),
         market_id: self.market_id.to_zc(),
         side: self.side,
         event_game_state: self.event_game_state.to_zc(),
         event_state_sequence: self.event_state_sequence.into(),
         amount_to_send: self.amount_to_send.into(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &FillQuoteIxDataZc) -> Option<Self> {
      Some(Self {
         instruction_discriminator: z.instruction_discriminator,
         amount_to_fill: z.amount_to_fill.into(),
         odds_scaled: z.odds_scaled.into(),
         market_id: MarketId::from_zc(&z.market_id)?,
         side: z.side,
         event_game_state: EventGameState::from_zc(&z.event_game_state),
         event_state_sequence: z.event_state_sequence.into(),
         amount_to_send: z.amount_to_send.into(),
      })
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

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != Self::WIRE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      if data[0] != FILL_QUOTE_IX_DISCRIMINATOR {
         return Err(ProgramError::InvalidInstructionData);
      }
      let z = <Self as ZeroPodFixed>::from_bytes(data).map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self::from_zc(&z).ok_or(ProgramError::InvalidInstructionData)?)
   }
}
