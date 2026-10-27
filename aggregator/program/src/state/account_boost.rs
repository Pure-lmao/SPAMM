//! Boost promo PDA. Seeds: `["boost", auth, mint, boost_id_le]`.
//! Layout matches a freebet ticket: header, then MM allow-list, then operator allow-list.

use core::mem::offset_of;

use pinocchio::{Address, address::address_eq, error::ProgramError, hint::{likely, unlikely}};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::{ADDRESS_LEN, MAX_PROMO_ALLOWED_MMS, MAX_PROMO_ALLOWED_OPERATORS},
   readers::read_address_ref_unchecked,
   state::PromoState,
   writers::{write_u32_le_unchecked, write_u8_unchecked},
};

pub const BOOST_ACCOUNT_SEED: &[u8] = b"boost";
pub const BOOST_ACCOUNT_DISCRIMINATOR: u8 = 12;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct BoostAccountHeader {
   pub discriminator: u8,
   pub bump: u8,
   pub state: PromoState,
   pub num_mms: u8,
   pub min_legs: u8,
   pub num_operators: u8,
   pub boost_id: u32,
   pub expiry: u32,
   pub min_odds_scaled: u32,
   pub max_odds_scaled: u32,
   /// `10000` pays 100% of reserved market-maker profit.
   pub boost_bps: u32,
   pub max_stake: u64,
   pub issuer_auth: Address,
   pub user: Address,
   pub mint: Address,
}

pub const BOOST_ACCOUNT_HEADER_LEN: usize = <BoostAccountHeader as ZeroPodFixed>::SIZE;
pub const BOOST_STATE_OFFSET: usize = offset_of!(BoostAccountHeaderZc, state);
pub const BOOST_EXPIRY_OFFSET: usize = offset_of!(BoostAccountHeaderZc, expiry);

#[inline(always)]
pub const fn boost_account_len(num_mms: usize, num_operators: usize) -> usize {
   BOOST_ACCOUNT_HEADER_LEN + num_mms * ADDRESS_LEN + num_operators * ADDRESS_LEN
}

#[derive(Clone)]
pub struct BoostAccountData {
   pub discriminator: u8,
   pub bump: u8,
   pub state: PromoState,
   pub num_mms: u8,
   pub min_legs: u8,
   pub num_operators: u8,
   pub boost_id: u32,
   pub expiry: u32,
   pub min_odds_scaled: u32,
   pub max_odds_scaled: u32,
   pub boost_bps: u32,
   pub max_stake: u64,
   pub issuer_auth: Address,
   pub user: Address,
   pub mint: Address,
   pub allowed_mms: [Address; MAX_PROMO_ALLOWED_MMS],
   pub allowed_operators: [Address; MAX_PROMO_ALLOWED_OPERATORS],
}

impl BoostAccountData {
   #[inline(always)]
   fn header_to_zc(h: &BoostAccountHeader) -> BoostAccountHeaderZc {
      BoostAccountHeaderZc {
         discriminator: h.discriminator,
         bump: h.bump,
         state: h.state.into(),
         num_mms: h.num_mms,
         min_legs: h.min_legs,
         num_operators: h.num_operators,
         boost_id: h.boost_id.into(),
         expiry: h.expiry.into(),
         min_odds_scaled: h.min_odds_scaled.into(),
         max_odds_scaled: h.max_odds_scaled.into(),
         boost_bps: h.boost_bps.into(),
         max_stake: h.max_stake.into(),
         issuer_auth: h.issuer_auth,
         user: h.user,
         mint: h.mint,
      }
   }

