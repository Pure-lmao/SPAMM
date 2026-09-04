//! Add a `(event_id, period, mkt)` line to an existing netting PDA.
//!
//! Accounts (6):
//! 0. `admin` (writable signer) — pays extra rent if the PDA must grow
//! 1. `mm_program` (readonly)
//! 2. `mm_config_pda` (readonly)
//! 3. `netting_pda` (writable)
//! 4. `rent_sysvar` (readonly)
//! 5. `system_program` (readonly) — always present; used for System Transfer when the PDA grows
//!
//! Data: (`event_id: EventId`, `period: u8`, `mkt: u16`)

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::{
   helpers::{
      verify_mm_admin, verify_mm_program_executable, verify_netting_pda, verify_rent_sysvar, verify_signer,
   },
   state::{add_netting_line, account_netting::ensure_netting_space_for_extra_line, AddLineToLiabilityNettingIxData},
};

pub const ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR: u8 = 41;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      admin, 
      mm_program, 
      mm_config_pda,
      netting_pda,
      rent_sysvar,
      system_program,
   ] = accounts else {
      log!("add_line_to_netting_account: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   
   verify_rent_sysvar(rent_sysvar)?;
   verify_signer(&admin)?;
   verify_mm_program_executable(&mm_program)?;
   verify_mm_admin(&admin, &mm_program, mm_config_pda)?;

   let parsed_data = AddLineToLiabilityNettingIxData::decode(data)?;
   let event_id = parsed_data.event_id;
   let period = parsed_data.period;
   let mkt = parsed_data.mkt;

   if !verify_netting_pda(netting_pda, mm_program, &event_id.as_wire_bytes()) {
      log!("add_line_to_netting_account: invalid netting pda");
      return Err(ProgramError::InvalidAccountData);
   }

   ensure_netting_space_for_extra_line(netting_pda, admin, rent_sysvar, system_program)?;

   let data_len = netting_pda.data_len();
   let acc_data = unsafe {
      core::slice::from_raw_parts_mut(netting_pda.data_mut_ptr(), data_len)
   };
   add_netting_line(acc_data, event_id.sport, period, mkt)?;

   Ok(())
}

