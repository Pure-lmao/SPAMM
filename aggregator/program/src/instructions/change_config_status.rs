//! Pause or unpause the program
//! 
//! Accounts: **2**
//! 0. `auth` (signer)
//! 1. `config_pda` (writable)
//! 
//! Data:
//! 0. `status` (u8) - 0 for paused, 1 for unpaused
//! 

use pinocchio::{AccountView, ProgramResult, error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{helpers::{
   verify_authority, verify_config_pda, verify_signer}, state::other::CONFIG_PDA_STATUS_OFFSET, writers::write_u8_unchecked};


pub const CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR: u8 = 1;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth, //verified as signer
      config_pda, //verified by verify_config_pda
   ] = accounts else {
      log!("change_config_status: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&auth)?;
   verify_config_pda(&config_pda, false)?;
   verify_authority(&auth, &config_pda)?;

   if unlikely(data.len() != 1) {
      log!("change_config_status: data length must be 1");
      return Err(ProgramError::InvalidInstructionData);
   }
   //write the new status to the config pda
   if unlikely(data[0] != 0 && data[0] != 1) {
      log!("change_config_status: new status must be 0 or 1");
      return Err(ProgramError::InvalidInstructionData);
   }
   
   unsafe { 
      write_u8_unchecked(config_pda.data_mut_ptr(), CONFIG_PDA_STATUS_OFFSET, data[0]) 
   };

   Ok(())
}