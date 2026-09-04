use core::result::Result;

use pinocchio::error::ProgramError;
use spamm_aggregator::state::{MARKET_ID_LEN, market_id_pda_seed_parts};

/// Exact wire length for `close_market` instruction data (`MarketId` wire only).
pub const CLOSE_MARKET_IX_DATA_LEN: usize = MARKET_ID_LEN;

/// Length-checked `MarketId` wire; split at the operator offset for PDA seeds.
#[inline(always)]
pub fn decode_close_market_wire(data: &[u8]) -> Result<&[u8; MARKET_ID_LEN], ProgramError> {
   if data.len() != CLOSE_MARKET_IX_DATA_LEN {
      return Err(ProgramError::InvalidInstructionData);
   }
   let wire = unsafe { &*(data.as_ptr().cast::<[u8; MARKET_ID_LEN]>()) };
   let (_body, operator) = market_id_pda_seed_parts(wire);
   if operator.len() != 32 {
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(wire)
}
