//! Freebet auction fill for a single bet (disc 15). Stake from issuer ATA.
//!
//! Accounts: **15** then **9 × N** (`N` = number of market makers).
//!
//! **Fixed (15)**
//! 0. `feepayer` (writable signer) — pays netting PDA rent if a fill inserts a new line
//! 1. `user` (readonly signer)
//! 2. `issuer_pda` (readonly) — PDA signer for the stake transfer
//! 3. `issuer_ata` (writable) — stake source (replaces `user_ata` on `fill_bet`)
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
//! **Per MM (9 each)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_event_state_pda` (writable)
//! 3. `mm_market_data_pda` (writable)
//! 4. `mm_quote_buffer` (writable)
//! 5. `mm_encumbrance_pda` (writable)
//! 6. `mm_liability_token_account` (writable)
//! 7. `mm_token_account` (writable)
//! 8. `mm_netting_pda` (writable) — real netting PDA, or **system program** if no netting account exists
//!
//! Data: `freebet_id: u32` then [`FillBetIxData`].

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::{
   helpers::freebet_helpers::{
      decode_and_verify_freebet_for_ix, mark_freebet_used,
   },
   instructions::fill_bet::{FillBetStake, run_fill_bet},
   state::FreebetFillBetIxData,
};

pub const FREEBET_FILL_BET_IX_DISCRIMINATOR: u8 = 15;

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
      mm_accounts @ ..,
   ] = accounts else {
      log!("freebet_fill_bet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let decoded = FreebetFillBetIxData::decode(data)?;
   let freebet_id = decoded.freebet_id;
   let parsed = decoded.fill;
   let (fb, issuer_bump) = decode_and_verify_freebet_for_ix(freebet_pda, issuer_pda, freebet_id)?;
   let auth = fb.issuer_auth;
   run_fill_bet(
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
      mm_accounts,
      parsed,
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
