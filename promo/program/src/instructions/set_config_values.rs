//! Promo MM has no global vig/exposure config — `set_config_values` is a no-op (mask must be 0).

use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use spamm_aggregator::helpers::verify_signer;

use crate::mm_helpers::verify_mm_config_auth;

pub const SET_CONFIG_VALUES_IX_DISCRIMINATOR: u8 = 3;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [admin, config_pda, _unused] = accounts else {
      log!("set_config_values: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(admin)?;
   verify_mm_config_auth(program_id, admin, config_pda)?;

   if unlikely(data.is_empty()) {
      return Err(ProgramError::InvalidInstructionData);
   }

   let mask = data[0];
   if unlikely(mask != 0) {
      log!("set_config_values: promo MM does not support config patches (use set_market_max_amount)");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(data.len() != 1) {
      return Err(ProgramError::InvalidInstructionData);
   }

   Ok(())
}
