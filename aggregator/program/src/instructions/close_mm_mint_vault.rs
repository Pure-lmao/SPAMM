//! Close one extra mint vault without removing the MM from the list.
//!
//! Deregister closes the last vault and drops the list entry. Call this first for every other mint.
//!
//! Accounts (10):
//! 0. `mm_admin` (writable signer) — receives ATA dust and PDA rent
//! 1. `mm_program` (readonly)
//! 2. `mm_config_pda` (readonly)
//! 3. `mm_encumbrance_pda` (writable)
//! 4. `mm_liability_token_account` (writable)
//! 5. `mm_token_account` (writable) — config ATA that receives any leftover tokens
//! 6. `mint` (readonly)
//! 7. `token_program` (readonly)
//! 8. `associated_token_program` (readonly)
//! 9. `system_program` (readonly)
//!
//! Data: none. Encumbrance must be zero.

use pinocchio::{
   AccountView, ProgramResult, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;

use crate::helpers::{
   close_pda_return_rent, get_encumbrance, get_open_cashout_tickets, safe_close_ata, verify_associated_token_program,
   verify_mint, verify_mm_admin, verify_mm_encumbrance_pda, verify_mm_program_executable,
   verify_signer, verify_system_program, verify_token_account, verify_token_program,
};
use crate::state::other::MM_ENCUMBRANCE_PDA_SEED;

pub const CLOSE_MM_MINT_VAULT_IX_DISCRIMINATOR: u8 = 5;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      mm_admin,
      mm_program,
      mm_config_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
      mint,
      token_program,
      associated_token_program,
      system_program,
   ] = accounts else {
      log!("close_mm_mint_vault: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if unlikely(!data.is_empty()) {
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_signer(mm_admin)?;
   verify_mm_program_executable(mm_program)?;
   verify_mm_admin(mm_admin, mm_program, mm_config_pda)?;
   verify_system_program(system_program)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;
   verify_mint(mint, mint.address())?;
   verify_token_account(true, mm_liability_token_account, mm_encumbrance_pda, mint, token_program, true)?;
   verify_token_account(true, mm_token_account, mm_config_pda, mint, token_program, true)?;

   let Some(encumbrance_bump) = verify_mm_encumbrance_pda(
      mm_encumbrance_pda,
      mm_program,
      mint.address(),
   ) else {
      log!("close_mm_mint_vault: invalid encumbrance pda");
      return Err(ProgramError::InvalidAccountOwner);
   };
   let encumbrance = get_encumbrance(mm_encumbrance_pda)?;
   let open_cashouts = get_open_cashout_tickets(mm_encumbrance_pda)?;
   if unlikely(encumbrance != 0 || open_cashouts != 0) {
      log!("close_mm_mint_vault: encumbrance and open cashouts must be zero");
      return Err(ProgramError::InvalidAccountData);
   }

   let bump_seed = [encumbrance_bump];
   let seeds = [
      Seed::from(MM_ENCUMBRANCE_PDA_SEED),
      Seed::from(mm_program.address().as_ref()),
      Seed::from(mint.address().as_ref()),
      Seed::from(&bump_seed),
   ];
   let signer = Signer::from(&seeds);

   safe_close_ata(
      mm_liability_token_account,
      mm_admin,
      mm_token_account,
      mm_encumbrance_pda,
      &[signer],
   )?;
   close_pda_return_rent(mm_encumbrance_pda, mm_admin)?;
   Ok(())
}
