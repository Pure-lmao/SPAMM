use pinocchio::{
   AccountView, ProgramResult, address::address_eq, error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;

use crate::constants::CONFIG_PDA;


/// MM `fill_*` CPI: must run under aggregator fill.
#[inline(always)]
pub fn verify_invoked_via_aggregator(config_pda: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(config_pda.address(), &CONFIG_PDA)) {
      log!("verify_invoked_via_aggregator: config pda input must be the config pda");
      return Err(ProgramError::InvalidAccountOwner);
   }

   if unlikely(!config_pda.is_signer()) {
      log!("verify_invoked_via_aggregator: config pda must be a signer");
      return Err(ProgramError::InvalidAccountOwner);
   }

   Ok(())
}
