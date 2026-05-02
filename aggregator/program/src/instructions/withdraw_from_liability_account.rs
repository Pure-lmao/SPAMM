//! Withdraw funds from the liability account to the token account
//! 
//! Accounts: **9**
//! 0. `mm_authority` (writable signer)
//! 1. `mm_program_account` (readonly)
//! 2. `mm_config_pda` (writable)
//! 3. `mm_encumbrance_pda` (writable)
//! 4. `mm_liability_token_account` (writable)
//! 5. `mm_token_account` (writable)
//! 6. `mint` (readonly)
//! 7. `token_program` (readonly)
//! 
//! Data (after router discriminator in `lib.rs`): amount (u64)
use pinocchio::{AccountView, ProgramResult, cpi::{Seed, Signer}, error::ProgramError};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::{helpers::{verify_mint, verify_mm_admin, verify_mm_encumbrance_pda, verify_signer, verify_token_account, verify_token_program}, 
parsers::{get_encumbrance, get_token_account_balance}, 
readers::read_u64_le_unchecked, state::other::MM_ENCUMBRANCE_PDA_SEED};


pub const WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR: u8 = 100;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {

   let [
      mm_authority,
      mm_program_account,
      mm_config_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
      mint,
      token_program,
   ] = accounts else {
      log!("withdraw_from_liability_account: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&mm_authority)?;
   verify_mm_admin(mm_authority, mm_program_account, mm_config_pda)?;
   verify_mint(mint)?;
   verify_token_program(token_program)?;

   let Some(valid_mm_encumbrance_pda_bump) =
      verify_mm_encumbrance_pda(mm_encumbrance_pda, mm_program_account)
   else {
      log!("withdraw_from_liability_account: invalid mm liability pda");
      return Err(ProgramError::InvalidAccountOwner);
   };

   verify_token_account(true, 
      mm_liability_token_account, mm_encumbrance_pda, mint, token_program)?;
   verify_token_account(true, 
      mm_token_account, mm_config_pda, mint, token_program)?;

   if data.len() != 8 {
      log!("withdraw_from_liability_account: data length mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }

   let amount = unsafe {
      read_u64_le_unchecked(data.as_ptr(), 0)
   };

   let liability_balance = get_token_account_balance(mm_liability_token_account)?;

   let encumbrance = get_encumbrance(mm_encumbrance_pda)?;
   let encumbrance_u64: u64 = if encumbrance < 0 {
      0
   } else {
      encumbrance.try_into().unwrap()
   };

   let free_balance = liability_balance.checked_sub(encumbrance_u64).unwrap_or(0);

   if amount > free_balance {
      log!("withdraw_from_liability_account: amount is greater than free balance");
      return Err(ProgramError::InvalidInstructionData);
   }

   let mm_encumbrance_pda_bump_seed = [valid_mm_encumbrance_pda_bump];
   let encumbrance_pda_seeds = [
      Seed::from(MM_ENCUMBRANCE_PDA_SEED),
      Seed::from(mm_program_account.address().as_ref()),
      Seed::from(&mm_encumbrance_pda_bump_seed),
   ];

   let encumbrance_pda_signer = Signer::from(&encumbrance_pda_seeds);

   Transfer::new(
      mm_liability_token_account,
      mm_token_account,
      mm_encumbrance_pda,
      amount
   ).invoke_signed(&[encumbrance_pda_signer])?;

   Ok(())
}

