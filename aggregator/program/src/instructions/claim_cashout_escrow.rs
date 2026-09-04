//! Permissionless claim of a live cashout escrow after `LIVE_CASHOUT_DELAY`.
//!
//! Accounts: **15**
//! 0. `feepayer` (writable signer) — tx fee payer; not the rent destination
//! 1. `rent_recipient` (writable) — must equal `escrow.feepayer`; receives escrow PDA rent / ATA close lamports
//! 2. `ticket_feepayer` (writable) — original ticket `feepayer`; receives orig PDA/ATA rent on full cashout
//! 3. `user` (readonly) — escrow owner
//! 4. `user_ata` (writable)
//! 5. `escrow_pda` (writable)
//! 6. `escrow_ata` (writable)
//! 7. `original_bet_pda` (writable) — closed if result is CashedOut
//! 8. `original_bet_ata` (writable) — closed if result is CashedOut
//! 9. `cashout_pda` (readonly) — used to detect RolledBack
//! 10. `config_pda` (readonly)
//! 11. `mint` (readonly)
//! 12. `token_program` (readonly)
//! 13. `system_program` (readonly)
//! 14. `clock_sysvar` (readonly)

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError,
   hint::unlikely,
};
use pinocchio_log::log;

use crate::{
   ID, constants::LIVE_CASHOUT_DELAY, errors::SpammError, helpers::{
      cashout_helpers::verify_ticket_feepayer, clock_unix_timestamp_u32, close_pda_return_rent, derive_cashout_escrow_pda, safe_close_ata, verify_bet_pda, verify_cashout_pda, verify_cashout_parlay_pda, verify_clock_sysvar, verify_config_pda, verify_mint, verify_parlay_pda, verify_signer, verify_system_program, verify_token_account, verify_token_program,
   }, readers::read_u8_unchecked, state::{
      BetAccountData, CASHOUT_ESCROW_SEED, CashoutEscrow, account_bet::{BET_ACCOUNT_SEED, BetResult}, account_cashout::{
         CASHOUT_ACCOUNT_BUMP_OFFSET, CASHOUT_ACCOUNT_DISCRIMINATOR, CASHOUT_ACCOUNT_MIN_LEN,
         CASHOUT_RESULT_OFFSET,
      }, account_cashout_parlay::{
         CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR, CASHOUT_PARLAY_ACCOUNT_MIN_LEN,
         CASHOUT_PARLAY_BUMP_OFFSET, CASHOUT_PARLAY_RESULT_OFFSET,
      }, account_parlay_bet::{PARLAY_BET_ACCOUNT_SEED, ParlayBetAccountData},
   },
};

pub const CLAIM_CASHOUT_ESCROW_IX_DISCRIMINATOR: u8 = 74;

