//! Settle a graded freebet single ticket (disc 27).
//! Stake / dust → issuer ATA; profit → user ATA. Then reinstate or consume the freebet PDA.
//!
//! Accounts: **14** then **5 × N** (`N` = `num_fillers` on the bet).
//!
//! **Fixed (14)**
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
//!
//! **Per filler (5 each)**
//! 0. `mm_address` (readonly)
//! 1. `mm_config_pda` (readonly)
//! 2. `mm_encumbrance_pda` (writable)
//! 3. `mm_liability_token_account` (writable)
//! 4. `mm_netting_pda` (writable) — real netting PDA if the fill was netted, else system program
//!
//! Data: none

use core::mem::MaybeUninit;

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::{
   constants::MAX_NUMBER_OF_MMS,
   helpers::{
      clock_unix_timestamp_u32, close_pda_return_rent, get_token_account_balance, verify_clock_sysvar, verify_config_pda,
      verify_mint, verify_signer, verify_token_account, verify_token_program,
      freebet_helpers::{
         apply_freebet_settle_state, require_is_freebet, verify_freebet_settle_preamble,
      },
   },
   instructions::settle_bet::{
      decode_settle_bet_ticket, settle_fillers, unwind_fillers_encumbrance_after_settle,
      user_stake_from_bet_ata, validate_settle_bet_ticket,
   },
   state::{BetFiller, BET_ACCOUNT_SEED},
};

pub const SETTLE_FREEBET_IX_DISCRIMINATOR: u8 = 27;

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
      filler_accounts @ ..,
   ] = accounts else {
      log!("settle_freebet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(signer)?;
   verify_config_pda(our_config_pda, true)?;
   verify_token_program(token_program)?;
   verify_mint(mint)?;
   verify_clock_sysvar(clock_sysvar)?;

   let mut fillers_buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let ticket = decode_settle_bet_ticket(bet_account, &mut fillers_buf, false)?;
   let header = ticket.header;
   let num_fillers = header.num_fillers as usize;
   let fillers = unsafe {
      core::slice::from_raw_parts(fillers_buf.as_ptr().cast::<BetFiller>(), num_fillers)
   };
   require_is_freebet(header.freebet_id)?;
   verify_freebet_settle_preamble(
      header.freebet_id,
      user,
      issuer_auth,
      issuer_pda,
      issuer_ata,
      freebet_pda,
      mint,
      token_program,
   )?;
   validate_settle_bet_ticket(&header, bet_feepayer, user, filler_accounts)?;

   verify_token_account(true, user_ata, user, mint, token_program)?;
   verify_token_account(true, bet_ata, bet_account, mint, token_program)?;

   let amount_to_stake_dest = user_stake_from_bet_ata(header.result, header.amount)?;
   let bet_ata_start = get_token_account_balance(bet_ata)?;

   settle_fillers(
      &header,
      fillers,
      amount_to_stake_dest,
      bet_ata_start,
      user,
      bet_account,
      bet_ata,
      bet_feepayer,
      issuer_ata,
      user_ata,
      mint,
      token_program,
      filler_accounts,
      BET_ACCOUNT_SEED,
   )?;

   unwind_fillers_encumbrance_after_settle(&header, fillers, filler_accounts)?;

   close_pda_return_rent(bet_account, bet_feepayer)?;

   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   apply_freebet_settle_state(
      header.result,
      header.amount,
      now,
      freebet_pda,
      issuer_pda,
      issuer_auth,
   )
}
