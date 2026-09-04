//! Admin write of arbitrary bytes onto a target account (dev tooling). Works while paused.
//!
//! Accounts: **3**
//! 0. `admin` (signer) — must match aggregator config authority
//! 1. `config_pda` (readonly)
//! 2. `data_pda` (writable)
//!
//! Data: bytes to write (no extra discriminator after the router byte).

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;
use crate::helpers::{verify_authority, verify_config_pda, verify_signer};
use crate::writers::write_arbitrary_bytes_unchecked;


pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [admin, config_pda, data_pda] = accounts else {
      log!("write_arbitrary_data: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&admin)?;
   verify_config_pda(&config_pda, false)?;
   verify_authority(&admin, &config_pda)?;

   unsafe {
      write_arbitrary_bytes_unchecked(data_pda.data_mut_ptr(), 0, data);
   }

   Ok(())
}
