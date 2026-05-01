use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use spamm_aggregator::state::{GetQuoteIxData, MarketId};

/// Get-quote instruction payload (bytes after the router discriminator in `lib.rs`), matching
/// `GetQuoteIxData` minus `instruction_discriminator`
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct GetQuoteIxPayload {
   pub amount: u64,
   pub odds_scaled: u32,
   pub market_id: MarketId,
   pub side: u8,
   pub event_state_hash: [u8; 32],
   pub event_state_sequence: u16,
}

pub const GET_QUOTE_IX_PAYLOAD_LEN: usize = <GetQuoteIxPayload as ZeroPodFixed>::SIZE;

impl GetQuoteIxPayload {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != GET_QUOTE_IX_PAYLOAD_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         side: zc.side,
         event_state_sequence: zc.event_state_sequence.get(),
         odds_scaled: zc.odds_scaled.get(),
         amount: zc.amount.get(),
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidInstructionData)?,
         event_state_hash: zc.event_state_hash,
      })
   }
}

// MM `data` tail must match aggregator CPI: full `GetQuoteIxData` wire is discrim + this payload.
const _: () = assert!(GET_QUOTE_IX_PAYLOAD_LEN == GetQuoteIxData::WIRE_LEN - 1);
