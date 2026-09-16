use core::result::Result;

use pinocchio::error::ProgramError;
use spamm_aggregator::state::MarketId;

use crate::state::account_oracle::{BETTOR_PUBKEY_LEN, MAX_PROMO_ALLOWED};

/// Fixed prefix after the router `u8`, then `n * 32` allowed-user pubkeys.
pub const INIT_MARKET_IX_HEADER_LEN: usize = MarketId::WIRE_SIZE + 4 + 4 + 1 + 3 + 8 + 8;

#[repr(C)]
pub struct InitMarketIxPayload<'a> {
   pub market_id_bytes: [u8; MarketId::WIRE_SIZE],
   pub event_start_time: u32,
   pub parlay_factor: u32,
   pub market_outcomes: u8,
   pub max_amount: u64,
   pub max_total_amount: u64,
   pub allowed: &'a [u8],
}

impl<'a> InitMarketIxPayload<'a> {
   pub fn decode(data: &'a [u8]) -> Result<Self, ProgramError> {
      if data.len() < INIT_MARKET_IX_HEADER_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let allowed = &data[INIT_MARKET_IX_HEADER_LEN..];
      if allowed.len() % BETTOR_PUBKEY_LEN != 0 {
         return Err(ProgramError::InvalidInstructionData);
      }
      let n = allowed.len() / BETTOR_PUBKEY_LEN;
      if n > MAX_PROMO_ALLOWED {
         return Err(ProgramError::InvalidInstructionData);
      }

      let market_id_bytes: [u8; MarketId::WIRE_SIZE] = data[..MarketId::WIRE_SIZE]
         .try_into()
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      let off = MarketId::WIRE_SIZE;
      let event_start_time = u32::from_le_bytes(data[off..off + 4].try_into().unwrap());
      let parlay_factor = u32::from_le_bytes(data[off + 4..off + 8].try_into().unwrap());
      let market_outcomes = data[off + 8];
      let max_off = off + 12;
      let max_amount = u64::from_le_bytes(data[max_off..max_off + 8].try_into().unwrap());
      let max_total_amount = u64::from_le_bytes(data[max_off + 8..max_off + 16].try_into().unwrap());

      Ok(Self {
         market_id_bytes,
         event_start_time,
         parlay_factor,
         market_outcomes,
         max_amount,
         max_total_amount,
         allowed,
      })
   }
}
