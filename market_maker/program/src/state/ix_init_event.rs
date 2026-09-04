use core::result::Result;

use pinocchio::error::ProgramError;
use spamm_aggregator::state::EventId;

/// Minimum bytes after the router `u8` (`event_id` only; body may be empty or any length).
pub const INIT_EVENT_IX_DATA_MIN_LEN: usize = EventId::WIRE_SIZE;

/// Decoded from variable-length instruction data: `event_id` wire then the MM **body** bytes
/// (copied after the [`spamm_aggregator::state::EVENT_STATE_HEADER_LEN`] header).
#[repr(C)]
pub struct InitEventIxPayload<'a> {
   pub event_id: EventId,
   pub event_body: &'a [u8],
}

impl<'a> InitEventIxPayload<'a> {
   pub const WIRE_MIN: usize = INIT_EVENT_IX_DATA_MIN_LEN;

   pub fn decode(data: &'a [u8]) -> Result<Self, ProgramError> {
      if data.len() < Self::WIRE_MIN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let event_id = EventId::decode(&data[..EventId::WIRE_SIZE])
         .ok_or(ProgramError::InvalidInstructionData)?;
      let event_body = &data[EventId::WIRE_SIZE..];
      Ok(Self {
         event_id,
         event_body,
      })
   }
}
