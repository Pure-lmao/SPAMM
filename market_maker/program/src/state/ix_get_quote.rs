use pinocchio::error::ProgramError;
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

use spamm_aggregator::state::{EventGameState, MarketId};

/// Get-quote instruction payload (bytes after the router discriminator in `lib.rs`), matching
/// `GetQuoteIxData` minus `instruction_discriminator`
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct GetQuoteIxPayload {
   pub amount: u64,
   pub odds_scaled: u32,
   pub market_id: MarketId,
   pub side: u8,
   pub event_game_state: EventGameState,
   pub event_state_sequence: u16,
}

pub const GET_QUOTE_IX_PAYLOAD_LEN: usize = <GetQuoteIxPayload as ZeroPodFixed>::SIZE;

impl GetQuoteIxPayload {
   #[inline(always)]
   pub fn from_zc(z: &GetQuoteIxPayloadZc) -> Option<Self> {
      Some(Self {
         amount: z.amount.get(),
         odds_scaled: z.odds_scaled.get(),
         market_id: MarketId::from_zc(&z.market_id)?,
         side: z.side,
         event_game_state: EventGameState::from_zc(&z.event_game_state),
         event_state_sequence: z.event_state_sequence.get(),
      })
   }

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != GET_QUOTE_IX_PAYLOAD_LEN {
         log!(
            "get_quote: ix payload len mismatch got {} want {}",
            data.len(),
            GET_QUOTE_IX_PAYLOAD_LEN
         );
         return Err(ProgramError::InvalidInstructionData);
      }
      let z = <Self as ZeroPodFixed>::from_bytes(data).map_err(|_| {
         log!("get_quote: ix payload from_bytes failed");
         ProgramError::InvalidInstructionData
      })?;
      Self::from_zc(&z).ok_or_else(|| {
         log!("get_quote: ix payload from_zc failed");
         ProgramError::InvalidInstructionData
      })
   }
}