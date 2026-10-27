//! Create a boost PDA for `user` (account meta, not ix data). Increments the promo issuer `open_count`.
//!
//! Accounts: **8**
//! 0. `auth` (writable signer)
//! 1. `issuer_pda` (writable)
//! 2. `user` (readonly)
//! 3. `boost_pda` (writable)
//! 4. `mint` (readonly)
//! 5. `rent_sysvar` (readonly)
//! 6. `system_program` (readonly)
//! 7. `clock_sysvar` (readonly)
//!
//! Data: `boost_id u32`, `expiry u32`, `max_stake u64`, `min_odds_scaled u32`, `max_odds_scaled u32`,
//! `boost_bps u32`, `min_legs u8`, `num_mms u8`, `num_operators u8`, then `Address × num_mms`,
//! then `Address × num_operators`.

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
   ID, helpers::{
      min_amount_for_decimals,
      clock_unix_timestamp_u32, ensure_pda_unused, find_boost_pda, get_rent, verify_clock_sysvar,
      verify_freebet_issuer_pda, verify_mint, verify_rent_sysvar, verify_signer, verify_system_program,
   }, state::{
      validate_amount_over_min, BOOST_ACCOUNT_DISCRIMINATOR, BOOST_ACCOUNT_SEED, BoostAccountData,
      BoostAccountHeader, PromoState, IssueBoostIxData, boost_account_len, bump_open_count,
   },
};

pub const ISSUE_BOOST_IX_DISCRIMINATOR: u8 = 167;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth,
      issuer_pda,
      user,
      boost_pda,
      mint,
      rent_sysvar,
      system_program,
      clock_sysvar,
   ] = accounts else {
      log!("issue_boost: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(auth)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   verify_clock_sysvar(clock_sysvar)?;
   verify_freebet_issuer_pda(issuer_pda, auth.address())?;
   let decimals = verify_mint(mint, mint.address())?;
   let min_stake = min_amount_for_decimals(decimals);
   ensure_pda_unused(boost_pda, "issue_boost")?;

   let parsed = IssueBoostIxData::decode(data)?;
   validate_amount_over_min(parsed.max_stake, min_stake, "issue_boost")?;
   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   if unlikely(now >= parsed.expiry) {
      return Err(ProgramError::InvalidInstructionData);
   }

   let id_bytes = parsed.boost_id.to_le_bytes();
   let (expected, bump) = find_boost_pda(
      auth.address(),
      mint.address(),
      parsed.boost_id,
   );
   if unlikely(!address_eq(boost_pda.address(), &expected)) {
      return Err(ProgramError::InvalidSeeds);
   }
   let bump_bytes = [bump];
   let signer_seeds = [
      Seed::from(BOOST_ACCOUNT_SEED),
      Seed::from(auth.address().as_ref()),
      Seed::from(mint.address().as_ref()),
      Seed::from(&id_bytes),
      Seed::from(&bump_bytes),
   ];
   let space = boost_account_len(parsed.num_mms as usize, parsed.num_operators as usize) as u64;
   CreateAccount {
      from: auth,
      to: boost_pda,
      lamports: get_rent(rent_sysvar, space)?,
      space,
      owner: &ID,
   }
   .invoke_signed(&[Signer::from(&signer_seeds)])?;

   let header = BoostAccountHeader {
      discriminator: BOOST_ACCOUNT_DISCRIMINATOR,
      bump,
      state: PromoState::Available,
      num_mms: parsed.num_mms,
      min_legs: parsed.min_legs,
      num_operators: parsed.num_operators,
      boost_id: parsed.boost_id,
      expiry: parsed.expiry,
      min_odds_scaled: parsed.min_odds_scaled,
      max_odds_scaled: parsed.max_odds_scaled,
      boost_bps: parsed.boost_bps,
      max_stake: parsed.max_stake,
      issuer_auth: *auth.address(),
      user: *user.address(),
      mint: *mint.address(),
   };
   {
      let mut acc = boost_pda.try_borrow_mut()?;
      BoostAccountData::write_header_and_allowlists(
         &mut acc,
         &header,
         &parsed.allowed_mms[..parsed.num_mms as usize],
         &parsed.allowed_operators[..parsed.num_operators as usize],
      )?;
   }
   {
      let mut issuer_data = issuer_pda.try_borrow_mut()?;
      bump_open_count(&mut issuer_data, 1)?;
   }
   Ok(())
}
