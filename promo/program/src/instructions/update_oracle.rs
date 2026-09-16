//! Admin odds refresh for a promo market-data PDA.
//!
//! Accounts **(3)**:
//! 0. `admin` (signer) — must match `config_pda.admin`
//! 1. `config_pda` (readonly)
//! 2. `mm_market_data_pda` (writable)
//!
//! Instruction `data` (after router discriminator): `sequence` u32 LE + 3× scaled odds u32 LE.

use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use spamm_aggregator::helpers::verify_signer;
use spamm_aggregator::readers::read_u32_le_unchecked;
use spamm_aggregator::writers::write_u32_le_unchecked;

use crate::mm_helpers::verify_mm_config_auth;
use crate::state::account_oracle::{
   ORACLE_DISCRIMINATOR, ORACLE_SEQUENCE_OFFSET, ORACLE_SIZE, OUTCOME_ODDS0_OFFSET,
   OUTCOME_ODDS1_OFFSET, OUTCOME_ODDS2_OFFSET, read_discriminator, read_sequence,
};

pub const UPDATE_ORACLE_IX_DISCRIMINATOR: u8 = 0;
const PAYLOAD_LEN: usize = 16;

#[inline(never)]
pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [admin, config_pda, mm_market_data_pda] = accounts else {
      log!("update_oracle: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(admin)?;
   verify_mm_config_auth(program_id, admin, config_pda)?;

   if unlikely(data.len() != PAYLOAD_LEN) {
      log!("update_oracle: payload length mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(mm_market_data_pda.data_len() != ORACLE_SIZE as usize) {
      log!("update_oracle: market data wrong length");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(!address_eq_owner(mm_market_data_pda, program_id)) {
      return Err(ProgramError::InvalidAccountOwner);
   }

   let ptr = mm_market_data_pda.data_mut_ptr();
   unsafe {
      if read_discriminator(ptr) != ORACLE_DISCRIMINATOR {
         log!("update_oracle: market data discriminator invalid");
         return Err(ProgramError::InvalidAccountData);
      }

      let current_sequence = read_sequence(ptr);
      let new_sequence = read_u32_le_unchecked(data.as_ptr(), 0);
      if new_sequence <= current_sequence {
         log!("update_oracle: sequence not increasing");
         return Err(ProgramError::InvalidInstructionData);
      }

      let odds0 = read_u32_le_unchecked(data.as_ptr(), 4);
      let odds1 = read_u32_le_unchecked(data.as_ptr(), 8);
      let odds2 = read_u32_le_unchecked(data.as_ptr(), 12);

      write_u32_le_unchecked(ptr, ORACLE_SEQUENCE_OFFSET, new_sequence);
      write_u32_le_unchecked(ptr, OUTCOME_ODDS0_OFFSET, odds0);
      write_u32_le_unchecked(ptr, OUTCOME_ODDS1_OFFSET, odds1);
      write_u32_le_unchecked(ptr, OUTCOME_ODDS2_OFFSET, odds2);
   }

   Ok(())
}

#[inline(always)]
fn address_eq_owner(account: &AccountView, program_id: &Address) -> bool {
   pinocchio::address::address_eq(account.owner(), program_id)
}
