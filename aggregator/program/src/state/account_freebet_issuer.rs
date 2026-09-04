//! Freebet issuer PDA: authority + open-count bookkeeping; ATA authority for promo funds.
//!
//! PDA seeds: **`["freebet_issuer", auth]`** (see [`FREEBET_ISSUER_SEED`]).

use core::mem::offset_of;

use pinocchio::{Address, error::ProgramError, hint::unlikely};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::writers::write_u32_le_unchecked;

pub const FREEBET_ISSUER_SEED: &[u8] = b"freebet_issuer";
pub const FREEBET_ISSUER_DISCRIMINATOR: u8 = 10;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FreebetIssuer {
   pub discriminator: u8,
   pub bump: u8,
   pub auth: Address,
   pub open_count: u32,
}

pub const FREEBET_ISSUER_LEN: usize = <FreebetIssuer as ZeroPodFixed>::SIZE;
pub const FREEBET_ISSUER_BUMP_OFFSET: usize =
   offset_of!(FreebetIssuerZc, bump);
pub const FREEBET_ISSUER_AUTH_OFFSET: usize =
   offset_of!(FreebetIssuerZc, auth);
pub const FREEBET_ISSUER_OPEN_COUNT_OFFSET: usize =
   offset_of!(FreebetIssuerZc, open_count);

impl FreebetIssuer {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if unlikely(data.len() != FREEBET_ISSUER_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data[0] != FREEBET_ISSUER_DISCRIMINATOR) {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidAccountData)?;
      Ok(Self {
         discriminator: zc.discriminator,
         bump: zc.bump,
         auth: zc.auth,
         open_count: zc.open_count.get(),
      })
   }

   #[inline(always)]
   pub fn write_to_account(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if unlikely(out.len() != FREEBET_ISSUER_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = FreebetIssuerZc {
         discriminator: self.discriminator,
         bump: self.bump,
         auth: self.auth,
         open_count: self.open_count.into(),
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }

   #[inline(always)]
   pub fn patch_open_count(data: &mut [u8], open_count: u32) -> Result<(), ProgramError> {
      if unlikely(data.len() != FREEBET_ISSUER_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(data[0] != FREEBET_ISSUER_DISCRIMINATOR) {
         return Err(ProgramError::InvalidAccountData);
      }
      unsafe {
         write_u32_le_unchecked(data.as_mut_ptr(), FREEBET_ISSUER_OPEN_COUNT_OFFSET, open_count);
      }
      Ok(())
   }
}

#[inline(always)]
pub fn bump_open_count(data: &mut [u8], delta: i32) -> Result<u32, ProgramError> {
   let issuer = FreebetIssuer::decode(data)?;
   let next = if delta >= 0 {
      issuer.open_count
         .checked_add(delta as u32).ok_or(ProgramError::ArithmeticOverflow)?
   } else {
      issuer.open_count
         .checked_sub((-delta) as u32).ok_or(ProgramError::ArithmeticOverflow)?
   };
   FreebetIssuer::patch_open_count(data, next)?;
   Ok(next)
}
