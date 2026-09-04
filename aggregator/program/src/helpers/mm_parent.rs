use pinocchio::{
   AccountView,
   address::address_eq,
   error::ProgramError,
   hint::unlikely,
   sysvars::instructions::Instructions,
};
use pinocchio_log::log;

use crate::ID;

use super::account_verify::verify_instructions_sysvar;


/// MM `fill_bet` / `fill_parlay` CPI: must run under aggregator fill (incl. freebet).
/// Returns the parent aggregator instruction discriminator.
#[inline(always)]
pub fn verify_invoked_via_aggregator(instructions_sysvar: &AccountView) -> Result<u8, ProgramError> {
   verify_instructions_sysvar(instructions_sysvar)?;

   let ix_sys = Instructions::try_from(instructions_sysvar)?;
   let current_index = ix_sys.load_current_index() as usize;
   let parent_ix = ix_sys.load_instruction_at(current_index)?;

   if unlikely(!address_eq(parent_ix.get_program_id(), &ID)) {
      log!("verify_invoked_via_aggregator: parent program must be aggregator");
      return Err(ProgramError::InvalidInstructionData);
   }

   let data = parent_ix.get_instruction_data();
   if unlikely(data.is_empty()) {
      log!("verify_invoked_via_aggregator: parent ix data empty");
      return Err(ProgramError::InvalidInstructionData);
   }
   let disc = data[0];

   Ok(disc)
}
