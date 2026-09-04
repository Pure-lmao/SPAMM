use core::result::Result;

use pinocchio::error::ProgramError;
use spamm_aggregator::state::EventId;

/// Exact wire length for `close_event` instruction data (`event_id` only).
pub const CLOSE_EVENT_IX_DATA_LEN: usize = EventId::WIRE_SIZE;

#[inline(always)]
pub fn decode_close_event_id(data: &[u8]) -> Result<EventId, ProgramError> {
   EventId::decode(data).ok_or(ProgramError::InvalidInstructionData)
}
