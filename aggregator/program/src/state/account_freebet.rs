//! Promotional freebet PDA: constraints + Available/Used state.
//!
//! PDA seeds: **`["freebet", auth, freebet_id_le]`** (see [`FREEBET_ACCOUNT_SEED`]).
//! Layout: fixed [`FreebetAccountHeader`] + trailing `Address` × `num_mms` + `Address` × `num_operators`.

use pinocchio::{Address, address::address_eq, error::ProgramError, hint::{likely, unlikely}};
use zeropod::{ZeroPod, ZeroPodFixed};

use core::mem::offset_of;
use crate::{
   constants::{ADDRESS_LEN, MAX_FREEBET_ALLOWED_MMS, MAX_FREEBET_ALLOWED_OPERATORS},
   readers::read_address_ref_unchecked,
   writers::{write_u32_le_unchecked, write_u64_le_unchecked, write_u8_unchecked},
};

pub const FREEBET_ACCOUNT_SEED: &[u8] = b"freebet";
pub const FREEBET_ACCOUNT_DISCRIMINATOR: u8 = 11;

#[repr(u8)]
#[derive(Copy, Clone, ZeroPod, PartialEq, Eq, Debug)]
pub enum FreebetState {
   Available = 0,
   Used = 1,
}

impl FreebetState {
   #[inline(always)]
   pub fn from_u8(value: u8) -> Result<Self, ProgramError> {
      match value {
         0 => Ok(Self::Available),
         1 => Ok(Self::Used),
         _ => Err(ProgramError::InvalidAccountData),
      }
   }
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FreebetAccountHeader {
   pub discriminator: u8,
   pub bump: u8,
   pub state: FreebetState,
   pub num_mms: u8,
   pub min_legs: u8,
   pub num_operators: u8,
   pub freebet_id: u32,
   pub expiry: u32,
   pub min_odds_scaled: u32,
   pub max_odds_scaled: u32,
   pub amount: u64,
   pub issuer_auth: Address,
   pub user: Address,
}

pub const FREEBET_ACCOUNT_HEADER_LEN: usize = <FreebetAccountHeader as ZeroPodFixed>::SIZE;
pub const FREEBET_STATE_OFFSET: usize = offset_of!(FreebetAccountHeaderZc, state);
pub const FREEBET_AMOUNT_OFFSET: usize = offset_of!(FreebetAccountHeaderZc, amount);
pub const FREEBET_EXPIRY_OFFSET: usize = offset_of!(FreebetAccountHeaderZc, expiry);

pub const FREEBET_ACCOUNT_MIN_LEN: usize = FREEBET_ACCOUNT_HEADER_LEN;
pub const FREEBET_ACCOUNT_MAX_LEN: usize = FREEBET_ACCOUNT_HEADER_LEN
   + MAX_FREEBET_ALLOWED_MMS * ADDRESS_LEN
   + MAX_FREEBET_ALLOWED_OPERATORS * ADDRESS_LEN;

#[inline(always)]
pub const fn freebet_account_len(num_mms: usize, num_operators: usize) -> usize {
   FREEBET_ACCOUNT_HEADER_LEN + num_mms * ADDRESS_LEN + num_operators * ADDRESS_LEN
}

#[derive(Clone)]
pub struct FreebetAccountData {
   pub discriminator: u8,
   pub bump: u8,
   pub state: FreebetState,
   pub num_mms: u8,
   pub min_legs: u8,
   pub num_operators: u8,
   pub freebet_id: u32,
   pub expiry: u32,
   pub min_odds_scaled: u32,
   pub max_odds_scaled: u32,
   pub amount: u64,
   pub issuer_auth: Address,
   pub user: Address,
   pub allowed_mms: [Address; MAX_FREEBET_ALLOWED_MMS],
   pub allowed_operators: [Address; MAX_FREEBET_ALLOWED_OPERATORS],
}

impl FreebetAccountData {
   #[inline(always)]
   fn header_to_zc(h: &FreebetAccountHeader) -> FreebetAccountHeaderZc {
      FreebetAccountHeaderZc {
         discriminator: h.discriminator,
         bump: h.bump,
         state: h.state.into(),
         num_mms: h.num_mms,
         min_legs: h.min_legs,
         num_operators: h.num_operators,
         freebet_id: h.freebet_id.into(),
         expiry: h.expiry.into(),
         min_odds_scaled: h.min_odds_scaled.into(),
         max_odds_scaled: h.max_odds_scaled.into(),
         amount: h.amount.into(),
         issuer_auth: h.issuer_auth,
         user: h.user,
      }
   }

