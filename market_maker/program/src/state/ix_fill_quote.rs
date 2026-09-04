use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use spamm_aggregator::state::{EventGameState, MarketId};

/// Fill-quote instruction payload (bytes after the router discriminator in `lib.rs`), matching
/// `FillQuoteIxData` minus `instruction_discriminator`.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillQuoteIxPayload {
   pub amount_to_fill: u64,
   pub odds_scaled: u32,
   pub market_id: MarketId,
   pub side: u8,
   pub event_game_state: EventGameState,
   pub event_state_sequence: u16,
   pub amount_to_send: u64,
}

pub const FILL_QUOTE_IX_PAYLOAD_LEN: usize = <FillQuoteIxPayload as ZeroPodFixed>::SIZE;

impl FillQuoteIxPayload {
   #[inline(always)]
   pub fn from_zc(z: &FillQuoteIxPayloadZc) -> Option<Self> {
      Some(Self {
         amount_to_fill: z.amount_to_fill.get(),
         odds_scaled: z.odds_scaled.get(),
         market_id: MarketId::from_zc(&z.market_id)?,
         side: z.side,
         event_game_state: EventGameState::from_zc(&z.event_game_state),
         event_state_sequence: z.event_state_sequence.get(),
         amount_to_send: z.amount_to_send.get(),
      })
   }

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != FILL_QUOTE_IX_PAYLOAD_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let z = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Self::from_zc(&z).ok_or(ProgramError::InvalidInstructionData)
   }
}
