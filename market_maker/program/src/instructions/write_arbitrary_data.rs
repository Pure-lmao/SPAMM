use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError};
use pinocchio_log::log;
use spamm_aggregator::{helpers::verify_signer, writers::write_arbitrary_bytes_unchecked};

use crate::mm_helpers::verify_mm_config_auth;

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [admin, config_pda, data_pda] = accounts else {
      log!("write_arbitrary_data: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&admin)?;
   verify_mm_config_auth(&admin, &config_pda)?;

   unsafe {
      write_arbitrary_bytes_unchecked(data_pda.data_mut_ptr(), 0, data);
   }

   Ok(())
}