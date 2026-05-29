use pinocchio::{AccountView, Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::state::{EventGameState, MarketId};

pub struct MMQuote<'a> {
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub mm_address: Address,
   pub mm_token_account: &'a AccountView,
   pub netting_pda: &'a AccountView,
   pub mm_quote_buffer: &'a AccountView,
   pub mm_config_pda: &'a AccountView,
   pub mm_market_data_pda: &'a AccountView,
   pub encumbrance_pda_index: usize,
   pub encumbrance_pda_bump: u8,
   pub mm_liability_token_account: &'a AccountView,
}

/// Collected MM quote for a parlay fill (no netting PDA).
pub struct MMQuoteParlay<'a> {
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub mm_address: Address,
   pub mm_token_account: &'a AccountView,
   pub mm_parlay_quote_buffer: &'a AccountView,
   pub mm_config_pda: &'a AccountView,
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

pub const MM_QUOTE_BUFFER_DISCRIMINATOR: u8 = 2;

pub const MM_QUOTE_BUFFER_LEN: usize = <MMQuoteBuffer as ZeroPodFixed>::SIZE;

impl MMQuoteBuffer {
   #[inline(always)]
   pub fn to_zc(self) -> MMQuoteBufferZc {
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
   pub fn from_zc(zc: &MMQuoteBufferZc) -> Self {
      Self {
         discriminator: zc.discriminator,
         is_used: zc.is_used,
         user_address: zc.user_address,
         market_id: MarketId::from_zc(&zc.market_id).unwrap(),
         side: zc.side,
         max_amount: zc.max_amount.into(),
         odds_scaled: zc.odds_scaled.into(),
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
         event_state_sequence: zc.event_state_sequence.into(),
      }
   }

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      let zc = <Self as ZeroPodFixed>::from_bytes(data).map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self::from_zc(zc))
   }

   #[inline(always)]
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

   #[inline(always)]
   pub fn from_bytes(bytes: &[u8]) -> Result<Self, ProgramError> {
      let zc = <Self as ZeroPodFixed>::from_bytes(bytes).map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self::from_zc(zc))
   }
}

#[repr(C)]
pub struct QuoteData {
   _max_amount: u64,
   _odds_scaled: u32,
}

pub const QUOTE_DATA_MAX_AMOUNT_OFFSET: usize = 0;
pub const QUOTE_DATA_ODDS_SCALED_OFFSET: usize = 8;
pub const QUOTE_DATA_LEN: usize = 12;

#[repr(C)]
#[derive(Copy, Clone, ZeroPod)]
pub struct ProxyQuoteData {
   pub mm_address: Address,
   pub max_amount: u64,
   pub odds_scaled: u32,
}

pub const PROXY_QUOTE_DATA_LEN: usize = <ProxyQuoteData as ZeroPodFixed>::SIZE;

/// In-memory `repr(C)` size may exceed wire (`u32` tail padding); return data is packed at `PROXY_QUOTE_DATA_LEN`.
const _: () = assert!(core::mem::size_of::<ProxyQuoteData>() >= PROXY_QUOTE_DATA_LEN);

/// One side odds value in `get_market_quotes_proxy` return data (`odds_scaled` only).
#[repr(C)]
#[derive(Copy, Clone, ZeroPod)]
pub struct ProxyMarketSideOdds {
   pub odds_scaled: u32,
}
pub const PROXY_MARKET_SIDE_ODDS_WIRE_LEN: usize = <ProxyMarketSideOdds as ZeroPodFixed>::SIZE;

pub const MARKET_QUOTES_PROXY_RETURN_MAX: usize = 1024;
pub const PROXY_MM_MARKET_QUOTES_ADDR_LEN: usize = 32;

#[inline(always)]
pub fn proxy_market_mm_entry_wire_len(num_sides: u8) -> usize {
   PROXY_MM_MARKET_QUOTES_ADDR_LEN + (num_sides as usize) * PROXY_MARKET_SIDE_ODDS_WIRE_LEN
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

const _: () = assert!(15 * (32 + 9 * 4) <= MARKET_QUOTES_PROXY_RETURN_MAX);
const _: () = assert!(20 * (32 + 2 * 4) <= MARKET_QUOTES_PROXY_RETURN_MAX);