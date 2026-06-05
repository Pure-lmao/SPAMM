//! Force close a PDA and return the rent to the authority
//! 
//! Accounts: **3**
//! 0. `authority` (writable signer)
//! 1. `pda` (writable)
//! 2. `system_program` (readonly)
//! 
//! No instruction data after the router discriminator.

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::helpers::{close_pda_return_rent, verify_admin, verify_signer, verify_system_program};


pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
   let [
      authority,
      pda,
      system_program,
   ] = accounts else {
      log!("force_close_pda: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&authority)?;
   verify_admin(&authority)?;
   verify_system_program(&system_program)?;

   close_pda_return_rent(pda, authority)?;

   Ok(())
}