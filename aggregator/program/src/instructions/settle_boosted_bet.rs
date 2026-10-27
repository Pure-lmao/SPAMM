//! Settle a graded boosted single (disc 114).
//! `settle_fillers` pays stake and market-maker profit as a normal bet.
//! The issuer ATA then pays `actual_profit * boost_bps / 10000`.
//! `actual_profit` is what the market-maker liability ATAs paid on this settle.
//!
//! Accounts: **14** then **5 × N** (`N` = `num_fillers` on the bet).
//! Same shape as `settle_freebet`, with `boost_pda` in the freebet slot.
//! The user ATA is both the stake destination and the profit destination.
//!
//! **Fixed (14)**
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

use pinocchio::{AccountView, ProgramResult, cpi::Signer, error::ProgramError};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::{
   constants::MAX_NUMBER_OF_MMS,
   helpers::{
      apply_boost_settle_state, clock_unix_timestamp_u32, get_token_account_balance, issuer_signer_seeds,
      require_is_boost, verify_boost_settle_accounts, verify_clock_sysvar,
      verify_config_pda, verify_mint, verify_signer, verify_token_account, verify_token_program,
   },
   instructions::settle_bet::{
      decode_settle_bet_ticket, settle_fillers, sum_mm_profit_paid, unwind_fillers_encumbrance_after_settle,
      user_stake_from_bet_ata, validate_settle_bet_ticket,
   },
   state::{BetFiller, BET_ACCOUNT_SEED},
};

pub const SETTLE_BOOSTED_BET_IX_DISCRIMINATOR: u8 = 114;

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
      filler_accounts @ ..,
   ] = accounts else {
      log!("settle_boosted_bet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(signer)?;
   verify_config_pda(our_config_pda, true)?;
   verify_token_program(token_program)?;
   verify_clock_sysvar(clock_sysvar)?;

   let mut fillers_buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let ticket = decode_settle_bet_ticket(bet_account, &mut fillers_buf, false)?;
   let header = ticket.header;
   verify_mint(mint, &header.market_id.mint)?;
   let num_fillers = header.num_fillers as usize;
   let fillers = unsafe {
      core::slice::from_raw_parts(fillers_buf.as_ptr().cast::<BetFiller>(), num_fillers)
   };
   require_is_boost(header.promo_type)?;
   let (boost, issuer_bump) = verify_boost_settle_accounts(
      boost_pda,
      issuer_auth,
      issuer_pda,
      issuer_ata,
      user,
      mint,
      token_program,
      &header.promo_account,
   )?;
   validate_settle_bet_ticket(&header, bet_feepayer, user, filler_accounts)?;
   verify_token_account(true, user_ata, user, mint, token_program, false)?;
   verify_token_account(true, bet_ata, bet_account, mint, token_program, true)?;

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
      user_ata,
      user_ata,
      mint,
      token_program,
      filler_accounts,
      BET_ACCOUNT_SEED,
   )?;
   unwind_fillers_encumbrance_after_settle(&header, fillers, filler_accounts)?;
   crate::helpers::close_pda_return_rent(bet_account, bet_feepayer)?;

   let actual_profit = sum_mm_profit_paid(header.result, fillers)?;
   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   let pay = apply_boost_settle_state(
      header.result,
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
