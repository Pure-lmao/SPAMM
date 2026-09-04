//! Close the netting PDA for `(mm_program, event_id)` and return rent to the MM
//! authority.
//!
//! Accounts **(5)**
//! 0. `mm_admin` (signer, writable)
//! 1. `mm_program` (readonly) — MM program id used in netting PDA seeds
//! 2. `mm_config_pda` (readonly) — that MM's `["config"]` PDA
//! 3. `netting_pda` (writable)
//! 4. `system_program` (readonly) — required for the lamport transfer on close
//!
//! Instruction `data`: `event_id` (`EventId::WIRE_SIZE` bytes)

use pinocchio::{
   AccountView, ProgramResult, error::ProgramError,
};
use pinocchio_log::log;

use crate::{
   helpers::{
      close_pda_return_rent, verify_mm_admin, verify_mm_program_executable, verify_netting_pda,
      verify_signer, verify_system_program,
   },
   state::{EventId, account_netting::netting_has_open_profit},
};


pub const CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR: u8 = 43;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      admin,
      mm_program,
      mm_config_pda,
      netting_pda,
      system_program,
   ] = accounts else {
      log!("close_netting_account: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(admin)?;
   verify_mm_program_executable(mm_program)?;
   verify_mm_admin(admin, mm_program, mm_config_pda)?;
   verify_system_program(&system_program)?;

   let event_id = match EventId::decode(data) {
      Some(v) => v,
      None => {
         log!("close_netting_account: data length is invalid");
         return Err(ProgramError::InvalidInstructionData);
      }
   };

   if !verify_netting_pda(netting_pda, mm_program, &event_id.as_wire_bytes()) {
      log!("close_netting_account: invalid netting pda");
      return Err(ProgramError::InvalidAccountData);
   }
   {
      let data = netting_pda.try_borrow()?;
      if netting_has_open_profit(data.as_ref())? {
         log!("close_netting_account: open profit remains");
         return Err(ProgramError::InvalidAccountData);
      }
   }
   close_pda_return_rent(netting_pda, admin)
}
