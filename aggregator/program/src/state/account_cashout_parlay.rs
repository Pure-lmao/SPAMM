//! Filling-MM cashout ticket (novation of a parlay slice).
//!
//! Seeds: **`["cashout_parlay", filling_mm, cashout_id_le]`**.
//! Layout: fixed [`CashoutParlayHeader`] + trailing [`CashoutParlayLeg`] × `num_legs`.

use core::mem::{MaybeUninit, offset_of};

use pinocchio::{Address, error::ProgramError, hint::unlikely};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::MAX_RFQ_PARLAY_LEGS, readers::{read_address_ref_unchecked, read_u8_unchecked, read_u32_le_unchecked}, state::{
      EventGameState, account_bet::BetResult, account_parlay_bet::ParlayLegSettleView, ids::{EventId, MARKET_ID_OPERATOR_OFFSET, MarketId},
   }, writers::write_u8_unchecked,
};

pub const CASHOUT_PARLAY_ACCOUNT_SEED: &[u8] = b"cashout_parlay";
pub const CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR: u8 = 9;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct CashoutParlayLeg {
   pub market_id: MarketId,
   pub side: u8,
   pub orig_event_state_sequence: u16,
   pub orig_event_game_state: EventGameState,
   pub cashout_event_state_sequence: u16,
   pub cashout_event_game_state: EventGameState,
   pub odds_scaled: u32,
   pub result: BetResult,
}

pub const CASHOUT_PARLAY_LEG_LEN: usize = <CashoutParlayLeg as ZeroPodFixed>::SIZE;

