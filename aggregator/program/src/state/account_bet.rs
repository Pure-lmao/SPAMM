use pinocchio::{Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::state::{EventGameState, MarketId, ids::MARKET_ID_LEN, other::EVENT_GAME_STATE_LEN};

pub const BET_ACCOUNT_SEED: &[u8] = b"bet";
pub const BET_ACCOUNT_DISCRIMINATOR: u8 = 1;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct BetFiller {
   pub mm_address: Address,
   pub amount: u64,
   pub odds_scaled: u32,
   pub is_potentially_netted: bool,
   pub encumbrance_delta: i64,
}

#[repr(u8)]
#[derive(Copy, Clone, ZeroPod, PartialEq, Eq)]
pub enum BetResult {
   Pending = 0,
   Won = 1,
   Lost = 2,
   HalfWon = 3,
   HalfLost = 4,
   Push = 5,
   Cancelled = 6,
   RolledBack = 7
}

impl BetResult {
   #[inline(always)]
   pub fn from_u8(value: u8) -> Self {
      match value {
        0 => Self::Pending,
        1 => Self::Won,
        2 => Self::Lost,
        3 => Self::HalfWon,
        4 => Self::HalfLost,
        5 => Self::Push,
        6 => Self::Cancelled,
        7 => Self::RolledBack,
         _ => panic!("Invalid BetResult value: {}", value),
      }
   }
}
/// Account body layout. [`zeropod`](https://github.com/blueshift-gg/zeropod) does not support
/// `[T; N]` validation for nested `T`, so MM filler slots are five named fields instead of an array.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct BetAccountData {
   pub discriminator: u8,
   pub bump: u8,
   pub owner: Address,
   pub feepayer: Address,
   pub bet_id: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub amount: u64,
   pub payout: u64,
   pub timestamp: u32,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
   pub result: BetResult,
   pub filler_0: BetFiller,
   pub filler_1: BetFiller,
   pub filler_2: BetFiller,
   pub filler_3: BetFiller,
   pub filler_4: BetFiller,
}

pub const BET_ACCOUNT_LEN: u64 = <BetAccountData as ZeroPodFixed>::SIZE as u64;
pub const BET_RESULT_OFFSET: usize = 1+1+32+32+8+MARKET_ID_LEN+1+8+8+4+2+EVENT_GAME_STATE_LEN;

impl BetFiller {
   #[inline(always)]
   pub(crate) fn to_zc(self) -> BetFillerZc {
      BetFillerZc {
         mm_address: self.mm_address,
         amount: self.amount.into(),
         odds_scaled: self.odds_scaled.into(),
         is_potentially_netted: self.is_potentially_netted.into(),
         encumbrance_delta: self.encumbrance_delta.into(),
      }
   }
}

impl BetAccountData {
   #[inline(always)]
   fn to_zc(self) -> BetAccountDataZc {
      BetAccountDataZc {
         discriminator: self.discriminator,
         bump: self.bump,
         owner: self.owner,
         feepayer: self.feepayer,
         bet_id: self.bet_id.into(),
         market_id: self.market_id.to_zc(),
         side: self.side,
         amount: self.amount.into(),
         payout: self.payout.into(),
         timestamp: self.timestamp.into(),
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
         result: self.result.into(),
         filler_0: self.filler_0.to_zc(),
         filler_1: self.filler_1.to_zc(),
         filler_2: self.filler_2.to_zc(),
         filler_3: self.filler_3.to_zc(),
         filler_4: self.filler_4.to_zc(),
      }
   }

   #[inline(always)]
   pub fn write_to_account(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      let len = <Self as ZeroPodFixed>::SIZE;
      if out.len() != len {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }

   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != BET_ACCOUNT_LEN as usize {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;      
      Ok(Self {
         discriminator: zc.discriminator,
         bump: zc.bump,
         owner: zc.owner,
         feepayer: zc.feepayer,
         bet_id: zc.bet_id.get(),
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidInstructionData)?,
         side: zc.side,
         amount: zc.amount.get(),
         payout: zc.payout.get(),
         timestamp: zc.timestamp.get(),
         event_state_sequence: zc.event_state_sequence.get(),
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
         result: BetResult::from_u8(zc.result.get()),
         filler_0: BetFiller {
            mm_address: zc.filler_0.mm_address,
            amount: zc.filler_0.amount.get(),
            odds_scaled: zc.filler_0.odds_scaled.get(),
            is_potentially_netted: zc.filler_0.is_potentially_netted.get(),
            encumbrance_delta: zc.filler_0.encumbrance_delta.get(),
         },
         filler_1: BetFiller {
            mm_address: zc.filler_1.mm_address,
            amount: zc.filler_1.amount.get(),
            odds_scaled: zc.filler_1.odds_scaled.get(),
            is_potentially_netted: zc.filler_1.is_potentially_netted.get(),
            encumbrance_delta: zc.filler_1.encumbrance_delta.get(),
         },
         filler_2: BetFiller {
            mm_address: zc.filler_2.mm_address,
            amount: zc.filler_2.amount.get(),
            odds_scaled: zc.filler_2.odds_scaled.get(),
            is_potentially_netted: zc.filler_2.is_potentially_netted.get(),
            encumbrance_delta: zc.filler_2.encumbrance_delta.get(),
         },
         filler_3: BetFiller {
            mm_address: zc.filler_3.mm_address,
            amount: zc.filler_3.amount.get(),
            odds_scaled: zc.filler_3.odds_scaled.get(),
            is_potentially_netted: zc.filler_3.is_potentially_netted.get(),
            encumbrance_delta: zc.filler_3.encumbrance_delta.get(),
         },
         filler_4: BetFiller {
            mm_address: zc.filler_4.mm_address,
            amount: zc.filler_4.amount.get(),
            odds_scaled: zc.filler_4.odds_scaled.get(),
            is_potentially_netted: zc.filler_4.is_potentially_netted.get(),
            encumbrance_delta: zc.filler_4.encumbrance_delta.get(),
         },
      })   
   }
}
