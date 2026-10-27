//! Promo issuer PDA, per-mint ATAs, and withdraw.
//!
//! `init_promo_issuer` (160) — create the issuer PDA only. Data: none.
//! **Accounts (4)**
//! 0. `auth` (writable signer)
//! 1. `issuer_pda` (writable)
//! 2. `rent_sysvar` (readonly)
//! 3. `system_program` (readonly)
//!
//! `remove_promo_issuer` (161) — close the PDA when `open_count == 0`. Close every ATA first. Data: none.
//! **Accounts (2)**
//! 0. `auth` (writable signer)
//! 1. `issuer_pda` (writable)
//!
//! `withdraw_freebet_funds` (162) — auth-only transfer out of one issuer ATA. Data: `amount: u64`.
//! **Accounts (6)**
//! 0. `auth` (signer)
//! 1. `issuer_pda` (readonly)
//! 2. `issuer_ata` (writable)
//! 3. `dest_ata` (writable)
//! 4. `mint` (readonly)
//! 5. `token_program` (readonly)
//!
//! `create_promo_issuer_ata` (163) — create the issuer ATA for one mint. Call again for each extra mint. Data: none.
//! **Accounts (7)**
//! 0. `auth` (writable signer)
//! 1. `issuer_pda` (readonly)
//! 2. `issuer_ata` (writable)
//! 3. `mint` (readonly)
//! 4. `token_program` (readonly)
//! 5. `associated_token_program` (readonly)
//! 6. `system_program` (readonly)
//!
//! `close_promo_issuer_ata` (164) — drain and close one issuer ATA. Requires `open_count == 0`. Data: none.
//! **Accounts (6)**
//! 0. `auth` (writable signer)
//! 1. `issuer_pda` (readonly) — signs the close
//! 2. `issuer_ata` (writable)
//! 3. `dest_ata` (writable)
//! 4. `mint` (readonly)
//! 5. `token_program` (readonly)

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::Signer,
   error::ProgramError, hint::unlikely,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent as CreateAta;
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
   state::{PROMO_ISSUER_DISCRIMINATOR, PROMO_ISSUER_LEN, PromoIssuer},
};

pub const INIT_PROMO_ISSUER_IX_DISCRIMINATOR: u8 = 160;
pub const REMOVE_PROMO_ISSUER_IX_DISCRIMINATOR: u8 = 161;
pub const WITHDRAW_FREEBET_FUNDS_IX_DISCRIMINATOR: u8 = 162;

/// Init the issuer PDA. Create each mint's ATA with `create_promo_issuer_ata`.
/// Accounts: **4**
/// 0. `auth` (writable signer)
/// 1. `issuer_pda` (writable)
/// 2. `rent_sysvar` (readonly)
/// 3. `system_program` (readonly)
///
/// Data: none
pub fn process_init(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth,
      issuer_pda,
      rent_sysvar,
      system_program,
   ] = accounts else {
      log!("init_promo_issuer: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   if unlikely(!data.is_empty()) {
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_signer(auth)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   ensure_pda_unused(issuer_pda, "init_promo_issuer")?;

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
      lamports: get_rent(rent_sysvar, PROMO_ISSUER_LEN as u64)?,
      space: PROMO_ISSUER_LEN as u64,
      owner: &ID,
   }
   .invoke_signed(&signers)?;

   let body = PromoIssuer {
      discriminator: PROMO_ISSUER_DISCRIMINATOR,
      bump,
      auth: *auth.address(),
      open_count: 0,
   };
   {
      let mut data = issuer_pda.try_borrow_mut()?;
      body.write_to_account(&mut data)?;
   }
   Ok(())
}

