//! Create a freebet PDA for `user` (account meta, not ix data). Increments issuer `open_count`.
//!
//! Accounts: **7**
//! 0. `auth` (writable signer)
//! 1. `issuer_pda` (writable)
//! 2. `user` (readonly)
//! 3. `freebet_pda` (writable)
//! 4. `rent_sysvar` (readonly)
//! 5. `system_program` (readonly)
//! 6. `clock_sysvar` (readonly)
//!
//! Data: `freebet_id u32`, `expiry u32`, `amount u64`, `min_odds_scaled u32`, `max_odds_scaled u32`,
//! `min_legs u8`, `num_mms u8`, `num_operators u8`, then `Address × num_mms`, then `Address × num_operators`.

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
   ID, helpers::{
      clock_unix_timestamp_u32, ensure_pda_unused, find_freebet_pda, freebet_helpers::{freebet_space, verify_freebet_issuer_pda}, get_rent, verify_clock_sysvar, verify_rent_sysvar, verify_signer, verify_system_program,
   }, state::{
      FREEBET_ACCOUNT_DISCRIMINATOR, FREEBET_ACCOUNT_SEED, FreebetAccountData, FreebetAccountHeader, FreebetState, IssueFreebetIxData, bump_open_count,
   },
};

pub const ISSUE_FREEBET_IX_DISCRIMINATOR: u8 = 63;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth,
      issuer_pda,
      user,
      freebet_pda,
      rent_sysvar,
      system_program,
      clock_sysvar,
   ] = accounts else {
      log!("issue_freebet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(auth)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   verify_clock_sysvar(clock_sysvar)?;
   verify_freebet_issuer_pda(issuer_pda, auth.address())?;
   ensure_pda_unused(freebet_pda, "issue_freebet")?;

   let parsed = IssueFreebetIxData::decode(data)?;
   let freebet_id = parsed.freebet_id;
   let expiry = parsed.expiry;
   let amount = parsed.amount;
   let min_odds_scaled = parsed.min_odds_scaled;
   let max_odds_scaled = parsed.max_odds_scaled;
   let min_legs = parsed.min_legs;
   let num_mms = parsed.num_mms as usize;
   let num_operators = parsed.num_operators as usize;
   let allowed_mms = parsed.allowed_mms;
   let allowed_operators = parsed.allowed_operators;

   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   if unlikely(now >= expiry) {
      log!("issue_freebet: expiry not in the future");
      return Err(ProgramError::InvalidInstructionData);
   }

   let id_bytes = freebet_id.to_le_bytes();
   let (expected, bump) = find_freebet_pda(auth.address(), freebet_id);
   if unlikely(!address_eq(freebet_pda.address(), &expected)) {
      log!("issue_freebet: pda mismatch");
      return Err(ProgramError::InvalidSeeds);
   }

   let bump_bytes = [bump];
   let signer_seeds = [
      Seed::from(FREEBET_ACCOUNT_SEED),
      Seed::from(auth.address().as_ref()),
      Seed::from(&id_bytes),
      Seed::from(&bump_bytes),
   ];
   let signers = [Signer::from(&signer_seeds)];
   let space = freebet_space(num_mms, num_operators) as u64;
   CreateAccount {
      from: auth,
      to: freebet_pda,
      lamports: get_rent(rent_sysvar, space)?,
      space,
      owner: &ID,
   }
   .invoke_signed(&signers)?;

   let header = FreebetAccountHeader {
      discriminator: FREEBET_ACCOUNT_DISCRIMINATOR,
      bump,
      state: FreebetState::Available,
      num_mms: num_mms as u8,
      min_legs,
      num_operators: num_operators as u8,
      freebet_id,
      expiry,
      min_odds_scaled,
      max_odds_scaled,
      amount,
      issuer_auth: *auth.address(),
      user: *user.address(),
   };
   {
      let mut acc = freebet_pda.try_borrow_mut()?;
      FreebetAccountData::write_header_and_allowlists(
         &mut acc,
         &header,
         &allowed_mms[..num_mms],
         &allowed_operators[..num_operators],
      )?;
   }

   {
      let mut issuer_data = issuer_pda.try_borrow_mut()?;
      bump_open_count(&mut issuer_data, 1)?;
   }
   Ok(())
}
