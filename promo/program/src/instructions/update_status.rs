//! Update config `status` (active flag).
//!
//! Accounts **(3)** — extra readonly account avoids Doppler oracle fast-path (`account_count == 2`):
//! 0. `admin` (signer)
//! 1. `config_pda` (writable)
//! 2. any readonly account (ignored; clients pass system program)
use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use spamm_aggregator::{helpers::verify_signer, writers::{write_u8_unchecked},};

use crate::{mm_helpers::verify_mm_config_auth, state::account_config::{ STATUS_OFFSET}};

pub const UPDATE_STATUS_IX_DISCRIMINATOR: u8 = 2;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [admin, config_pda, _unused] = accounts else {
      log!("update_status: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(admin)?;
   verify_mm_config_auth(program_id, admin, config_pda)?;

   if unlikely(data.len() != 1) {
      log!("update_status: instruction data wrong length");
      return Err(ProgramError::InvalidInstructionData);
   }
   
   if unlikely(data[0] != 0 && data[0] != 1) {
      log!("update_status: instruction data invalid");
      return Err(ProgramError::InvalidInstructionData);
   }

   unsafe {
      let ptr = config_pda.data_mut_ptr();
      write_u8_unchecked(ptr, STATUS_OFFSET, data[0]);
   }
   Ok(())
}