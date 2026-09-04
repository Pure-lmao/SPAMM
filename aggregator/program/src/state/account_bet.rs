//! On-chain single-bet PDA layout.
//!
//! PDA seeds: **`["bet", user_address, bet_id_le]`** (see [`BET_ACCOUNT_SEED`]).
//! Layout: fixed [`BetAccountHeader`] + trailing [`BetFiller`] × `num_fillers` (no padding).

use core::mem::{MaybeUninit, offset_of};

use pinocchio::{Address, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{constants::MAX_NUMBER_OF_MMS, readers::read_address_ref_unchecked, state::{EventGameState, MarketId, ids::MARKET_ID_OPERATOR_OFFSET}};

pub const BET_ACCOUNT_SEED: &[u8] = b"bet";
pub const BET_ACCOUNT_DISCRIMINATOR: u8 = 1;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct BetFiller {
   pub mm_address: Address,
   pub amount: u64,
   /// Gross profit reserved at fill (`calc_potential_profit`). Cashout splits this
   /// so remaining + cashed always sum to the original reservation.
   pub reserved_profit: u64,
   pub odds_scaled: u32,
   pub is_potentially_netted: bool,
}

pub const BET_FILLER_LEN: usize = <BetFiller as ZeroPodFixed>::SIZE;

impl BetFiller {
   #[inline(always)]
   pub(crate) fn to_zc(&self) -> BetFillerZc {
      BetFillerZc {
         mm_address: self.mm_address,
         amount: self.amount.into(),
         reserved_profit: self.reserved_profit.into(),
         odds_scaled: self.odds_scaled.into(),
         is_potentially_netted: self.is_potentially_netted.into(),
      }
   }

   #[inline(always)]
   pub(crate) fn from_zc(z: &BetFillerZc) -> Self {
      Self {
         mm_address: z.mm_address,
         amount: z.amount.get(),
         reserved_profit: z.reserved_profit.get(),
         odds_scaled: z.odds_scaled.get(),
         is_potentially_netted: z.is_potentially_netted.get(),
      }
   }
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
   RolledBack = 7,
   /// Parlay ticket with void and/or half legs; settle recomputes payout from leg odds.
   ModifiedWin = 8,
   /// 100% live cashout: escrow exists; not settleable until claim or revert.
   CashedOut = 9,
}

/// `grade_parlay` ix: skip updating this leg slot.
pub const GRADE_PARLAY_LEG_SKIP: u8 = 255;

impl BetResult {
   #[inline(always)]
   pub fn from_u8(value: u8) -> Result<Self, ProgramError> {
      match value {
         0 => Ok(Self::Pending),
         1 => Ok(Self::Won),
         2 => Ok(Self::Lost),
         3 => Ok(Self::HalfWon),
         4 => Ok(Self::HalfLost),
         5 => Ok(Self::Push),
         6 => Ok(Self::Cancelled),
         7 => Ok(Self::RolledBack),
         8 => Ok(Self::ModifiedWin),
         9 => Ok(Self::CashedOut),
         _ => {
            log!("invalid BetResult byte");
            Err(ProgramError::InvalidAccountData)
         }
      }
   }

   /// Leg/ticket grade bytes accepted by `grade_bets` / `grade_parlay` (1..=7; excludes `Pending`, `ModifiedWin`, and `CashedOut`).
   #[inline(always)]
   pub fn try_from_grade_byte(value: u8) -> Option<Self> {
      match value {
         1..=7 => Self::from_u8(value).ok(),
         _ => None,
      }
   }

   #[inline(always)]
   pub fn is_void_like(self) -> bool {
      matches!(self, Self::Push | Self::Cancelled | Self::RolledBack)
   }

   #[inline(always)]
   pub fn is_half(self) -> bool {
      matches!(self, Self::HalfWon | Self::HalfLost)
   }
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct BetAccountHeader {
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
   pub freebet_id: u32,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
   pub result: BetResult,
   pub num_fillers: u8,
}

pub const BET_ACCOUNT_HEADER_LEN: usize = <BetAccountHeader as ZeroPodFixed>::SIZE;
pub const BET_ACCOUNT_BUMP_OFFSET: usize = offset_of!(BetAccountHeaderZc, bump);
pub const BET_MARKET_ID_OFFSET: usize = offset_of!(BetAccountHeaderZc, market_id);
pub const BET_OPERATOR_OFFSET: usize = BET_MARKET_ID_OFFSET + MARKET_ID_OPERATOR_OFFSET;
pub const BET_AMOUNT_OFFSET: usize = offset_of!(BetAccountHeaderZc, amount);
pub const BET_PAYOUT_OFFSET: usize = offset_of!(BetAccountHeaderZc, payout);
pub const BET_RESULT_OFFSET: usize = offset_of!(BetAccountHeaderZc, result);

pub const BET_ACCOUNT_MIN_LEN: usize = BET_ACCOUNT_HEADER_LEN + BET_FILLER_LEN;
pub const BET_ACCOUNT_MAX_LEN: usize =
   BET_ACCOUNT_HEADER_LEN + MAX_NUMBER_OF_MMS * BET_FILLER_LEN;

#[inline(always)]
pub const fn bet_account_len(num_fillers: usize) -> usize {
   BET_ACCOUNT_HEADER_LEN + num_fillers * BET_FILLER_LEN
}

/// Owned view used by fill/settle (fillers packed at the front of a max-sized buffer).
#[derive(Clone)]
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
   pub freebet_id: u32,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
   pub result: BetResult,
   pub num_fillers: u8,
   /// Only `0..num_fillers` are meaningful.
   pub fillers: [BetFiller; MAX_NUMBER_OF_MMS],
}

impl BetAccountData {
   #[inline(always)]
   fn header_to_zc(h: &BetAccountHeader) -> BetAccountHeaderZc {
      BetAccountHeaderZc {
         discriminator: h.discriminator,
         bump: h.bump,
         owner: h.owner,
         feepayer: h.feepayer,
         bet_id: h.bet_id.into(),
         market_id: h.market_id.to_zc(),
         side: h.side,
         amount: h.amount.into(),
         payout: h.payout.into(),
         timestamp: h.timestamp.into(),
         freebet_id: h.freebet_id.into(),
         event_state_sequence: h.event_state_sequence.into(),
         event_game_state: h.event_game_state.to_zc(),
         result: h.result.into(),
         num_fillers: h.num_fillers,
      }
   }

   #[inline(always)]
   pub fn decode_header(data: &[u8]) -> Result<BetAccountHeader, ProgramError> {
      if unlikely(data.len() < BET_ACCOUNT_MIN_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data[0] != BET_ACCOUNT_DISCRIMINATOR) {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <BetAccountHeader as ZeroPodFixed>::from_bytes(&data[..BET_ACCOUNT_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidAccountData)?;
      let header = BetAccountHeader {
         discriminator: zc.discriminator,
         bump: zc.bump,
         owner: zc.owner,
         feepayer: zc.feepayer,
         bet_id: zc.bet_id.get(),
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidAccountData)?,
         side: zc.side,
         amount: zc.amount.get(),
         payout: zc.payout.get(),
         timestamp: zc.timestamp.get(),
         freebet_id: zc.freebet_id.get(),
         event_state_sequence: zc.event_state_sequence.get(),
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
         result: BetResult::from_u8(zc.result.get())?,
         num_fillers: zc.num_fillers,
      };
      let n = header.num_fillers as usize;
      if unlikely(n < 1 || n > MAX_NUMBER_OF_MMS) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data.len() != bet_account_len(n)) {
         return Err(ProgramError::InvalidAccountData);
      }
      Ok(header)
   }

   #[inline(always)]
   pub unsafe fn read_operator<'a>(ptr: *const u8) -> &'a Address {
      read_address_ref_unchecked(ptr, BET_OPERATOR_OFFSET)
   }

   pub fn decode_fillers_into(
      data: &[u8],
      n: usize,
      out: &mut [MaybeUninit<BetFiller>],
   ) -> Result<(), ProgramError> {
      if unlikely(n < 1 || n > MAX_NUMBER_OF_MMS || out.len() < n) {
         return Err(ProgramError::InvalidAccountData);
      }
      for i in 0..n {
         out[i].write(Self::decode_filler(data, i)?);
      }
      Ok(())
   }

   fn decode_filler(data: &[u8], filler_i: usize) -> Result<BetFiller, ProgramError> {
      let off = BET_ACCOUNT_HEADER_LEN
         .checked_add(filler_i.checked_mul(BET_FILLER_LEN).ok_or(ProgramError::ArithmeticOverflow)?).ok_or(ProgramError::ArithmeticOverflow)?;
      let end = off
         .checked_add(BET_FILLER_LEN).ok_or(ProgramError::ArithmeticOverflow)?;
      if unlikely(end > data.len()) {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <BetFiller as ZeroPodFixed>::from_bytes(&data[off..end])
         .map_err(|_| ProgramError::InvalidAccountData)?;
      Ok(BetFiller::from_zc(zc))
   }

   #[inline(always)]
   pub fn write_header_and_fillers(
      out: &mut [u8],
      header: &BetAccountHeader,
      fillers: &[BetFiller],
   ) -> Result<(), ProgramError> {
      let n = header.num_fillers as usize;
      let expected = bet_account_len(n);
      if unlikely(out.len() != expected || n < 1 || n > MAX_NUMBER_OF_MMS || fillers.len() < n) {
         return Err(ProgramError::InvalidAccountData);
      }
      let hzc = Self::header_to_zc(header);
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), hzc);
      }
      for i in 0..n {
         let off = BET_ACCOUNT_HEADER_LEN + i * BET_FILLER_LEN;
         let zc = fillers[i].to_zc();
         unsafe {
            core::ptr::write(out.as_mut_ptr().add(off).cast(), zc);
         }
      }
      Ok(())
   }
}
