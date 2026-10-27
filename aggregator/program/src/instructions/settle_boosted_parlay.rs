//! Settle a graded boosted parlay (disc 115).
//! Stake and market-maker profit follow a normal parlay settle.
//! The issuer ATA then pays `actual_profit * boost_bps / 10000`.
//! `actual_profit` is what the market maker liability ATA paid on this settle.
//!
//! Accounts: **18**
//! 0. `signer` (signer)
//! 1. `bet_account` (writable)
//! 2. `bet_ata` (writable)
//! 3. `bet_feepayer` (writable)
//! 4. `user` (readonly)
//! 5. `user_ata` (writable) — stake destination, market-maker profit, and boost profit
//! 6. `issuer_auth` (writable)
//! 7. `issuer_pda` (writable) — signs the boost transfer
//! 8. `issuer_ata` (writable) — boost profit source
//! 9. `boost_pda` (writable)
//! 10. `config_pda` (readonly)
//! 11. `mint` (readonly)
//! 12. `token_program` (readonly)
//! 13. `clock_sysvar` (readonly)
//! 14. `mm_address` (readonly)
//! 15. `mm_config_pda` (readonly)
//! 16. `mm_encumbrance_pda` (writable)
//! 17. `mm_liability_token_account` (writable)
//!
//! No cashout escrow / dest-encumbrance metas — boosts cannot be cashed out.
//!
//! Data: none

use pinocchio::{AccountView, ProgramResult, cpi::Signer, error::ProgramError};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::{
   helpers::{
      apply_boost_settle_state, clock_unix_timestamp_u32, issuer_signer_seeds, require_is_boost,
      verify_boost_settle_accounts, verify_clock_sysvar,
   },
   instructions::settle_parlay::{decode_settle_parlay_ticket, settle_parlay_core},
};

pub const SETTLE_BOOSTED_PARLAY_IX_DISCRIMINATOR: u8 = 115;

pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
   let [
      signer,
      bet_account,
      bet_ata,
      bet_feepayer,
      user,
      user_ata,
      issuer_auth,
      issuer_pda,
      issuer_ata,
      boost_pda,
      our_config_pda,
      mint,
      token_program,
      clock_sysvar,
      mm_address,
      mm_config_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
   ] = accounts else {
      log!("settle_boosted_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_clock_sysvar(clock_sysvar)?;
   let (ticket, _is_cashout) = decode_settle_parlay_ticket(bet_account, false)?;
   require_is_boost(ticket.promo_type)?;
   let (boost, issuer_bump) = verify_boost_settle_accounts(
      boost_pda,
      issuer_auth,
      issuer_pda,
      issuer_ata,
      user,
      mint,
      token_program,
      &ticket.promo_account,
   )?;
   // Promo settles have no cashout escrow. `true` skips that account.
   let (result, _amount, actual_profit) = settle_parlay_core(
      signer,
      bet_account,
      bet_ata,
      bet_feepayer,
      user,
      user_ata,
      user_ata,
      our_config_pda,
      mint,
      token_program,
      mm_address,
      mm_config_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
      None,
      None,
      true,
      Some(ticket),
   )?;

   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   let pay = apply_boost_settle_state(
      result,
      actual_profit,
      boost.boost_bps,
      now,
      boost_pda,
      issuer_pda,
      issuer_auth,
   )?;
   if pay > 0 {
      let bump_bytes = [issuer_bump];
      let seeds = issuer_signer_seeds(&boost.issuer_auth, &bump_bytes);
      Transfer::new(
         issuer_ata,
         user_ata,
         issuer_pda,
         pay,
      )
      .invoke_signed(&[Signer::from(&seeds)])?;
   }
   Ok(())
}
