//! Create the config PDA's collateral ATA for one mint.

use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError};
use pinocchio_associated_token_account::instructions::CreateIdempotent as CreateAssociatedTokenAccount;
use pinocchio_log::log;
use spamm_aggregator::helpers::{
   verify_associated_token_program, verify_mint, verify_signer, verify_system_program, verify_token_program,
};

use crate::mm_helpers::verify_mm_config_auth;

pub const CREATE_TOKEN_ACCOUNT_IX_DISCRIMINATOR: u8 = 102;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   if !data.is_empty() {
      return Err(ProgramError::InvalidInstructionData);
   }
   let [
      admin, config_pda, token_account, mint, token_program, associated_token_program, system_program,
   ] = accounts else {
      log!("create_token_account: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_signer(admin)?;
   verify_mm_config_auth(program_id, admin, config_pda)?;
   verify_mint(mint, mint.address())?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;
   verify_system_program(system_program)?;
   CreateAssociatedTokenAccount {
      funding_account: admin,
      account: token_account,
      wallet: config_pda,
      mint,
      token_program,
      system_program,
   }
   .invoke()?;
   Ok(())
}
