//! Close a prediction PDA; rent returns to the signer.
//!
//! Accounts:
//! 0. `authority` (writable signer) — owner or hard-coded admin
//! 1. `prediction_pda` (writable)
//! 2. `system_program` (readonly)

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::{
   helpers::{
      close_pda_return_rent, read_address_unchecked, verify_owner_or_admin, verify_program_owner, verify_signer, verify_system_program
   },
   state::{PREDICTION_ACCOUNT_LEN, PREDICTION_OWNER_OFFSET},
};

pub const CLOSE_PREDICTION_IX_DISCRIMINATOR: u8 = 1;

pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
   let [authority, prediction_pda, system_program] = accounts else {
      log!("close_prediction: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(authority)?;
   verify_system_program(system_program)?;
   verify_program_owner(prediction_pda)?;

   let owner = {
      let data = prediction_pda.try_borrow()?;
      if data.len() < PREDICTION_ACCOUNT_LEN as usize {
         log!("close_prediction: data too short");
         return Err(ProgramError::InvalidAccountData);
      }
      unsafe { 
         read_address_unchecked(data.as_ptr().add(PREDICTION_OWNER_OFFSET)) 
      }
   };

   verify_owner_or_admin(authority, &owner)?;
   close_pda_return_rent(prediction_pda, authority)?;

   Ok(())
}
