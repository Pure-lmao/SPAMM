//! Remove a `(event_id, period, mkt)` line from an existing netting PDA.
//!
//! Accounts (4):
//! 0. `admin` (signer)
//! 1. `mm_program` (readonly)
//! 2. `mm_config_pda` (readonly)
//! 3. `netting_pda` (writable)
//!
//! Data: (`event_id: EventId`, `period: u8`, `mkt: u16`)

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::{
   helpers::{verify_mm_admin, verify_mm_program_executable, verify_netting_pda, verify_signer},
   state::{RemoveLineFromLiabilityNettingIxData, remove_netting_line},
};



pub const REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR: u8 = 42;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      admin,
      mm_program, 
      mm_config_pda,
      netting_pda
   ] = accounts else {
      log!("remove_line_from_netting_account: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&admin)?;
   verify_mm_program_executable(&mm_program)?;
   verify_mm_admin(&admin, &mm_program, &mm_config_pda)?;

   let parsed_data = RemoveLineFromLiabilityNettingIxData::decode(data)?;
   let event_id = parsed_data.event_id;
   let period = parsed_data.period;
   let mkt = parsed_data.mkt;

   if !verify_netting_pda(netting_pda, mm_program, &event_id.as_wire_bytes()) {
      log!("remove_line_from_netting_account: invalid netting pda");
      return Err(ProgramError::InvalidAccountData);
   }

   let mut acc_data = netting_pda.try_borrow_mut()?;
   remove_netting_line(&mut acc_data, period, mkt)?;

   Ok(())
}

