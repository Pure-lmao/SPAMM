//! Close an Available freebet PDA (auth only; no expiry check). Decrements issuer `open_count`.
//!
//! Accounts: **3**
//! 0. `auth` (writable signer)
//! 1. `issuer_pda` (writable)
//! 2. `freebet_pda` (writable)
//!
//! Data: `freebet_id: u32`

use pinocchio::{AccountView, ProgramResult, address::address_eq, error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{
   errors::SpammError,
   helpers::{
      verify_signer,
      freebet_helpers::{consume_freebet, decode_and_verify_freebet_for_ix},
   },
   state::FreebetState,
};

pub const REVOKE_FREEBET_IX_DISCRIMINATOR: u8 = 64;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [auth, issuer_pda, freebet_pda] = accounts else {
      log!("revoke_freebet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   if unlikely(data.len() != 4) {
      return Err(ProgramError::InvalidInstructionData);
   }
   let freebet_id = u32::from_le_bytes(data.try_into().unwrap());

   verify_signer(auth)?;
   let (fb, _) = decode_and_verify_freebet_for_ix(freebet_pda, issuer_pda, freebet_id)?;
   if unlikely(!address_eq(&fb.issuer_auth, auth.address())) {
      log!("revoke_freebet: auth mismatch");
      return Err(SpammError::InvalidFreebet.into());
   }
   if unlikely(fb.state != FreebetState::Available) {
      log!("revoke_freebet: not available");
      return Err(SpammError::FreebetNotAvailable.into());
   }
   consume_freebet(freebet_pda, issuer_pda, auth)
}
