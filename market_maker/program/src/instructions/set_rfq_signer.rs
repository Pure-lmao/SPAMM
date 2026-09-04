//! Admin-only update of `MmAccountConfig::rfq_signer`.
//!
//! Accounts **(3)**:
//! 0. `admin` (signer)
//! 1. `config_pda` (writable)
//! 2. `rfq_signer` (readonly) — new ed25519 pubkey written into the config header

use pinocchio::{AccountView, error::ProgramError, hint::unlikely, ProgramResult};
use pinocchio_log::log;

use crate::mm_helpers::verify_mm_config_auth;
use spamm_aggregator::{
   constants::ADDRESS_LEN,
   helpers::verify_signer,
   state::mm_account_config::MM_CONFIG_PDA_RFQ_SIGNER_OFFSET,
   writers::write_arbitrary_bytes_unchecked,
};

pub const SET_RFQ_SIGNER_IX_DISCRIMINATOR: u8 = 101;

pub fn process(_program_id: &pinocchio::Address, accounts: &mut [AccountView]) -> ProgramResult {
   let [admin, config_pda, rfq_signer] = accounts else {
      log!("set_rfq_signer: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(admin)?;
   verify_mm_config_auth(admin, config_pda)?;

   if unlikely(config_pda.data_len() < MM_CONFIG_PDA_RFQ_SIGNER_OFFSET + ADDRESS_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }

   unsafe {
      write_arbitrary_bytes_unchecked(
         config_pda.data_mut_ptr(),
         MM_CONFIG_PDA_RFQ_SIGNER_OFFSET,
         rfq_signer.address().as_ref(),
      );
   }

   Ok(())
}
