//! Init / remove issuer PDA+ATA and withdraw promo funds from the issuer ATA.
//!
//! `init_freebet_issuer` (60) — create issuer PDA + ATA. Data: none.
//! **Accounts (8)**
//! 0. `auth` (writable signer)
//! 1. `issuer_pda` (writable)
//! 2. `issuer_ata` (writable)
//! 3. `mint` (readonly)
//! 4. `token_program` (readonly)
//! 5. `associated_token_program` (readonly)
//! 6. `rent_sysvar` (readonly)
//! 7. `system_program` (readonly)
//!
//! `remove_freebet_issuer` (61) — drain ATA, close ATA + PDA (`open_count` must be 0). Data: none.
//! **Accounts (8)**
//! 0. `auth` (writable signer)
//! 1. `issuer_pda` (writable)
//! 2. `issuer_ata` (writable)
//! 3. `auth_ata` (writable)
//! 4. `mint` (readonly)
//! 5. `token_program` (readonly)
//! 6. `associated_token_program` (readonly)
//! 7. `system_program` (readonly)
//!
//! `withdraw_freebet_funds` (62) — auth-only transfer out of the issuer ATA. Data: `amount: u64`.
//! **Accounts (6)**
//! 0. `auth` (signer)
//! 1. `issuer_pda` (readonly)
//! 2. `issuer_ata` (writable)
//! 3. `dest_ata` (writable)
//! 4. `mint` (readonly)
//! 5. `token_program` (readonly)

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::Signer,
   error::ProgramError, hint::unlikely,
};
use pinocchio_associated_token_account::instructions::Create as CreateAta;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer;

use crate::{
   ID,
   helpers::{
      close_pda_return_rent, ensure_pda_unused, find_freebet_issuer_pda, get_rent, safe_close_ata, verify_associated_token_program,
      verify_mint, verify_rent_sysvar, verify_signer, verify_system_program, verify_token_account, verify_token_program,
      freebet_helpers::{get_issuer_open_count, issuer_signer_seeds, verify_freebet_issuer_pda},
      get_token_account_balance,
   },
   readers::read_u64_le_unchecked,
   state::{FREEBET_ISSUER_DISCRIMINATOR, FREEBET_ISSUER_LEN, FreebetIssuer},
};

pub const INIT_FREEBET_ISSUER_IX_DISCRIMINATOR: u8 = 60;
pub const REMOVE_FREEBET_ISSUER_IX_DISCRIMINATOR: u8 = 61;
pub const WITHDRAW_FREEBET_FUNDS_IX_DISCRIMINATOR: u8 = 62;

