//! On-chain parlay bet PDA layout (distinct discriminator from single [`super::account_bet::BetAccountData`]).
//!
//! PDA seeds: **`["parlay", user_address, bet_id_le]`** (see [`PARLAY_BET_ACCOUNT_SEED`]).
//! Layout: fixed [`ParlayBetAccountHeader`] + trailing [`ParlayLegWire`] × `num_legs` (no padding).

use core::mem::{offset_of, MaybeUninit};

use pinocchio::{Address, error::ProgramError, hint::unlikely};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::MAX_RFQ_PARLAY_LEGS, readers::{read_address_ref_unchecked, read_u8_unchecked, read_u32_le_unchecked}, state::ids::MARKET_ID_OPERATOR_OFFSET, writers::write_u8_unchecked,
};

use super::{
   account_bet::BetResult,
   ids::{EventId},
   mm_parlay_quote::{ParlayLegWire, ParlayLegWireZc, PARLAY_LEG_WIRE_LEN},
};

pub const PARLAY_BET_ACCOUNT_SEED: &[u8] = b"parlay";

pub const PARLAY_BET_ACCOUNT_DISCRIMINATOR: u8 = 2;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct ParlayBetAccountHeader {
   pub discriminator: u8,
   pub bump: u8,
   pub owner: Address,
   pub feepayer: Address,
   pub bet_id: u64,
   pub amount: u64,
   pub payout: u64,
   pub timestamp: u32,
   pub freebet_id: u32,
   pub filler_address: Address,
   pub result: BetResult,
   pub num_legs: u8,
}

pub const PARLAY_BET_HEADER_LEN: usize = <ParlayBetAccountHeader as ZeroPodFixed>::SIZE;
pub const PARLAY_BET_AMOUNT_OFFSET: usize =
   offset_of!(ParlayBetAccountHeaderZc, amount);
pub const PARLAY_BET_PAYOUT_OFFSET: usize =
   offset_of!(ParlayBetAccountHeaderZc, payout);
pub const PARLAY_BET_RESULT_OFFSET: usize =
   offset_of!(ParlayBetAccountHeaderZc, result);
pub const PARLAY_BET_FREEBET_ID_OFFSET: usize =
   offset_of!(ParlayBetAccountHeaderZc, freebet_id);

/// Within each trailing [`ParlayLegWire`] slot.
pub const PARLAY_LEG_RESULT_OFFSET: usize = offset_of!(ParlayLegWireZc, result);
pub const PARLAY_LEG_ODDS_OFFSET: usize = offset_of!(ParlayLegWireZc, odds_scaled);

/// Minimum valid account: header + two legs.
pub const PARLAY_BET_ACCOUNT_MIN_LEN: usize = PARLAY_BET_HEADER_LEN + 2 * PARLAY_LEG_WIRE_LEN;

/// Max possible account size (RFQ path).
pub const PARLAY_BET_ACCOUNT_MAX_LEN: usize =
   PARLAY_BET_HEADER_LEN + MAX_RFQ_PARLAY_LEGS * PARLAY_LEG_WIRE_LEN;

/// Exact account length for `num_legs` live legs (no padding).
#[inline(always)]
pub const fn parlay_bet_account_len(num_legs: usize) -> usize {
   PARLAY_BET_HEADER_LEN + num_legs * PARLAY_LEG_WIRE_LEN
}

/// Fields needed for modified-win settlement (no full leg copy).
#[derive(Copy, Clone)]
pub struct ParlayLegSettleView {
   pub event_id: EventId,
   pub odds_scaled: u32,
   pub result: BetResult,
}

/// Owned view used by fill paths (legs packed at the front of a max-sized buffer).
#[derive(Clone)]
pub struct ParlayBetAccountData {
   pub discriminator: u8,
   pub bump: u8,
   pub owner: Address,
   pub feepayer: Address,
   pub bet_id: u64,
   pub amount: u64,
   pub payout: u64,
   pub timestamp: u32,
   pub freebet_id: u32,
   pub filler_address: Address,
   pub result: BetResult,
   pub num_legs: u8,
   /// Only `0..num_legs` are meaningful.
   pub legs: [ParlayLegWire; MAX_RFQ_PARLAY_LEGS],
}

impl ParlayBetAccountData {
   #[inline(always)]
   fn header_to_zc(h: &ParlayBetAccountHeader) -> ParlayBetAccountHeaderZc {
      ParlayBetAccountHeaderZc {
         discriminator: h.discriminator,
         bump: h.bump,
         owner: h.owner,
         feepayer: h.feepayer,
         bet_id: h.bet_id.into(),
         amount: h.amount.into(),
         payout: h.payout.into(),
         timestamp: h.timestamp.into(),
         freebet_id: h.freebet_id.into(),
         filler_address: h.filler_address,
         result: h.result.into(),
         num_legs: h.num_legs,
      }
   }