#[inline(never)]
pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
   let [
      feepayer,
      rent_recipient,
      ticket_feepayer,
      user,
      user_ata,
      escrow_pda,
      escrow_ata,
      original_bet_pda,
      original_bet_ata,
      cashout_pda,
      config_pda,
      mint,
      token_program,
      system_program,
      clock_sysvar,
   ] = accounts else {
      log!("claim_cashout_escrow: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(feepayer)?;
   verify_token_program(token_program)?;
   verify_system_program(system_program)?;
   verify_clock_sysvar(clock_sysvar)?;
   verify_mint(mint)?;
   verify_config_pda(config_pda, true)?;
   verify_token_account(true, user_ata, user, mint, token_program)?;

   if unlikely(!address_eq(escrow_pda.owner(), &ID)) {
      return Err(ProgramError::InvalidAccountData);
   }
   let escrow = {
      let raw = escrow_pda.try_borrow()?;
      CashoutEscrow::decode(raw.as_ref())?
   };
   if unlikely(!address_eq(&escrow.owner, user.address())) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(!address_eq(rent_recipient.address(), &escrow.feepayer)) {
      log!("claim_cashout_escrow: rent_recipient must equal escrow.feepayer");
      return Err(ProgramError::InvalidInstructionData);
   }
   let expected_escrow = derive_cashout_escrow_pda(user.address(), escrow.orig_bet_id, escrow.bump);
   if unlikely(!address_eq(escrow_pda.address(), &expected_escrow)) {
      return Err(ProgramError::InvalidSeeds);
   }
   verify_token_account(true, escrow_ata, escrow_pda, mint, token_program)?;

   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   let ready_at = escrow.timestamp
      .checked_add(LIVE_CASHOUT_DELAY).ok_or(ProgramError::ArithmeticOverflow)?;
   if unlikely(now < ready_at) {
      return Err(SpammError::CashoutDelayNotElapsed.into());
   }

   let (orig_result, orig_bump, orig_feepayer) =
      read_original_result(original_bet_pda, user.address(), &escrow)?;
   verify_ticket_feepayer(ticket_feepayer, &orig_feepayer)?;
   let cashout_result = read_cashout_result(cashout_pda, &escrow)?;
   if orig_result == BetResult::RolledBack || cashout_result == BetResult::RolledBack {
      return Err(SpammError::CashoutMustRevert.into());
   }

   verify_token_account(true, original_bet_ata, original_bet_pda, mint, token_program)?;

   let orig_id_bytes = escrow.orig_bet_id.to_le_bytes();
   let bump_bytes = [escrow.bump];
   let signer_seed = [
      Seed::from(CASHOUT_ESCROW_SEED),
      Seed::from(user.address().as_ref()),
      Seed::from(&orig_id_bytes),
      Seed::from(&bump_bytes),
   ];
   let signers = [Signer::from(&signer_seed)];
   // Token CloseAccount CPIs must finish before close_pda_return_rent (direct lamports).
   safe_close_ata(escrow_ata, rent_recipient, user_ata, escrow_pda, &signers)?;
   
   let orig_bump_bytes = [orig_bump];
   let orig_seed = if escrow.is_parlay {
      PARLAY_BET_ACCOUNT_SEED
   } else {
      BET_ACCOUNT_SEED
   };
   let orig_signer_seed = [
      Seed::from(orig_seed),
      Seed::from(user.address().as_ref()),
      Seed::from(&orig_id_bytes),
      Seed::from(&orig_bump_bytes),
   ];
   let orig_signers = [Signer::from(&orig_signer_seed)];
   if orig_result == BetResult::CashedOut {
      safe_close_ata(original_bet_ata, ticket_feepayer, user_ata, original_bet_pda, &orig_signers)?;
   }
   close_pda_return_rent(escrow_pda, rent_recipient)?;
   if orig_result == BetResult::CashedOut {
      close_pda_return_rent(original_bet_pda, ticket_feepayer)?;
   }

   Ok(())
}

fn read_original_result(
   pda: &AccountView,
   owner: &pinocchio::Address,
   escrow: &CashoutEscrow,
) -> Result<(BetResult, u8, pinocchio::Address), ProgramError> {
   if pda.data_len() == 0 || !address_eq(pda.owner(), &ID) {
      return Err(SpammError::InvalidCashout.into());
   }
   let raw = pda.try_borrow()?;
   let data = raw.as_ref();
   if escrow.is_parlay {
      let h = ParlayBetAccountData::decode_header(data)?;
      if unlikely(h.bet_id != escrow.orig_bet_id) {
         return Err(SpammError::InvalidCashout.into());
      }
      verify_parlay_pda(pda, owner, escrow.orig_bet_id, h.bump)?;
      Ok((h.result, h.bump, h.feepayer))
   } else {
      let h = BetAccountData::decode_header(data)?;
      if unlikely(h.bet_id != escrow.orig_bet_id) {
         return Err(SpammError::InvalidCashout.into());
      }
      verify_bet_pda(pda, owner, escrow.orig_bet_id, h.bump)?;
      Ok((h.result, h.bump, h.feepayer))
   }
}

fn read_cashout_result(pda: &AccountView, escrow: &CashoutEscrow) -> Result<BetResult, ProgramError> {
   if unlikely(!address_eq(pda.owner(), &ID)) {
      return Err(SpammError::InvalidCashout.into());
   }
   let (min_len, disc_expected, bump_off, result_off) = if escrow.is_parlay {
      (
         CASHOUT_PARLAY_ACCOUNT_MIN_LEN,
         CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR,
         CASHOUT_PARLAY_BUMP_OFFSET,
         CASHOUT_PARLAY_RESULT_OFFSET,
      )
   } else {
      (
         CASHOUT_ACCOUNT_MIN_LEN,
         CASHOUT_ACCOUNT_DISCRIMINATOR,
         CASHOUT_ACCOUNT_BUMP_OFFSET,
         CASHOUT_RESULT_OFFSET,
      )
   };
   if unlikely(pda.data_len() < min_len) {
      return Err(SpammError::InvalidCashout.into());
   }
   let ptr = pda.data_ptr();
   let disc = unsafe { read_u8_unchecked(ptr, 0) };
   if unlikely(disc != disc_expected) {
      return Err(ProgramError::InvalidAccountData);
   }
   let bump = unsafe { read_u8_unchecked(ptr, bump_off) };
   if escrow.is_parlay {
      verify_cashout_parlay_pda(pda, &escrow.market_maker, escrow.cashout_id, bump)?;
   } else {
      verify_cashout_pda(pda, &escrow.market_maker, escrow.cashout_id, bump)?;
   }
   BetResult::from_u8(unsafe { read_u8_unchecked(ptr, result_off) })
}
