use pinocchio::{account::AccountView, error::ProgramError, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
   checks::{admin_is, collateral_owner, token_account},
   instructions::token::transfer_from_config,
};
use spamm_aggregator::{
   helpers::{get_token_account_balance, verify_signer},
};

pub const WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR: u8 = 150;

pub fn process(program_id: &Address, accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
   let [
      admin,         // `verify_signer`; `admin_is`
      config,        // `admin_is`; `transfer_from_config`
      source,        // `token_account` (owner = config)
      mint,          // `verify_mint` via `token_account`
      token_program, // `verify_token_program` via `token_account`
      destination,   // `token_account` (mint only)
   ] = accounts else {
      log!("withdraw: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_signer(admin)?;
   if !admin_is(admin, config, program_id) {
      log!("withdraw: admin");
      return Err(ProgramError::IncorrectAuthority);
   }
   token_account(source, mint, token_program, Some(collateral_owner()))?;
   token_account(destination, mint, token_program, None)?;
   let balance = get_token_account_balance(source)?;
   if balance == 0 {
      log!("withdraw: empty");
      return Err(ProgramError::InvalidAccountData);
   }
   transfer_from_config(program_id, config, source, destination, balance)
}
