use core::result::Result;

use pinocchio::error::ProgramError;
use spamm_aggregator::state::EventId;

/// Bytes after the router `u8` in `spamm_market_maker::lib.rs` (not including that discriminator).
pub const INIT_EVENT_IX_DATA_LEN: usize = EventId::WIRE_SIZE;

/// Wire layout (minus the outer instruction discriminator):
/// - `event_id` (`EventId::WIRE_SIZE` bytes)
#[repr(C)]
pub struct InitEventIxPayload {
   pub event_id: EventId,
}

impl InitEventIxPayload {
   pub const WIRE_SIZE: usize = INIT_EVENT_IX_DATA_LEN;

   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != Self::WIRE_SIZE {
         return Err(ProgramError::InvalidInstructionData);
      }
      let event_id = EventId::decode(data)
         .ok_or(ProgramError::InvalidInstructionData)?;
      Ok(Self { event_id })
   }
}
