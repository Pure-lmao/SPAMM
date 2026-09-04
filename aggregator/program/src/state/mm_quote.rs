use pinocchio::{AccountView, Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use core::mem::offset_of;

use crate::{
   constants::{ADDRESS_LEN, MAX_PARLAY_LEGS, U32_LEN, U64_LEN},
   readers::{read_u32_le_unchecked, read_u64_le_unchecked},
   state::{EventGameState, MarketId},
};

pub struct MMQuote<'a> {
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub mm_address: &'a Address,
   pub mm_token_account: &'a AccountView,
   pub netting_pda_index: usize,
   pub mm_quote_buffer: &'a AccountView,
   pub mm_config_pda: &'a AccountView,
   pub mm_market_data_pda: &'a AccountView,
   pub mm_event_state_pda: &'a AccountView,
   pub encumbrance_pda_index: usize,
   pub encumbrance_pda_bump: u8,
   pub mm_liability_token_account: &'a AccountView,
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct MMQuoteBuffer {
   pub discriminator: u8,
   pub is_used: u8,
   pub user_address: Address,
   pub market_id: MarketId,
   pub side: u8,
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub event_game_state: EventGameState,
   pub event_state_sequence: u16,
}

pub const MM_QUOTE_BUFFER_DISCRIMINATOR: u8 = 102;

pub const MM_QUOTE_BUFFER_LEN: usize = <MMQuoteBuffer as ZeroPodFixed>::SIZE;

impl MMQuoteBuffer {
   pub const IS_USED_OFFSET: usize = offset_of!(MMQuoteBufferZc, is_used);

   #[inline(always)]
   pub fn to_zc(&self) -> MMQuoteBufferZc {
      MMQuoteBufferZc {
         discriminator: self.discriminator,
         is_used: self.is_used,
         user_address: self.user_address,
         market_id: self.market_id.to_zc(),
         side: self.side,
         max_amount: self.max_amount.into(),
         odds_scaled: self.odds_scaled.into(),
         event_game_state: self.event_game_state.to_zc(),
         event_state_sequence: self.event_state_sequence.into(),
      }
   }

   #[inline(always)]
   pub fn from_zc(zc: &MMQuoteBufferZc) -> Option<Self> {
      Some(Self {
         discriminator: zc.discriminator,
         is_used: zc.is_used,
         user_address: zc.user_address,
         market_id: MarketId::from_zc(&zc.market_id)?,
         side: zc.side,
         max_amount: zc.max_amount.into(),
         odds_scaled: zc.odds_scaled.into(),
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
         event_state_sequence: zc.event_state_sequence.into(),
      })
   }

   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != MM_QUOTE_BUFFER_LEN {
         return Err(ProgramError::InvalidAccountData);
      }
      if data[0] != MM_QUOTE_BUFFER_DISCRIMINATOR {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data).map_err(|_| ProgramError::InvalidInstructionData)?;
      Self::from_zc(zc).ok_or(ProgramError::InvalidAccountData)
   }

   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != MM_QUOTE_BUFFER_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}

#[repr(C)]
pub struct QuoteData {
   _max_amount: u64,
   _odds_scaled: u32,
}

pub const QUOTE_DATA_MAX_AMOUNT_OFFSET: usize = offset_of!(QuoteData, _max_amount);
pub const QUOTE_DATA_ODDS_SCALED_OFFSET: usize = offset_of!(QuoteData, _odds_scaled);
/// Packed CPI return (`u64` + `u32`). `repr(C)` may pad the in-memory type past the wire size.
pub const QUOTE_DATA_LEN: usize = QUOTE_DATA_ODDS_SCALED_OFFSET + U32_LEN;

