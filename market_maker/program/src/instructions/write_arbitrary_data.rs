//! Admin-only write of arbitrary bytes to a target account (dev tooling).
//!
//! Grows the account when `data.len()` exceeds current size (funds rent from admin).
//! Program ownership of `data_pda` is enforced by the runtime on writes.
//!
//! Accounts **(5)**:
//! 0. `admin` (writable signer) — must match config admin; pays rent on grow
//! 1. `config_pda` (readonly) — MM `["config"]` for auth
//! 2. `data_pda` (writable) — target account (may be the config itself)
//! 3. `rent_sysvar` (readonly)
//! 4. `system_program` (readonly)

use pinocchio::{AccountView, Address, ProgramResult, Resize, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use pinocchio_system::instructions::Transfer;

use crate::mm_helpers::verify_mm_config_auth;
use spamm_aggregator::{
   helpers::{get_rent, verify_rent_sysvar, verify_signer, verify_system_program},
   writers::write_arbitrary_bytes_unchecked,
};

pub const WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR: u8 = 254;

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [admin, config_pda, data_pda, rent_sysvar, system_program] = accounts else {
      log!("write_arbitrary_data: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(admin)?;
   verify_mm_config_auth(admin, config_pda)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;

   if unlikely(data.is_empty()) {
      log!("write_arbitrary_data: empty data");
      return Err(ProgramError::InvalidInstructionData);
   }

   let cur_len = data_pda.data_len();
   let new_len = data.len();
   if new_len > cur_len {
      let new_rent = get_rent(rent_sysvar, new_len as u64)?;
      let cur_lamports = data_pda.lamports();
      if new_rent > cur_lamports {
         Transfer {
            from: admin,
            to: data_pda,
            lamports: new_rent.checked_sub(cur_lamports).ok_or(ProgramError::ArithmeticOverflow)?,
         }
         .invoke()?;
      }
      data_pda.resize(new_len)?;
   }

   if unlikely(data_pda.data_len() < new_len) {
      return Err(ProgramError::InvalidAccountData);
   }

   unsafe {
      write_arbitrary_bytes_unchecked(data_pda.data_mut_ptr(), 0, data);
   }

   Ok(())
}
