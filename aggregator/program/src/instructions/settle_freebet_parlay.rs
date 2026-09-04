//! Settle a graded freebet parlay (disc 28).
//! Stake / dust → issuer ATA; profit → user ATA. Then reinstate or consume the freebet PDA.
//!
//! Accounts: **18**
//! 0. `signer` (signer)
//! 1. `bet_account` (writable)
//! 2. `bet_ata` (writable)
//! 3. `bet_feepayer` (writable)
//! 4. `user` (readonly)
//! 5. `user_ata` (writable)
//! 6. `issuer_auth` (writable)
//! 7. `issuer_pda` (writable)
//! 8. `issuer_ata` (writable)
//! 9. `freebet_pda` (writable)
//! 10. `config_pda` (readonly)
//! 11. `mint` (readonly)
//! 12. `token_program` (readonly)
//! 13. `clock_sysvar` (readonly)
//! 14. `mm_address` (readonly)
//! 15. `mm_config_pda` (readonly)
//! 16. `mm_encumbrance_pda` (writable)
//! 17. `mm_liability_token_account` (writable)
//!
//! No cashout escrow / dest-encumbrance metas — freebets cannot be cashed out.
//!
//! Data: none

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::{
   helpers::{
      clock_unix_timestamp_u32, freebet_helpers::{
         apply_freebet_settle_state, require_is_freebet, verify_freebet_settle_preamble,
      }, verify_clock_sysvar,
   },
   instructions::settle_parlay::{decode_settle_parlay_ticket, settle_parlay_core},
};

pub const SETTLE_FREEBET_PARLAY_IX_DISCRIMINATOR: u8 = 28;

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
      freebet_pda,
      our_config_pda,
      mint,
      token_program,
      clock_sysvar,
      mm_address,
      mm_config_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
   ] = accounts else {
      log!("settle_freebet_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_clock_sysvar(clock_sysvar)?;

   let (ticket, _is_cashout) = decode_settle_parlay_ticket(bet_account, true)?;
   require_is_freebet(ticket.freebet_id)?;
   verify_freebet_settle_preamble(
      ticket.freebet_id,
      user,
      issuer_auth,
      issuer_pda,
      issuer_ata,
      freebet_pda,
      mint,
      token_program,
   )?;

   let (result, amount, _) = settle_parlay_core(
      signer,
      bet_account,
      bet_ata,
      bet_feepayer,
      user,
      issuer_ata,
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
   apply_freebet_settle_state(
      result,
      amount,
      now,
      freebet_pda,
      issuer_pda,
      issuer_auth,
   )
}