impl QuoteData {
   /// Peek `max_amount` and `odds_scaled` from the packed MM `get_quote` return.
   #[inline(always)]
   pub fn read_max_amount_and_odds(data: &[u8]) -> Result<(u64, u32), ProgramError> {
      if data.len() != QUOTE_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let amt = unsafe { read_u64_le_unchecked(data.as_ptr(), QUOTE_DATA_MAX_AMOUNT_OFFSET) };
      let odds = unsafe { read_u32_le_unchecked(data.as_ptr(), QUOTE_DATA_ODDS_SCALED_OFFSET) };
      Ok((amt, odds))
   }
}

#[repr(C)]
#[derive(Copy, Clone, ZeroPod)]
pub struct ProxyQuoteData {
   pub mm_address: Address,
   pub max_amount: u64,
   pub odds_scaled: u32,
}

pub const PROXY_QUOTE_DATA_LEN: usize = <ProxyQuoteData as ZeroPodFixed>::SIZE;

/// Packed header for parlay quote return (no pad). Trailing `u32` leg odds follow.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct GetParlayQuoteReturnHeader {
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub num_legs: u8,
}

pub const PARLAY_QUOTE_RETURN_HEADER_LEN: usize =
   <GetParlayQuoteReturnHeader as ZeroPodFixed>::SIZE;

/// Parlay MM CPI / proxy return payload (`get_quote_parlay`).
/// Wire: header + `leg_odds(u32) × num_legs` (no pad).
#[derive(Clone)]
pub struct GetParlayQuoteReturnWire {
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub num_legs: u8,
   pub leg_odds: [u32; MAX_PARLAY_LEGS],
}

#[inline(always)]
pub const fn parlay_quote_return_wire_len(num_legs: usize) -> usize {
   PARLAY_QUOTE_RETURN_HEADER_LEN + num_legs * U32_LEN
}

/// Max return wire size (header + [`MAX_PARLAY_LEGS`](crate::constants::MAX_PARLAY_LEGS) odds).
pub const PARLAY_QUOTE_RETURN_WIRE_LEN: usize =
   PARLAY_QUOTE_RETURN_HEADER_LEN + MAX_PARLAY_LEGS * U32_LEN;

impl GetParlayQuoteReturnWire {
   #[inline(always)]
   pub fn live_leg_odds(&self) -> &[u32] {
      &self.leg_odds[..self.num_legs as usize]
   }

   /// Decode header + live odds into `odds_out` (must be at least `num_legs` long).
   pub fn decode_into(
      data: &[u8],
      odds_out: &mut [u32],
   ) -> Result<(u64, u32, u8), ProgramError> {
      if data.len() < PARLAY_QUOTE_RETURN_HEADER_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <GetParlayQuoteReturnHeader as ZeroPodFixed>::from_bytes(
         &data[..PARLAY_QUOTE_RETURN_HEADER_LEN],
      )
      .map_err(|_| ProgramError::InvalidInstructionData)?;
      let num_legs = zc.num_legs as usize;
      if num_legs > MAX_PARLAY_LEGS || odds_out.len() < num_legs {
         return Err(ProgramError::InvalidInstructionData);
      }
      let expected = parlay_quote_return_wire_len(num_legs);
      if data.len() != expected {
         return Err(ProgramError::InvalidInstructionData);
      }
      for i in 0..num_legs {
         let off = PARLAY_QUOTE_RETURN_HEADER_LEN + i * U32_LEN;
         odds_out[i] = unsafe { read_u32_le_unchecked(data.as_ptr(), off) };
      }
      Ok((zc.max_amount.get(), zc.odds_scaled.get(), zc.num_legs))
   }

   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      let mut leg_odds = [0u32; MAX_PARLAY_LEGS];
      let (max_amount, odds_scaled, num_legs) = Self::decode_into(data, &mut leg_odds)?;
      Ok(Self {
         max_amount,
         odds_scaled,
         num_legs,
         leg_odds,
      })
   }

   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      let n = self.num_legs as usize;
      let expected = parlay_quote_return_wire_len(n);
      if out.len() != expected || n > MAX_PARLAY_LEGS {
         return Err(ProgramError::InvalidInstructionData);
      }
      let hzc = GetParlayQuoteReturnHeaderZc {
         max_amount: self.max_amount.into(),
         odds_scaled: self.odds_scaled.into(),
         num_legs: self.num_legs,
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), hzc);
      }
      for i in 0..n {
         let off = PARLAY_QUOTE_RETURN_HEADER_LEN + i * U32_LEN;
         out[off..off + U32_LEN].copy_from_slice(&self.leg_odds[i].to_le_bytes());
      }
      Ok(())
   }
}