/// Init issuer PDA + ATA
/// Accounts: **8**
/// 0. `auth` (writable signer)
/// 1. `issuer_pda` (writable)
/// 2. `issuer_ata` (writable)
/// 3. `mint` (readonly)
/// 4. `token_program` (readonly)
/// 5. `associated_token_program` (readonly)
/// 6. `rent_sysvar` (readonly)
/// 7. `system_program` (readonly)
///
/// Data: empty
pub fn process_init(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth,
      issuer_pda,
      issuer_ata,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
   ] = accounts else {
      log!("init_freebet_issuer: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   if unlikely(!data.is_empty()) {
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_signer(auth)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;
   verify_mint(mint)?;
   ensure_pda_unused(issuer_pda, "init_freebet_issuer")?;

   let (expected, bump) = find_freebet_issuer_pda(auth.address());
   if unlikely(!address_eq(issuer_pda.address(), &expected)) {
      log!("init_freebet_issuer: pda mismatch");
      return Err(ProgramError::InvalidSeeds);
   }

   let bump_bytes = [bump];
   let seeds = issuer_signer_seeds(auth.address(), &bump_bytes);
   let signers = [Signer::from(&seeds)];

   CreateAccount {
      from: auth,
      to: issuer_pda,
      lamports: get_rent(rent_sysvar, FREEBET_ISSUER_LEN as u64)?,
      space: FREEBET_ISSUER_LEN as u64,
      owner: &ID,
   }
   .invoke_signed(&signers)?;

   let body = FreebetIssuer {
      discriminator: FREEBET_ISSUER_DISCRIMINATOR,
      bump,
      auth: *auth.address(),
      open_count: 0,
   };
   {
      let mut data = issuer_pda.try_borrow_mut()?;
      body.write_to_account(&mut data)?;
   }

   CreateAta {
      funding_account: auth,
      account: issuer_ata,
      wallet: issuer_pda,
      mint,
      system_program,
      token_program,
   }
   .invoke()?;
   verify_token_account(true, issuer_ata, issuer_pda, mint, token_program)?;
   Ok(())
}

/// Remove issuer PDA + ATA
/// Accounts: **8**
/// 0. `auth` (writable signer)
/// 1. `issuer_pda` (writable)
/// 2. `issuer_ata` (writable)
/// 3. `auth_ata` (writable)
/// 4. `mint` (readonly)
/// 5. `token_program` (readonly)
/// 6. `associated_token_program` (readonly)
/// 7. `system_program` (readonly)
///
/// Data: empty
pub fn process_remove(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth,
      issuer_pda,
      issuer_ata,
      auth_ata,
      mint,
      token_program,
      _associated_token_program,
      _system_program,
   ] = accounts else {
      log!("remove_freebet_issuer: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   if unlikely(!data.is_empty()) {
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_signer(auth)?;
   verify_token_program(token_program)?;
   verify_mint(mint)?;
   let bump = verify_freebet_issuer_pda(issuer_pda, auth.address())?;
   verify_token_account(true, issuer_ata, issuer_pda, mint, token_program)?;
   verify_token_account(true, auth_ata, auth, mint, token_program)?;

   if unlikely(get_issuer_open_count(issuer_pda) != 0) {
      log!("remove_freebet_issuer: open_count != 0");
      return Err(ProgramError::InvalidAccountData);
   }

   let bump_bytes = [bump];
   let auth_addr = *auth.address();
   let seeds = issuer_signer_seeds(&auth_addr, &bump_bytes);
   let signers = [Signer::from(&seeds)];
   safe_close_ata(issuer_ata, auth, auth_ata, issuer_pda, &signers)?;
   close_pda_return_rent(issuer_pda, auth)?;
   Ok(())
}

/// Withdraw freebet funds from the issuer ATA
/// Accounts: **6**
/// 0. `auth` (signer)
/// 1. `issuer_pda` (readonly)
/// 2. `issuer_ata` (writable)
/// 3. `dest_ata` (writable)
/// 4. `mint` (readonly)
/// 5. `token_program` (readonly)
///
/// Data: `amount: u64`
pub fn process_withdraw(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth,
      issuer_pda,
      issuer_ata,
      dest_ata,
      mint,
      token_program,
   ] = accounts else {
      log!("withdraw_freebet_funds: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   if unlikely(data.len() != 8) {
      return Err(ProgramError::InvalidInstructionData);
   }
   let amount = unsafe { read_u64_le_unchecked(data.as_ptr(), 0) };
   if unlikely(amount == 0) {
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_signer(auth)?;
   verify_token_program(token_program)?;
   verify_mint(mint)?;
   let bump = verify_freebet_issuer_pda(issuer_pda, auth.address())?;
   verify_token_account(true, issuer_ata, issuer_pda, mint, token_program)?;
   verify_token_account(true, dest_ata, auth, mint, token_program)?;

   let bal = get_token_account_balance(issuer_ata)?;
   if unlikely(amount > bal) {
      log!("withdraw_freebet_funds: amount > balance");
      return Err(ProgramError::InvalidInstructionData);
   }

   let bump_bytes = [bump];
   let seeds = issuer_signer_seeds(auth.address(), &bump_bytes);
   let signers = [Signer::from(&seeds)];
   Transfer::new(issuer_ata, dest_ata, issuer_pda, amount).invoke_signed(&signers)?;
   Ok(())
}
