use core::result::Result;

use pinocchio::error::ProgramError;
use spamm_aggregator::state::MarketId;

/// Minimum bytes after the router `u8` in `spamm_market_maker` (`market_id` only; body may be empty or any length).
pub const INIT_MARKET_IX_DATA_MIN_LEN: usize = MarketId::WIRE_SIZE;

/// Decoded from variable-length instruction data: `market_id` wire then the oracle **body** bytes
/// (copied after the 6-byte header; account `space = 6 + max(n, 12)` so Doppler can write 12 body bytes).
#[repr(C)]
pub struct InitMarketIxPayload<'a> {
   pub market_id: MarketId,
   pub oracle_body: &'a [u8],
}

impl<'a> InitMarketIxPayload<'a> {
   pub fn decode(data: &'a [u8]) -> Result<Self, ProgramError> {
      if data.len() < INIT_MARKET_IX_DATA_MIN_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let market_id = MarketId::decode(&data[..MarketId::WIRE_SIZE])
         .ok_or(ProgramError::InvalidInstructionData)?;
      let oracle_body = &data[MarketId::WIRE_SIZE..];
      Ok(Self {
         market_id,
         oracle_body,
      })
   }
}