/// One MM parlay quote from `get_parlay_quote_proxy` return data (unpadded leg odds).
#[derive(Clone)]
pub struct ProxyParlayQuoteData {
   pub mm_address: Address,
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub num_legs: u8,
   pub leg_odds: [u32; MAX_PARLAY_LEGS],
}

pub const PROXY_PARLAY_QUOTE_HEADER_LEN: usize =
   ADDRESS_LEN + U64_LEN + U32_LEN + 1;

#[inline(always)]
pub const fn proxy_parlay_quote_data_len(num_legs: usize) -> usize {
   PROXY_PARLAY_QUOTE_HEADER_LEN + num_legs * U32_LEN
}

/// Max proxy entry size.
pub const PROXY_PARLAY_QUOTE_DATA_LEN: usize =
   PROXY_PARLAY_QUOTE_HEADER_LEN + MAX_PARLAY_LEGS * U32_LEN;

impl ProxyParlayQuoteData {
   #[inline(always)]
   pub fn live_leg_odds(&self) -> &[u32] {
      &self.leg_odds[..self.num_legs as usize]
   }

   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      let n = self.num_legs as usize;
      let expected = proxy_parlay_quote_data_len(n);
      if out.len() != expected {
         return Err(ProgramError::InvalidInstructionData);
      }
      out[0..ADDRESS_LEN].copy_from_slice(self.mm_address.as_ref());
      out[ADDRESS_LEN..ADDRESS_LEN + U64_LEN].copy_from_slice(&self.max_amount.to_le_bytes());
      out[ADDRESS_LEN + U64_LEN..ADDRESS_LEN + U64_LEN + U32_LEN]
         .copy_from_slice(&self.odds_scaled.to_le_bytes());
      out[ADDRESS_LEN + U64_LEN + U32_LEN] = self.num_legs;
      for i in 0..n {
         let off = PROXY_PARLAY_QUOTE_HEADER_LEN + i * U32_LEN;
         out[off..off + U32_LEN].copy_from_slice(&self.leg_odds[i].to_le_bytes());
      }
      Ok(())
   }
}

/// One side odds value in `get_market_quotes_proxy` return data (`odds_scaled` only).
#[repr(C)]
#[derive(Copy, Clone, ZeroPod)]
pub struct ProxyMarketSideOdds {
   pub odds_scaled: u32,
}
pub const PROXY_MARKET_SIDE_ODDS_WIRE_LEN: usize = <ProxyMarketSideOdds as ZeroPodFixed>::SIZE;

pub const MARKET_QUOTES_PROXY_RETURN_MAX: usize = 1024;

#[inline(always)]
pub fn proxy_market_mm_entry_wire_len(num_sides: u8) -> usize {
   ADDRESS_LEN + (num_sides as usize) * PROXY_MARKET_SIDE_ODDS_WIRE_LEN
}

/// Max MM rows that fit in return data for `num_sides` (≤ [`crate::constants::MAX_NUMBER_OF_MMS_PROXY`]).
#[inline(always)]
pub fn max_proxy_mms_for_market_quotes(num_sides: u8) -> usize {
   if num_sides == 0 {
      return 0;
   }
   let entry = proxy_market_mm_entry_wire_len(num_sides);
   MARKET_QUOTES_PROXY_RETURN_MAX / entry
}