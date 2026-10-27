//! Open one encumbrance PDA and its liability ATA for a mint.
//!
//! The MM must already be on the list, and its config ATA for this mint must already exist.
//! Call once per mint. Seeds: `["encumbrance", mm_program, mint]`.
//!
//! Accounts (12):
//! 0. `mm_admin` (writable signer)
//! 1. `mm_program` (readonly)
//! 2. `mm_config_pda` (readonly)
//! 3. `mm_list_pda` (readonly)
//! 4. `mm_encumbrance_pda` (writable)
//! 5. `mm_liability_token_account` (writable)
//! 6. `mm_token_account` (readonly) — existing ATA of the MM config for this mint
//! 7. `mint` (readonly)
//! 8. `token_program` (readonly)
//! 9. `associated_token_program` (readonly)
//! 10. `rent_sysvar` (readonly)
//! 11. `system_program` (readonly)
//!
//! Data: none.

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent as CreateATA;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
   ID,
   helpers::{
      ensure_pda_unused, find_encumbrance_pda, find_mm_program_in_list, get_rent,
      verify_associated_token_program, verify_mint, verify_mm_admin, verify_mm_list_pda,
      verify_mm_program_executable, verify_rent_sysvar, verify_signer, verify_system_program,
      verify_token_account, verify_token_program,
   },
   state::other::{
      MM_ENCUMBRANCE_PDA_DISCRIMINATOR, MM_ENCUMBRANCE_PDA_LEN, MM_ENCUMBRANCE_PDA_SEED,
      MmEncumbrancePdaDataZc,
   },
};

pub const INIT_MM_MINT_VAULT_IX_DISCRIMINATOR: u8 = 4;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      mm_admin,
      mm_program,
      mm_config_pda,
      mm_list_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
   ] = accounts else {
      log!("init_mm_mint_vault: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if unlikely(!data.is_empty()) {
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_signer(mm_admin)?;
   verify_mm_program_executable(mm_program)?;
   verify_mm_admin(mm_admin, mm_program, mm_config_pda)?;
   verify_mm_list_pda(mm_list_pda)?;
   find_mm_program_in_list(mm_list_pda, mm_program.address())?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;
   verify_mint(mint, mint.address())?;
   verify_token_account(true, mm_token_account, mm_config_pda, mint, token_program, true)?;
   ensure_pda_unused(mm_encumbrance_pda, "init_mm_mint_vault")?;

   let (expected, bump) = find_encumbrance_pda(mm_program.address(), mint.address());
   if unlikely(!address_eq(mm_encumbrance_pda.address(), &expected)) {
      log!("init_mm_mint_vault: encumbrance pda mismatch");
      return Err(ProgramError::InvalidSeeds);
   }

   let bump_seed = [bump];
   let seeds = [
      Seed::from(MM_ENCUMBRANCE_PDA_SEED),
      Seed::from(mm_program.address().as_ref()),
      Seed::from(mint.address().as_ref()),
      Seed::from(&bump_seed),
   ];
   let signer = Signer::from(&seeds);

   CreateAccount {
      from: mm_admin,
      to: mm_encumbrance_pda,
      lamports: get_rent(rent_sysvar, MM_ENCUMBRANCE_PDA_LEN as u64)?,
      space: MM_ENCUMBRANCE_PDA_LEN as u64,
      owner: &ID,
   }
   .invoke_signed(&[signer])?;

   unsafe {
      let p = mm_encumbrance_pda.data_mut_ptr();
      let enc = MmEncumbrancePdaDataZc {
         discriminator: MM_ENCUMBRANCE_PDA_DISCRIMINATOR.into(),
         bump: bump.into(),
         encumbrance: 0u64.into(),
         open_cashout_tickets: 0u32.into(),
      };
      core::ptr::write(p.cast::<MmEncumbrancePdaDataZc>(), enc);
   }

   CreateATA {
      funding_account: mm_admin,
      account: mm_liability_token_account,
      wallet: mm_encumbrance_pda,
      mint,
      token_program,
      system_program,
   }
   .invoke()?;

   Ok(())
}
