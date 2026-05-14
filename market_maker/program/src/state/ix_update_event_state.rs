use core::result::Result;

use pinocchio::error::ProgramError;
use spamm_aggregator::state::{EventGameState, EventId};
use zeropod::ZeroPodFixed;
/// Bytes after the router `u8` in `spamm_market_maker::lib.rs` (not including that discriminator).
///
/// Wire layout:
/// - `event_id` ([`EventId::WIRE_SIZE`] bytes)
/// - `sequence` (`u16`, LE)
/// - `game_state` ([`EventGameState`] — 8 bytes)
pub const UPDATE_EVENT_STATE_IX_DATA_LEN: usize = EventId::WIRE_SIZE + 2 + 8;

#[repr(C)]
pub struct UpdateEventStateIxPayload {
   pub event_id: EventId,
   pub sequence: u16,
   pub game_state: EventGameState,
}

impl UpdateEventStateIxPayload {
   pub const WIRE_SIZE: usize = UPDATE_EVENT_STATE_IX_DATA_LEN;

   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != Self::WIRE_SIZE {
         return Err(ProgramError::InvalidInstructionData);
      }
      let event_id = EventId::decode(&data[..EventId::WIRE_SIZE])
         .ok_or(ProgramError::InvalidInstructionData)?;
      let b = EventId::WIRE_SIZE;
      let sequence = u16::from_le_bytes([data[b], data[b + 1]]);
      let gs_zc = <EventGameState as ZeroPodFixed>::from_bytes(
         &data[EventId::WIRE_SIZE + 2..EventId::WIRE_SIZE + 2 + 8],
      )
      .map_err(|_| ProgramError::InvalidInstructionData)?;
      let game_state = EventGameState::from_zc(gs_zc);
      Ok(Self {
         event_id,
         sequence,
         game_state,
      })
   }
}
