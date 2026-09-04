use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use spamm_aggregator::state::{
   EventGameState, MarketId,
};

/// `get_cashout_quote` payload (bytes after the MM router discriminator), matching
/// [`GetCashoutQuoteIxData`] minus `instruction_discriminator`.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct GetCashoutQuoteIxPayload {
   pub amount: u64,
   pub payout: u64,
   pub min_payout: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub event_game_state: EventGameState,
   pub event_state_sequence: u16,
}

pub const GET_CASHOUT_QUOTE_IX_PAYLOAD_LEN: usize = <GetCashoutQuoteIxPayload as ZeroPodFixed>::SIZE;

impl GetCashoutQuoteIxPayload {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != GET_CASHOUT_QUOTE_IX_PAYLOAD_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         amount: zc.amount.get(),
         payout: zc.payout.get(),
         min_payout: zc.min_payout.get(),
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidInstructionData)?,
         side: zc.side,
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
         event_state_sequence: zc.event_state_sequence.get(),
      })
   }
}
