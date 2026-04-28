use pinocchio::{AccountView, Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::state::MarketId;

pub struct MMQuote<'a> {
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub mm_address: Address,
   pub mm_token_account: &'a AccountView,
   pub netting_pda: &'a AccountView,
   pub mm_quote_buffer: &'a AccountView,
   pub mm_config_pda: &'a AccountView,
   pub mm_market_data_pda: &'a AccountView,
   pub mm_liability_token_account: &'a AccountView,
}


#[derive(Copy, Clone, ZeroPod)]
pub struct MMQuoteBuffer {
   pub discriminator: u8,
   pub is_used: u8,
   pub user_address: Address,
   pub market_id: MarketId,
   pub side: u8,
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub event_state_hash: [u8; 32],
   pub event_state_sequence: u16,
}

pub const MM_QUOTE_BUFFER_DISCRIMINATOR: u8 = 2;

pub const MM_QUOTE_BUFFER_LEN: usize = <MMQuoteBuffer as ZeroPodFixed>::SIZE;
const _: () = assert!(MM_QUOTE_BUFFER_LEN == 108);

impl MMQuoteBuffer {
   #[inline(always)]
   pub fn to_zc(self) -> MMQuoteBufferZc {
      MMQuoteBufferZc {
         discriminator: self.discriminator,
         is_used: self.is_used,
         user_address: self.user_address,
         market_id: self.market_id.to_zc(false),
         side: self.side,
         max_amount: self.max_amount.into(),
         odds_scaled: self.odds_scaled.into(),
         event_state_hash: self.event_state_hash,
         event_state_sequence: self.event_state_sequence.into(),
      }
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
}

pub struct QuoteData {
   _max_amount: u64,
   _odds_scaled: u32,
}

pub const QUOTE_DATA_MAX_AMOUNT_OFFSET: usize = 0;
pub const QUOTE_DATA_ODDS_SCALED_OFFSET: usize = 8;
pub const QUOTE_DATA_LEN: usize = 12;