/// Close the issuer PDA when `open_count == 0`. Close every ATA first.
/// Accounts: **2**
/// 0. `auth` (writable signer)
/// 1. `issuer_pda` (writable)
///
/// Data: none
pub fn process_remove(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth,
      issuer_pda,
   ] = accounts else {
      log!("remove_promo_issuer: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   if unlikely(!data.is_empty()) {
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_signer(auth)?;
   verify_freebet_issuer_pda(issuer_pda, auth.address())?;
   if unlikely(get_issuer_open_count(issuer_pda) != 0) {
      log!("remove_promo_issuer: open_count != 0");
      return Err(ProgramError::InvalidAccountData);
   }
   close_pda_return_rent(issuer_pda, auth)?;
   Ok(())
}

pub const CREATE_PROMO_ISSUER_ATA_IX_DISCRIMINATOR: u8 = 163;
pub const CLOSE_PROMO_ISSUER_ATA_IX_DISCRIMINATOR: u8 = 164;

/// Create the issuer ATA for one mint. Call again for each extra mint.
/// Accounts: **7**
/// 0. `auth` (writable signer)
/// 1. `issuer_pda` (readonly)
/// 2. `issuer_ata` (writable)
/// 3. `mint` (readonly)
/// 4. `token_program` (readonly)
/// 5. `associated_token_program` (readonly)
/// 6. `system_program` (readonly)
///
/// Data: none
pub fn process_create_ata(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth,
      issuer_pda,
      issuer_ata,
      mint,
      token_program,
      _associated_token_program,
      system_program,
   ] = accounts else {
      log!("create_promo_issuer_ata: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   if unlikely(!data.is_empty()) {
      return Err(ProgramError::InvalidInstructionData);
   }
   verify_signer(auth)?;
   verify_system_program(system_program)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(_associated_token_program)?;
   verify_mint(mint, mint.address())?;
   verify_freebet_issuer_pda(issuer_pda, auth.address())?;
   CreateAta {
      funding_account: auth,
      account: issuer_ata,
      wallet: issuer_pda,
      mint,
      system_program,
      token_program,
   }
   .invoke()?;
   verify_token_account(true, issuer_ata, issuer_pda, mint, token_program, true)?;
   Ok(())
}

/// Drain and close one issuer ATA. Close every ATA before `remove_promo_issuer`.
/// Accounts: **6**
/// 0. `auth` (writable signer)
/// 1. `issuer_pda` (readonly) — signs the close
/// 2. `issuer_ata` (writable)
/// 3. `dest_ata` (writable)
/// 4. `mint` (readonly)
/// 5. `token_program` (readonly)
///
/// Data: none
pub fn process_close_ata(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth,
      issuer_pda,
      issuer_ata,
      dest_ata,
      mint,
      token_program,
   ] = accounts else {
      log!("close_promo_issuer_ata: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   if unlikely(!data.is_empty()) {
      return Err(ProgramError::InvalidInstructionData);
   }
   verify_signer(auth)?;
   verify_token_program(token_program)?;
   verify_mint(mint, mint.address())?;
   let bump = verify_freebet_issuer_pda(issuer_pda, auth.address())?;
   verify_token_account(true, issuer_ata, issuer_pda, mint, token_program, true)?;
   verify_token_account(true, dest_ata, auth, mint, token_program, false)?;
   if unlikely(get_issuer_open_count(issuer_pda) != 0) {
      log!("close_promo_issuer_ata: open_count != 0");
      return Err(ProgramError::InvalidAccountData);
   }
   let bump_bytes = [bump];
   let auth_addr = *auth.address();
   let seeds = issuer_signer_seeds(&auth_addr, &bump_bytes);
   let signers = [Signer::from(&seeds)];
   safe_close_ata(issuer_ata, auth, dest_ata, issuer_pda, &signers)?;
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
   verify_mint(mint, mint.address())?;
   let bump = verify_freebet_issuer_pda(issuer_pda, auth.address())?;
   verify_token_account(true, issuer_ata, issuer_pda, mint, token_program, true)?;
   verify_token_account(true, dest_ata, auth, mint, token_program, false)?;

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
