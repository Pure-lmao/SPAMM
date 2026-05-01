use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use spamm_aggregator::state::{FillQuoteIxData, MarketId};

/// Fill-quote instruction payload (bytes after the router discriminator in `lib.rs`), matching
/// `FillQuoteIxData` minus `instruction_discriminator`.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillQuoteIxPayload {
   pub amount_to_fill: u64,
   pub odds_scaled: u32,
   pub market_id: MarketId,
   pub side: u8,
   pub event_state_hash: [u8; 32],
   pub event_state_sequence: u16,
   pub amount_to_send: u64,
}

pub const FILL_QUOTE_IX_PAYLOAD_LEN: usize = <FillQuoteIxPayload as ZeroPodFixed>::SIZE;

impl FillQuoteIxPayload {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != FILL_QUOTE_IX_PAYLOAD_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         side: zc.side,
         event_state_sequence: zc.event_state_sequence.get(),
         amount_to_fill: zc.amount_to_fill.get(),
         odds_scaled: zc.odds_scaled.get(),
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidInstructionData)?,
         event_state_hash: zc.event_state_hash,
         amount_to_send: zc.amount_to_send.get(),
      })
   }
}

const _: () = assert!(FILL_QUOTE_IX_PAYLOAD_LEN == FillQuoteIxData::WIRE_LEN - 1);
