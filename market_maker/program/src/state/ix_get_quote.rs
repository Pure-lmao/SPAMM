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
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != GET_QUOTE_IX_PAYLOAD_LEN {
         log!(
            "get_quote: ix payload len mismatch got {} want {}",
            data.len(),
            GET_QUOTE_IX_PAYLOAD_LEN
         );
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = match <Self as ZeroPodFixed>::from_bytes(data) {
         Ok(z) => z,
         Err(_) => {
            log!("get_quote: ix payload from_bytes failed");
            return Err(ProgramError::InvalidInstructionData);
         }
      };
      let market_id = match MarketId::from_zc(&zc.market_id) {
         Some(m) => m,
         None => {
            log!("get_quote: ix payload market_id from_zc failed");
            return Err(ProgramError::InvalidInstructionData);
         }
      };
      Ok(Self {
         side: zc.side,
         event_state_sequence: zc.event_state_sequence.get(),
         odds_scaled: zc.odds_scaled.get(),
         amount: zc.amount.get(),
         market_id,
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
      })
   }
}