   #[inline(always)]
   pub fn decode_header(data: &[u8]) -> Result<BoostAccountHeader, ProgramError> {
      if unlikely(data.len() < BOOST_ACCOUNT_HEADER_LEN || data[0] != BOOST_ACCOUNT_DISCRIMINATOR) {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <BoostAccountHeader as ZeroPodFixed>::from_bytes(&data[..BOOST_ACCOUNT_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidAccountData)?;
      let header = BoostAccountHeader {
         discriminator: zc.discriminator,
         bump: zc.bump,
         state: PromoState::from_u8(zc.state.get())?,
         num_mms: zc.num_mms,
         min_legs: zc.min_legs,
         num_operators: zc.num_operators,
         boost_id: zc.boost_id.get(),
         expiry: zc.expiry.get(),
         min_odds_scaled: zc.min_odds_scaled.get(),
         max_odds_scaled: zc.max_odds_scaled.get(),
         boost_bps: zc.boost_bps.get(),
         max_stake: zc.max_stake.get(),
         issuer_auth: zc.issuer_auth,
         user: zc.user,
         mint: zc.mint,
      };
      let n_mms = header.num_mms as usize;
      let n_ops = header.num_operators as usize;
      if unlikely(n_mms > MAX_PROMO_ALLOWED_MMS || n_ops > MAX_PROMO_ALLOWED_OPERATORS) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data.len() != boost_account_len(n_mms, n_ops)) {
         return Err(ProgramError::InvalidAccountData);
      }
      Ok(header)
   }

   #[inline(never)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      let header = Self::decode_header(data)?;
      let n_mms = header.num_mms as usize;
      let n_ops = header.num_operators as usize;
      let mut allowed_mms = [Address::default(); MAX_PROMO_ALLOWED_MMS];
      for i in 0..n_mms {
         let off = BOOST_ACCOUNT_HEADER_LEN + i * ADDRESS_LEN;
         allowed_mms[i] = *unsafe { read_address_ref_unchecked(data.as_ptr(), off) };
      }
      let ops_off = BOOST_ACCOUNT_HEADER_LEN + n_mms * ADDRESS_LEN;
      let mut allowed_operators = [Address::default(); MAX_PROMO_ALLOWED_OPERATORS];
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
         boost_id: header.boost_id,
         expiry: header.expiry,
         min_odds_scaled: header.min_odds_scaled,
         max_odds_scaled: header.max_odds_scaled,
         boost_bps: header.boost_bps,
         max_stake: header.max_stake,
         issuer_auth: header.issuer_auth,
         user: header.user,
         mint: header.mint,
         allowed_mms,
         allowed_operators,
      })
   }

   pub fn write_header_and_allowlists(
      out: &mut [u8],
      header: &BoostAccountHeader,
      allowed_mms: &[Address],
      allowed_operators: &[Address],
   ) -> Result<(), ProgramError> {
      let n_mms = header.num_mms as usize;
      let n_ops = header.num_operators as usize;
      if unlikely(out.len() != boost_account_len(n_mms, n_ops)) {
         return Err(ProgramError::InvalidAccountData);
      }
      unsafe { core::ptr::write(out.as_mut_ptr().cast(), Self::header_to_zc(header)); }
      for i in 0..n_mms {
         let off = BOOST_ACCOUNT_HEADER_LEN + i * ADDRESS_LEN;
         out[off..off + ADDRESS_LEN].copy_from_slice(allowed_mms[i].as_ref());
      }
      let ops_off = BOOST_ACCOUNT_HEADER_LEN + n_mms * ADDRESS_LEN;
      for i in 0..n_ops {
         let off = ops_off + i * ADDRESS_LEN;
         out[off..off + ADDRESS_LEN].copy_from_slice(allowed_operators[i].as_ref());
      }
      Ok(())
   }

   pub fn mm_allowed(&self, mm: &Address) -> bool {
      if self.num_mms == 0 { return true; }
      let n = self.num_mms as usize;
      for i in 0..n {
         if likely(address_eq(&self.allowed_mms[i], mm)) { return true; }
      }
      false
   }

   pub fn operator_allowed(&self, operator: &Address) -> bool {
      if self.num_operators == 0 { return true; }
      let n = self.num_operators as usize;
      for i in 0..n {
         if likely(address_eq(&self.allowed_operators[i], operator)) { return true; }
      }
      false
   }

   pub fn patch_state(data: &mut [u8], state: PromoState) -> Result<(), ProgramError> {
      if unlikely(data.len() < BOOST_ACCOUNT_HEADER_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      unsafe { write_u8_unchecked(data.as_mut_ptr(), BOOST_STATE_OFFSET, state as u8); }
      Ok(())
   }

   pub fn patch_expiry(data: &mut [u8], expiry: u32) -> Result<(), ProgramError> {
      if unlikely(data.len() < BOOST_ACCOUNT_HEADER_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      unsafe { write_u32_le_unchecked(data.as_mut_ptr(), BOOST_EXPIRY_OFFSET, expiry); }
      Ok(())
   }
}
