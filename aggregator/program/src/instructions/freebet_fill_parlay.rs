//! Freebet auction fill for a parlay (disc 16). Stake from issuer ATA.
//!
//! Accounts: **15** then **6 + 2 × L** (`L` = `num_legs`).
//!
//! **Fixed (15)**
//! 0. `feepayer` (writable signer)
//! 1. `user` (readonly signer)
//! 2. `issuer_pda` (readonly) — PDA signer for the stake transfer
//! 3. `issuer_ata` (writable) — stake source (replaces `user_ata` on `fill_parlay`)
//! 4. `freebet_pda` (writable) — marked used after a successful fill
//! 5. `bet_pda` (writable)
//! 6. `bet_ata` (writable)
//! 7. `config_pda` (readonly)
//! 8. `mint` (readonly)
//! 9. `token_program` (readonly)
//! 10. `associated_token_program` (readonly)
//! 11. `rent_sysvar` (readonly)
//! 12. `system_program` (readonly)
//! 13. `instructions_sysvar` (readonly)
//! 14. `clock_sysvar` (readonly)
//!
//! **MM (6 + 2 × L)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_parlay_quote_buffer` (writable)
//! 3. `mm_encumbrance_pda` (writable)
//! 4. `mm_liability_token_account` (writable)
//! 5. `mm_token_account` (writable)
//! 6+2*i. `mm_market_data_pda` (readonly),
//!    `mm_event_state_pda` (readonly) per leg *i*
//!
//! Data: `freebet_id: u32` then fill_parlay body.

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::{
   helpers::freebet_helpers::{decode_and_verify_freebet_for_ix, mark_freebet_used},
   instructions::{
      fill_bet::FillBetStake,
      fill_parlay::decode_and_run_fill_parlay,
   },
   state::split_freebet_id_prefix,
};

pub const FREEBET_FILL_PARLAY_IX_DISCRIMINATOR: u8 = 16;

#[inline(never)]
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      feepayer,
      user,
      issuer_pda,
      issuer_ata,
      freebet_pda,
      bet_pda,
      bet_ata,
      config_pda,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
      instructions_sysvar,
      clock_sysvar,
      rest @ ..,
   ] = accounts else {
      log!("freebet_fill_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let (freebet_id, ix_body) = split_freebet_id_prefix(data)?;
   let (fb, issuer_bump) = decode_and_verify_freebet_for_ix(freebet_pda, issuer_pda, freebet_id)?;
   let auth = fb.issuer_auth;
   decode_and_run_fill_parlay(
      feepayer,
      user,
      bet_pda,
      bet_ata,
      config_pda,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
      instructions_sysvar,
      clock_sysvar,
      rest,
      ix_body,
      FillBetStake {
         token_account: issuer_ata,
         authority: issuer_pda,
         issuer_sign: Some((issuer_bump, auth)),
         freebet_id,
         freebet: Some(&fb),
      },
   )?;
   mark_freebet_used(freebet_pda)?;
   Ok(())
}
