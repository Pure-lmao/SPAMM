//! Close an Available boost PDA and decrement the promo issuer `open_count`.
//!
//! Accounts: **4**
//! 0. `auth` (writable signer)
//! 1. `issuer_pda` (writable)
//! 2. `boost_pda` (writable)
//! 3. `mint` (readonly)
//!
//! Data: `boost_id: u32`

use pinocchio::{AccountView, ProgramResult, address::address_eq, error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{
   errors::SpammError, helpers::{
      consume_freebet, decode_and_verify_boost, verify_mint, verify_signer,
   }, state::PromoState,
};

pub const REVOKE_BOOST_IX_DISCRIMINATOR: u8 = 168;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth,
      issuer_pda,
      boost_pda,
      mint,
   ] = accounts else {
      log!("revoke_boost: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   if unlikely(data.len() != 4) {
      return Err(ProgramError::InvalidInstructionData);
   }
   let boost_id = u32::from_le_bytes(data.try_into().unwrap());
   verify_signer(auth)?;
   verify_mint(mint, mint.address())?;
   let boost = decode_and_verify_boost(
      boost_pda,
      issuer_pda,
      boost_id,
      mint.address(),
   )?;
   if unlikely(!address_eq(&boost.issuer_auth, auth.address())) {
      return Err(SpammError::InvalidBoost.into());
   }
   if unlikely(boost.state != PromoState::Available) {
      log!("revoke_boost: not available");
      return Err(SpammError::BoostNotAvailable.into());
   }
   consume_freebet(boost_pda, issuer_pda, auth)
}
