use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use spamm_aggregator::state::{EventGameState, MarketId};

/// `fill_cashout_quote` payload (bytes after the MM router discriminator), matching
/// [`FillCashoutQuoteIxData`] minus `instruction_discriminator`.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillCashoutQuoteIxPayload {
   pub amount: u64,
   pub amount_to_send: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub event_game_state: EventGameState,
   pub event_state_sequence: u16,
}

pub const FILL_CASHOUT_QUOTE_IX_PAYLOAD_LEN: usize = <FillCashoutQuoteIxPayload as ZeroPodFixed>::SIZE;

impl FillCashoutQuoteIxPayload {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != FILL_CASHOUT_QUOTE_IX_PAYLOAD_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         amount: zc.amount.get(),
         amount_to_send: zc.amount_to_send.get(),
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidInstructionData)?,
         side: zc.side,
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
         event_state_sequence: zc.event_state_sequence.get(),
      })
   }
}
