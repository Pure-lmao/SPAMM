use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::helpers::{close_pda_return_rent, verify_authority, verify_config_pda, verify_signer};



pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
   let [
      authority,
      config_pda,
      pda
   ] = accounts else {
      log!("force_close_pda: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&authority)?;
   verify_config_pda(&config_pda, false)?;
   verify_authority(&authority, config_pda)?;

   close_pda_return_rent(pda, authority)?;

   Ok(())
}