   #[inline(always)]
   pub fn decode_header(data: &[u8]) -> Result<ParlayBetAccountHeader, ProgramError> {
      if unlikely(data.len() < PARLAY_BET_ACCOUNT_MIN_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data[0] != PARLAY_BET_ACCOUNT_DISCRIMINATOR) {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <ParlayBetAccountHeader as ZeroPodFixed>::from_bytes(&data[..PARLAY_BET_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidAccountData)?;
      let header = ParlayBetAccountHeader {
         discriminator: zc.discriminator,
         bump: zc.bump,
         owner: zc.owner,
         feepayer: zc.feepayer,
         bet_id: zc.bet_id.get(),
         amount: zc.amount.get(),
         payout: zc.payout.get(),
         timestamp: zc.timestamp.get(),
         freebet_id: zc.freebet_id.get(),
         filler_address: zc.filler_address,
         result: BetResult::from_u8(zc.result.get())?,
         num_legs: zc.num_legs,
      };
      let n = header.num_legs as usize;
      if unlikely(n < 2 || n > MAX_RFQ_PARLAY_LEGS) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data.len() != parlay_bet_account_len(n)) {
         return Err(ProgramError::InvalidAccountData);
      }
      Ok(header)
   }

   #[inline(always)]
   fn leg_offset(leg_i: usize) -> Result<usize, ProgramError> {
      PARLAY_BET_HEADER_LEN
         .checked_add(leg_i.checked_mul(PARLAY_LEG_WIRE_LEN).ok_or(ProgramError::ArithmeticOverflow)?).ok_or(ProgramError::ArithmeticOverflow)
   }

   #[inline(always)]
   fn ensure_leg_in_bounds(data: &[u8], leg_i: usize) -> Result<usize, ProgramError> {
      let off = Self::leg_offset(leg_i)?;
      let end = off
         .checked_add(PARLAY_LEG_WIRE_LEN).ok_or(ProgramError::ArithmeticOverflow)?;
      if unlikely(end > data.len()) {
         return Err(ProgramError::InvalidAccountData);
      }
      Ok(off)
   }

   #[inline(always)]
   pub fn read_leg_result(data: &[u8], leg_i: usize) -> Result<BetResult, ProgramError> {
      let off = Self::ensure_leg_in_bounds(data, leg_i)?;
      let byte = unsafe { read_u8_unchecked(data.as_ptr(), off + PARLAY_LEG_RESULT_OFFSET) };
      BetResult::from_u8(byte)
   }

   /// Patch only the leg `result` byte (no full leg rewrite).
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
            off + PARLAY_LEG_RESULT_OFFSET,
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
         unsafe { read_u32_le_unchecked(data.as_ptr(), off + PARLAY_LEG_ODDS_OFFSET) };
      let result = BetResult::from_u8(unsafe {
         read_u8_unchecked(data.as_ptr(), off + PARLAY_LEG_RESULT_OFFSET)
      })?;
      Ok(ParlayLegSettleView {
         event_id,
         odds_scaled,
         result,
      })
   }

   #[inline(always)]
   pub fn write_ticket_result(data: &mut [u8], result: BetResult) -> Result<(), ProgramError> {
      if unlikely(data.len() < PARLAY_BET_HEADER_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      unsafe {
         write_u8_unchecked(data.as_mut_ptr(), PARLAY_BET_RESULT_OFFSET, result as u8);
      }
      Ok(())
   }

   /// Decode a full leg (fill / rare paths). Prefer field accessors for grade/settle.
   #[inline(always)]
   pub fn decode_leg(data: &[u8], leg_i: usize) -> Result<ParlayLegWire, ProgramError> {
      let off = Self::ensure_leg_in_bounds(data, leg_i)?;
      let zc = <ParlayLegWire as ZeroPodFixed>::from_bytes(&data[off..off + PARLAY_LEG_WIRE_LEN])
         .map_err(|_| ProgramError::InvalidAccountData)?;
      ParlayLegWire::from_zc(zc).ok_or(ProgramError::InvalidAccountData)
   }

   pub fn decode_legs_into(
      data: &[u8],
      n: usize,
      out: &mut [MaybeUninit<ParlayLegWire>],
   ) -> Result<(), ProgramError> {
      if unlikely(n < 2 || n > MAX_RFQ_PARLAY_LEGS || out.len() < n) {
         return Err(ProgramError::InvalidAccountData);
      }
      for i in 0..n {
         out[i].write(Self::decode_leg(data, i)?);
      }
      Ok(())
   }

   /// Write header + live legs only (avoids stacking a full `MAX_RFQ_PARLAY_LEGS` owned copy).
   #[inline(always)]
   pub fn write_header_and_legs(
      out: &mut [u8],
      header: &ParlayBetAccountHeader,
      legs: &[ParlayLegWire],
   ) -> Result<(), ProgramError> {
      let n = header.num_legs as usize;
      let expected = parlay_bet_account_len(n);
      if unlikely(out.len() != expected || n < 2 || n > MAX_RFQ_PARLAY_LEGS || legs.len() < n) {
         return Err(ProgramError::InvalidAccountData);
      }
      let hzc = Self::header_to_zc(header);
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), hzc);
      }
      for i in 0..n {
         let off = PARLAY_BET_HEADER_LEN + i * PARLAY_LEG_WIRE_LEN;
         let mut leg = legs[i];
         leg.result = BetResult::Pending;
         let zc = leg.to_zc();
         unsafe {
            core::ptr::write(out.as_mut_ptr().add(off).cast(), zc);
         }
      }
      Ok(())
   }
}