   #[inline(always)]
   pub fn decode_header(data: &[u8]) -> Result<FreebetAccountHeader, ProgramError> {
      if unlikely(data.len() < FREEBET_ACCOUNT_HEADER_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data[0] != FREEBET_ACCOUNT_DISCRIMINATOR) {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <FreebetAccountHeader as ZeroPodFixed>::from_bytes(&data[..FREEBET_ACCOUNT_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidAccountData)?;
      let header = FreebetAccountHeader {
         discriminator: zc.discriminator,
         bump: zc.bump,
         state: FreebetState::from_u8(zc.state.get())?,
         num_mms: zc.num_mms,
         min_legs: zc.min_legs,
         num_operators: zc.num_operators,
         freebet_id: zc.freebet_id.get(),
         expiry: zc.expiry.get(),
         min_odds_scaled: zc.min_odds_scaled.get(),
         max_odds_scaled: zc.max_odds_scaled.get(),
         amount: zc.amount.get(),
         issuer_auth: zc.issuer_auth,
         user: zc.user,
      };
      let n_mms = header.num_mms as usize;
      let n_ops = header.num_operators as usize;
      if unlikely(n_mms > MAX_FREEBET_ALLOWED_MMS || n_ops > MAX_FREEBET_ALLOWED_OPERATORS) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data.len() != freebet_account_len(n_mms, n_ops)) {
         return Err(ProgramError::InvalidAccountData);
      }
      Ok(header)
   }

   /// Never inlined: owns the MM and operator allow-list arrays plus a zeroed decode temp.
   #[inline(never)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      let header = Self::decode_header(data)?;
      let n_mms = header.num_mms as usize;
      let n_ops = header.num_operators as usize;
      let mut allowed_mms = [Address::default(); MAX_FREEBET_ALLOWED_MMS];
      for i in 0..n_mms {
         let off = FREEBET_ACCOUNT_HEADER_LEN + i * ADDRESS_LEN;
         allowed_mms[i] = *unsafe { read_address_ref_unchecked(data.as_ptr(), off) };
      }
      let ops_off = FREEBET_ACCOUNT_HEADER_LEN + n_mms * ADDRESS_LEN;
      let mut allowed_operators = [Address::default(); MAX_FREEBET_ALLOWED_OPERATORS];
      for i in 0..n_ops {
         let off = ops_off + i * ADDRESS_LEN;
         allowed_operators[i] = *unsafe { read_address_ref_unchecked(data.as_ptr(), off) };
      }
      Ok(Self {
         discriminator: header.discriminator,
         bump: header.bump,
         state: header.state,
         num_mms: header.num_mms,
         min_legs: header.min_legs,
         num_operators: header.num_operators,
         freebet_id: header.freebet_id,
         expiry: header.expiry,
         min_odds_scaled: header.min_odds_scaled,
         max_odds_scaled: header.max_odds_scaled,
         amount: header.amount,
         issuer_auth: header.issuer_auth,
         user: header.user,
         allowed_mms,
         allowed_operators,
      })
   }

   #[inline(always)]
   pub fn write_header_and_allowlists(
      out: &mut [u8],
      header: &FreebetAccountHeader,
      allowed_mms: &[Address],
      allowed_operators: &[Address],
   ) -> Result<(), ProgramError> {
      let n_mms = header.num_mms as usize;
      let n_ops = header.num_operators as usize;
      let expected = freebet_account_len(n_mms, n_ops);
      if unlikely(
         out.len() != expected
            || n_mms > MAX_FREEBET_ALLOWED_MMS
            || n_ops > MAX_FREEBET_ALLOWED_OPERATORS
            || allowed_mms.len() < n_mms
            || allowed_operators.len() < n_ops
      ) {
         return Err(ProgramError::InvalidAccountData);
      }
      let hzc = Self::header_to_zc(header);
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), hzc);
      }
      for i in 0..n_mms {
         let off = FREEBET_ACCOUNT_HEADER_LEN + i * ADDRESS_LEN;
         out[off..off + ADDRESS_LEN].copy_from_slice(allowed_mms[i].as_ref());
      }
      let ops_off = FREEBET_ACCOUNT_HEADER_LEN + n_mms * ADDRESS_LEN;
      for i in 0..n_ops {
         let off = ops_off + i * ADDRESS_LEN;
         out[off..off + ADDRESS_LEN].copy_from_slice(allowed_operators[i].as_ref());
      }
      Ok(())
   }

   #[inline(always)]
   pub fn mm_allowed(&self, mm: &Address) -> bool {
      if self.num_mms == 0 {
         return true;
      }
      let n = self.num_mms as usize;
      for i in 0..n {
         if likely(address_eq(&self.allowed_mms[i], mm)) {
            return true;
         }
      }
      false
   }

   #[inline(always)]
   pub fn operator_allowed(&self, operator: &Address) -> bool {
      if self.num_operators == 0 {
         return true;
      }
      let n = self.num_operators as usize;
      for i in 0..n {
         if likely(address_eq(&self.allowed_operators[i], operator)) {
            return true;
         }
      }
      false
   }

   #[inline(always)]
   pub fn patch_state(data: &mut [u8], state: FreebetState) -> Result<(), ProgramError> {
      if unlikely(data.len() < FREEBET_ACCOUNT_HEADER_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      unsafe {
         write_u8_unchecked(data.as_mut_ptr(), FREEBET_STATE_OFFSET, state as u8);
      }
      Ok(())
   }

   #[inline(always)]
   pub fn patch_amount(data: &mut [u8], amount: u64) -> Result<(), ProgramError> {
      if unlikely(data.len() < FREEBET_ACCOUNT_HEADER_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      unsafe {
         write_u64_le_unchecked(data.as_mut_ptr(), FREEBET_AMOUNT_OFFSET, amount);
      }
      Ok(())
   }

   #[inline(always)]
   pub fn patch_expiry(data: &mut [u8], expiry: u32) -> Result<(), ProgramError> {
      if unlikely(data.len() < FREEBET_ACCOUNT_HEADER_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      unsafe {
         write_u32_le_unchecked(data.as_mut_ptr(), FREEBET_EXPIRY_OFFSET, expiry);
      }
      Ok(())
   }
}
