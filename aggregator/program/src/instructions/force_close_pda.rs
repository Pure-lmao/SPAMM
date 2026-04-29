//! Force close a PDA and return the rent to the authority
//! 
//! Accounts: **3**
//! 0. `authority` (writable signer)
//! 1. `config_pda` (readonly)
//! 2. `pda` (writable)
//! 3. `system_program` (readonly)
//! 
//! No instruction data after the router discriminator.

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::helpers::{close_pda_return_rent, verify_authority, verify_config_pda, verify_signer, verify_system_program};


pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
   let [
      authority,
      config_pda,
      pda,
      system_program,
   ] = accounts else {
      log!("force_close_pda: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&authority)?;
   verify_config_pda(&config_pda, false)?;
   verify_authority(&authority, config_pda)?;
   verify_system_program(&system_program)?;

   close_pda_return_rent(pda, authority)?;

   Ok(())
}