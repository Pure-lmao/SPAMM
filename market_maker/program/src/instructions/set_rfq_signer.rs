//! Admin-only update of `MmAccountConfig::rfq_signer`.
//!
//! Accounts **(2)**:
//! 0. `admin` (signer)
//! 1. `config_pda` (writable)

use pinocchio::{AccountView, error::ProgramError, hint::unlikely, ProgramResult};
use pinocchio_log::log;

use crate::mm_helpers::verify_mm_config_auth;
use crate::state::SetRfqSignerIxPayload;
use spamm_aggregator::helpers::verify_signer;
use spamm_aggregator::state::mm_account_config::MM_CONFIG_PDA_RFQ_SIGNER_OFFSET;
use spamm_aggregator::writers::write_arbitrary_bytes_unchecked;

pub const SET_RFQ_SIGNER_IX_DISCRIMINATOR: u8 = 15;

pub fn process(_program_id: &pinocchio::Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [admin, config_pda] = accounts else {
      log!("set_rfq_signer: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(admin)?;
   verify_mm_config_auth(admin, config_pda)?;

   let parsed = SetRfqSignerIxPayload::decode(data)?;

   if unlikely(config_pda.data_len() < MM_CONFIG_PDA_RFQ_SIGNER_OFFSET + 32) {
      return Err(ProgramError::InvalidAccountData);
   }

   unsafe {
      write_arbitrary_bytes_unchecked(
         config_pda.data_mut_ptr(),
         MM_CONFIG_PDA_RFQ_SIGNER_OFFSET,
         parsed.rfq_signer.as_ref(),
      );
   }

   Ok(())
}
