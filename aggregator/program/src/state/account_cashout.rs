//! Filling-MM cashout ticket (novation of a single-bet slice).
//!
//! Seeds: **`["cashout", filling_mm, cashout_id_le]`**.
//! Layout: fixed [`CashoutAccountHeader`] + trailing [`BetFiller`] × `num_fillers`.

use core::mem::{MaybeUninit, offset_of};

use pinocchio::{Address, error::ProgramError, hint::unlikely};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::MAX_NUMBER_OF_MMS, readers::read_address_ref_unchecked, state::{
      BET_ACCOUNT_DISCRIMINATOR, BetAccountHeader, EventGameState, MarketId, account_bet::{BET_FILLER_LEN, BetFiller, BetResult}, ids::MARKET_ID_OPERATOR_OFFSET,
   },
};

pub const CASHOUT_ACCOUNT_SEED: &[u8] = b"cashout";
pub const CASHOUT_ACCOUNT_DISCRIMINATOR: u8 = 8;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct CashoutAccountHeader {
   pub discriminator: u8,
   pub bump: u8,
   pub mm: Address,
   pub feepayer: Address,
   /// Original ticket owner (user). Escrow PDA seeds stay `(user, orig_bet_id)`
   /// after the original bet PDA may have been closed.
   pub orig_owner: Address,
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub amount: u64,
   pub payout: u64,
   pub timestamp: u32,
   pub orig_event_state_sequence: u16,
   pub orig_event_game_state: EventGameState,
   pub cashout_event_state_sequence: u16,
   pub cashout_event_game_state: EventGameState,
   pub result: BetResult,
   pub num_fillers: u8,
}

pub const CASHOUT_ACCOUNT_HEADER_LEN: usize = <CashoutAccountHeader as ZeroPodFixed>::SIZE;
pub const CASHOUT_ACCOUNT_BUMP_OFFSET: usize = offset_of!(CashoutAccountHeaderZc, bump);
pub const CASHOUT_OPERATOR_OFFSET: usize = CASHOUT_MARKET_ID_OFFSET + MARKET_ID_OPERATOR_OFFSET;
pub const CASHOUT_MARKET_ID_OFFSET: usize = offset_of!(CashoutAccountHeaderZc, market_id);
pub const CASHOUT_RESULT_OFFSET: usize = offset_of!(CashoutAccountHeaderZc, result);

pub const CASHOUT_ACCOUNT_MIN_LEN: usize = CASHOUT_ACCOUNT_HEADER_LEN + BET_FILLER_LEN;
pub const CASHOUT_ACCOUNT_MAX_LEN: usize =
   CASHOUT_ACCOUNT_HEADER_LEN + MAX_NUMBER_OF_MMS * BET_FILLER_LEN;

impl CashoutAccountHeader {
   /// Settle view: `owner` = filling MM, `bet_id` = cashout_id.
   #[inline(always)]
   pub fn as_bet_header(&self) -> BetAccountHeader {
      BetAccountHeader {
         discriminator: BET_ACCOUNT_DISCRIMINATOR,
         bump: self.bump,
         owner: self.mm,
         feepayer: self.feepayer,
         bet_id: self.cashout_id,
         market_id: self.market_id,
         side: self.side,
         amount: self.amount,
         payout: self.payout,
         timestamp: self.timestamp,
         freebet_id: 0,
         event_state_sequence: self.cashout_event_state_sequence,
         event_game_state: self.cashout_event_game_state,
         result: self.result,
         num_fillers: self.num_fillers,
      }
   }
}

#[inline(always)]
pub const fn cashout_account_len(num_fillers: usize) -> usize {
   CASHOUT_ACCOUNT_HEADER_LEN + num_fillers * BET_FILLER_LEN
}

pub struct CashoutAccountData {
   pub discriminator: u8,
   pub bump: u8,
   pub mm: Address,
   pub feepayer: Address,
   pub orig_owner: Address,
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub amount: u64,
   pub payout: u64,
   pub timestamp: u32,
   pub orig_event_state_sequence: u16,
   pub orig_event_game_state: EventGameState,
   pub cashout_event_state_sequence: u16,
   pub cashout_event_game_state: EventGameState,
   pub result: BetResult,
   pub num_fillers: u8,
   pub fillers: [BetFiller; MAX_NUMBER_OF_MMS],
}

