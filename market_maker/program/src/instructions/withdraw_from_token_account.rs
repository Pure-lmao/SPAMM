//! Withdraw the full MM collateral ATA balance to a destination ATA.
//!
//! Accounts **(6)**:
//! 0. `admin` (writable signer) — must match config admin
//! 1. `config_pda` (readonly)
//! 2. `token_account` (writable) — MM ATA (authority = config PDA)
//! 3. `mint` (readonly)
//! 4. `token_program` (readonly)
//! 5. `destination_ata` (writable)
//!
//! Data: none

use pinocchio::{AccountView, Address, ProgramResult, cpi::{Seed, Signer}, error::ProgramError};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;
use spamm_aggregator::{helpers::{get_token_account_balance, verify_mint, verify_signer, verify_token_account, verify_token_program}, state::{MM_ACCOUNT_CONFIG_SEED, mm_account_config::MM_CONFIG_PDA_BUMP_OFFSET}};

use crate::mm_helpers::verify_mm_config_auth;

pub const WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR: u8 = 150;

pub fn process(_program_id: &Address, accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
   let [
      admin,
      config_pda,
      token_account,
      mint,
      token_program,
      destination_ata,
   ] = accounts else {
      log!("withdraw_from_token_account: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&admin)?;
   verify_mm_config_auth(&admin, &config_pda)?;
   verify_token_account(true, token_account, config_pda, mint, token_program)?;
   verify_mint(&mint)?;
   verify_token_program(&token_program)?;

   let balance = get_token_account_balance(token_account)?;

   if balance == 0 {
      log!("withdraw_from_token_account: token account balance is 0");
      return Err(ProgramError::InvalidInstructionData);
   }

   let mm_config_pda_data = config_pda.try_borrow()?;

   let config_bump_seed = [mm_config_pda_data[MM_CONFIG_PDA_BUMP_OFFSET]];
   let config_pda_seeds = [
      Seed::from(MM_ACCOUNT_CONFIG_SEED),
      Seed::from(&config_bump_seed),
   ];

   let config_signer = Signer::from(&config_pda_seeds);

   Transfer::new(
      token_account,
      destination_ata,
      config_pda,
      balance
   ).invoke_signed(&[config_signer])?;

   Ok(())
}