impl CashoutParlayLeg {
   #[inline(always)]
   pub fn to_zc(&self) -> CashoutParlayLegZc {
      CashoutParlayLegZc {
         market_id: self.market_id.to_zc(),
         side: self.side,
         orig_event_state_sequence: self.orig_event_state_sequence.into(),
         orig_event_game_state: self.orig_event_game_state.to_zc(),
         cashout_event_state_sequence: self.cashout_event_state_sequence.into(),
         cashout_event_game_state: self.cashout_event_game_state.to_zc(),
         odds_scaled: self.odds_scaled.into(),
         result: self.result.into(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &CashoutParlayLegZc) -> Option<Self> {
      Some(Self {
         market_id: MarketId::from_zc(&z.market_id)?,
         side: z.side,
         orig_event_state_sequence: z.orig_event_state_sequence.get(),
         orig_event_game_state: EventGameState::from_zc(&z.orig_event_game_state),
         cashout_event_state_sequence: z.cashout_event_state_sequence.get(),
         cashout_event_game_state: EventGameState::from_zc(&z.cashout_event_game_state),
         odds_scaled: z.odds_scaled.get(),
         result: BetResult::from_u8(z.result.get()).ok()?,
      })
   }
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct CashoutParlayHeader {
   pub discriminator: u8,
   pub bump: u8,
   pub mm: Address,
   pub feepayer: Address,
   /// Original ticket owner (user). Escrow PDA seeds stay `(user, orig_bet_id)`.
   pub orig_owner: Address,
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub amount: u64,
   pub payout: u64,
   pub timestamp: u32,
   pub result: BetResult,
   pub original_filler_address: Address,
   pub num_legs: u8,
}

pub const CASHOUT_PARLAY_HEADER_LEN: usize = <CashoutParlayHeader as ZeroPodFixed>::SIZE;
pub const CASHOUT_PARLAY_BUMP_OFFSET: usize = offset_of!(CashoutParlayHeaderZc, bump);
pub const CASHOUT_PARLAY_RESULT_OFFSET: usize =
   offset_of!(CashoutParlayHeaderZc, result);
pub const CASHOUT_PARLAY_LEG_RESULT_OFFSET: usize =
   offset_of!(CashoutParlayLegZc, result);
pub const CASHOUT_PARLAY_LEG_ODDS_OFFSET: usize =
   offset_of!(CashoutParlayLegZc, odds_scaled);

pub const CASHOUT_PARLAY_ACCOUNT_MIN_LEN: usize =
   CASHOUT_PARLAY_HEADER_LEN + 2 * CASHOUT_PARLAY_LEG_LEN;
pub const CASHOUT_PARLAY_ACCOUNT_MAX_LEN: usize =
   CASHOUT_PARLAY_HEADER_LEN + MAX_RFQ_PARLAY_LEGS * CASHOUT_PARLAY_LEG_LEN;

#[inline(always)]
pub const fn cashout_parlay_account_len(num_legs: usize) -> usize {
   CASHOUT_PARLAY_HEADER_LEN + num_legs * CASHOUT_PARLAY_LEG_LEN
}

pub struct CashoutParlayAccountData {
   pub discriminator: u8,
   pub bump: u8,
   pub mm: Address,
   pub feepayer: Address,
   pub orig_owner: Address,
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub amount: u64,
   pub payout: u64,
   pub timestamp: u32,
   pub result: BetResult,
   pub original_filler_address: Address,
   pub num_legs: u8,
   pub legs: [CashoutParlayLeg; MAX_RFQ_PARLAY_LEGS],
}

impl CashoutParlayAccountData {
   #[inline(always)]
   fn header_to_zc(h: &CashoutParlayHeader) -> CashoutParlayHeaderZc {
      CashoutParlayHeaderZc {
         discriminator: h.discriminator,
         bump: h.bump,
         mm: h.mm,
         feepayer: h.feepayer,
         orig_owner: h.orig_owner,
         orig_bet_id: h.orig_bet_id.into(),
         cashout_id: h.cashout_id.into(),
         amount: h.amount.into(),
         payout: h.payout.into(),
         timestamp: h.timestamp.into(),
         result: h.result.into(),
         original_filler_address: h.original_filler_address,
         num_legs: h.num_legs,
      }
   }

   #[inline(always)]
   pub fn decode_header(data: &[u8]) -> Result<CashoutParlayHeader, ProgramError> {
      if unlikely(data.len() < CASHOUT_PARLAY_ACCOUNT_MIN_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data[0] != CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR) {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <CashoutParlayHeader as ZeroPodFixed>::from_bytes(&data[..CASHOUT_PARLAY_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidAccountData)?;
      let header = CashoutParlayHeader {
         discriminator: zc.discriminator,
         bump: zc.bump,
         mm: zc.mm,
         feepayer: zc.feepayer,
         orig_owner: zc.orig_owner,
         orig_bet_id: zc.orig_bet_id.get(),
         cashout_id: zc.cashout_id.get(),
         amount: zc.amount.get(),
         payout: zc.payout.get(),
         timestamp: zc.timestamp.get(),
         result: BetResult::from_u8(zc.result.get())?,
         original_filler_address: zc.original_filler_address,
         num_legs: zc.num_legs,
      };
      let n = header.num_legs as usize;
      if unlikely(n < 2 || n > MAX_RFQ_PARLAY_LEGS) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data.len() != cashout_parlay_account_len(n)) {
         return Err(ProgramError::InvalidAccountData);
      }
      Ok(header)
   }

   #[inline(always)]
   fn leg_offset(leg_i: usize) -> Result<usize, ProgramError> {
      CASHOUT_PARLAY_HEADER_LEN
         .checked_add(leg_i.checked_mul(CASHOUT_PARLAY_LEG_LEN).ok_or(ProgramError::ArithmeticOverflow)?).ok_or(ProgramError::ArithmeticOverflow)
   }

   #[inline(always)]
   fn ensure_leg_in_bounds(data: &[u8], leg_i: usize) -> Result<usize, ProgramError> {
      let off = Self::leg_offset(leg_i)?;
      let end = off
         .checked_add(CASHOUT_PARLAY_LEG_LEN).ok_or(ProgramError::ArithmeticOverflow)?;
      if unlikely(end > data.len()) {
         return Err(ProgramError::InvalidAccountData);
      }
      Ok(off)
   }

   #[inline(always)]
   pub fn read_leg_result(data: &[u8], leg_i: usize) -> Result<BetResult, ProgramError> {
      let off = Self::ensure_leg_in_bounds(data, leg_i)?;
      let byte = unsafe { read_u8_unchecked(data.as_ptr(), off + CASHOUT_PARLAY_LEG_RESULT_OFFSET) };
      BetResult::from_u8(byte)
   }

   #[inline(always)]
   pub fn write_leg_result(
      data: &mut [u8],
      leg_i: usize,
      result: BetResult,
   ) -> Result<(), ProgramError> {
      let off = Self::ensure_leg_in_bounds(data, leg_i)?;
      unsafe {
         write_u8_unchecked(
            data.as_mut_ptr(),
            off + CASHOUT_PARLAY_LEG_RESULT_OFFSET,
            result as u8,
         );
      }
      Ok(())
   }

   #[inline(always)]
   pub fn read_leg_operator<'a>(data: &'a [u8], leg_i: usize) -> Result<&'a Address, ProgramError> {
      let market_id_offset = Self::ensure_leg_in_bounds(data, leg_i)?;
      unsafe { Ok(read_address_ref_unchecked(data.as_ptr(), market_id_offset + MARKET_ID_OPERATOR_OFFSET)) }
   }

   #[inline(always)]
   pub fn read_leg_settle_view(
      data: &[u8],
      leg_i: usize,
   ) -> Result<ParlayLegSettleView, ProgramError> {
      let off = Self::ensure_leg_in_bounds(data, leg_i)?;
      let event_id = EventId::decode(&data[off..off + EventId::WIRE_SIZE])
         .ok_or(ProgramError::InvalidAccountData)?;
      let odds_scaled =
         unsafe { read_u32_le_unchecked(data.as_ptr(), off + CASHOUT_PARLAY_LEG_ODDS_OFFSET) };
      let result = BetResult::from_u8(unsafe {
         read_u8_unchecked(data.as_ptr(), off + CASHOUT_PARLAY_LEG_RESULT_OFFSET)
      })?;
      Ok(ParlayLegSettleView {
         event_id,
         odds_scaled,
         result,
      })
   }

   #[inline(always)]
   pub fn write_ticket_result(data: &mut [u8], result: BetResult) -> Result<(), ProgramError> {
      if unlikely(data.len() < CASHOUT_PARLAY_HEADER_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      unsafe {
         write_u8_unchecked(data.as_mut_ptr(), CASHOUT_PARLAY_RESULT_OFFSET, result as u8);
      }
      Ok(())
   }

   #[inline(always)]
   pub fn decode_leg(data: &[u8], leg_i: usize) -> Result<CashoutParlayLeg, ProgramError> {
      let off = Self::ensure_leg_in_bounds(data, leg_i)?;
      let zc = <CashoutParlayLeg as ZeroPodFixed>::from_bytes(&data[off..off + CASHOUT_PARLAY_LEG_LEN])
         .map_err(|_| ProgramError::InvalidAccountData)?;
      CashoutParlayLeg::from_zc(zc).ok_or(ProgramError::InvalidAccountData)
   }

   pub fn decode_legs_into(
      data: &[u8],
      n: usize,
      out: &mut [MaybeUninit<CashoutParlayLeg>],
   ) -> Result<(), ProgramError> {
      if unlikely(n < 2 || n > MAX_RFQ_PARLAY_LEGS || out.len() < n) {
         return Err(ProgramError::InvalidAccountData);
      }
      for i in 0..n {
         out[i].write(Self::decode_leg(data, i)?);
      }
      Ok(())
   }

   #[inline(always)]
   pub fn write_header_and_legs(
      out: &mut [u8],
      header: &CashoutParlayHeader,
      legs: &[CashoutParlayLeg],
   ) -> Result<(), ProgramError> {
      let n = header.num_legs as usize;
      let expected = cashout_parlay_account_len(n);
      if unlikely(out.len() != expected || n < 2 || n > MAX_RFQ_PARLAY_LEGS || legs.len() < n) {
         return Err(ProgramError::InvalidAccountData);
      }
      let hzc = Self::header_to_zc(header);
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), hzc);
      }
      for i in 0..n {
         let off = CASHOUT_PARLAY_HEADER_LEN + i * CASHOUT_PARLAY_LEG_LEN;
         let mut leg = legs[i];
         if header.result == BetResult::Pending {
            leg.result = BetResult::Pending;
         }
         let zc = leg.to_zc();
         unsafe {
            core::ptr::write(out.as_mut_ptr().add(off).cast(), zc);
         }
      }
      Ok(())
   }
}