impl CashoutAccountData {
   #[inline(always)]
   fn header_to_zc(h: &CashoutAccountHeader) -> CashoutAccountHeaderZc {
      CashoutAccountHeaderZc {
         discriminator: h.discriminator,
         bump: h.bump,
         mm: h.mm,
         feepayer: h.feepayer,
         orig_owner: h.orig_owner,
         orig_bet_id: h.orig_bet_id.into(),
         cashout_id: h.cashout_id.into(),
         market_id: h.market_id.to_zc(),
         side: h.side,
         amount: h.amount.into(),
         payout: h.payout.into(),
         timestamp: h.timestamp.into(),
         orig_event_state_sequence: h.orig_event_state_sequence.into(),
         orig_event_game_state: h.orig_event_game_state.to_zc(),
         cashout_event_state_sequence: h.cashout_event_state_sequence.into(),
         cashout_event_game_state: h.cashout_event_game_state.to_zc(),
         result: h.result.into(),
         num_fillers: h.num_fillers,
      }
   }

   #[inline(always)]
   pub fn decode_header(data: &[u8]) -> Result<CashoutAccountHeader, ProgramError> {
      if unlikely(data.len() < CASHOUT_ACCOUNT_MIN_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data[0] != CASHOUT_ACCOUNT_DISCRIMINATOR) {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <CashoutAccountHeader as ZeroPodFixed>::from_bytes(&data[..CASHOUT_ACCOUNT_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidAccountData)?;
      let header = CashoutAccountHeader {
         discriminator: zc.discriminator,
         bump: zc.bump,
         mm: zc.mm,
         feepayer: zc.feepayer,
         orig_owner: zc.orig_owner,
         orig_bet_id: zc.orig_bet_id.get(),
         cashout_id: zc.cashout_id.get(),
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidAccountData)?,
         side: zc.side,
         amount: zc.amount.get(),
         payout: zc.payout.get(),
         timestamp: zc.timestamp.get(),
         orig_event_state_sequence: zc.orig_event_state_sequence.get(),
         orig_event_game_state: EventGameState::from_zc(&zc.orig_event_game_state),
         cashout_event_state_sequence: zc.cashout_event_state_sequence.get(),
         cashout_event_game_state: EventGameState::from_zc(&zc.cashout_event_game_state),
         result: BetResult::from_u8(zc.result.get())?,
         num_fillers: zc.num_fillers,
      };
      let n = header.num_fillers as usize;
      if unlikely(n < 1 || n > MAX_NUMBER_OF_MMS) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data.len() != cashout_account_len(n)) {
         return Err(ProgramError::InvalidAccountData);
      }
      Ok(header)
   }

   #[inline(always)]
   pub unsafe fn read_operator<'a>(ptr: *const u8) -> &'a Address {
      read_address_ref_unchecked(ptr, CASHOUT_OPERATOR_OFFSET)
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

   #[inline(always)]
   fn decode_filler(data: &[u8], filler_i: usize) -> Result<BetFiller, ProgramError> {
      let off = CASHOUT_ACCOUNT_HEADER_LEN
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
      header: &CashoutAccountHeader,
      fillers: &[BetFiller],
   ) -> Result<(), ProgramError> {
      let n = header.num_fillers as usize;
      let expected = cashout_account_len(n);
      if unlikely(out.len() != expected || n < 1 || n > MAX_NUMBER_OF_MMS || fillers.len() < n) {
         return Err(ProgramError::InvalidAccountData);
      }
      let hzc = Self::header_to_zc(header);
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), hzc);
      }
      for i in 0..n {
         let off = CASHOUT_ACCOUNT_HEADER_LEN + i * BET_FILLER_LEN;
         let zc = fillers[i].to_zc();
         unsafe {
            core::ptr::write(out.as_mut_ptr().add(off).cast(), zc);
         }
      }
      Ok(())
   }
}
