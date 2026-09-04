//! Permissionless revert of a live cashout when original or cashout is RolledBack.
//!
//! Restores A'/P'/fillers onto the original ticket, returns C to the filling MM
//! liability ATA, and closes cashout + escrow PDAs/ATAs.
//!
//! Accounts: **18**
//! 0. `feepayer` (writable signer) — tx fee payer; not the rent destination
//! 1. `rent_recipient` (writable) — must equal `escrow.feepayer`
//! 2. `user` (readonly) — original ticket owner / escrow owner
//! 3. `user_ata` (writable) — dust destination for ATA closes
//! 4. `original_bet_pda` (writable)
//! 5. `original_bet_ata` (writable)
//! 6. `cashout_pda` (writable)
//! 7. `cashout_ata` (writable)
//! 8. `escrow_pda` (writable)
//! 9. `escrow_ata` (writable)
//! 10. `mm_program` (readonly) — filling MM
//! 11. `mm_config_pda` (readonly)
//! 12. `mm_encumbrance_pda` (readonly) — authority of the liability ATA
//! 13. `mm_liability_token_account` (writable) — receives C
//! 14. `config_pda` (readonly)
//! 15. `mint` (readonly)
//! 16. `token_program` (readonly)
//! 17. `system_program` (readonly)

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;
use core::mem::MaybeUninit;

use crate::{
   ID, constants::MAX_NUMBER_OF_MMS, errors::SpammError,
   helpers::{
      close_pda_return_rent, derive_cashout_escrow_pda,
      safe_close_ata, verify_config_pda, verify_mint, verify_mm_config_pda, verify_mm_encumbrance_pda,
      verify_signer, verify_system_program, verify_token_account, verify_token_program,
      cashout_helpers::add_parlay_amounts,
      verify_bet_pda, verify_cashout_pda, verify_cashout_parlay_pda, verify_parlay_pda,
   },
   state::{
      account_bet::{BetFiller, BetResult},
      account_parlay_bet::{ParlayBetAccountData},
      CashoutAccountData, CashoutEscrow, CashoutParlayAccountData, CASHOUT_ACCOUNT_SEED,
      CASHOUT_ESCROW_SEED, CASHOUT_PARLAY_ACCOUNT_SEED, BetAccountData,
   },
};

pub const REVERT_CASHOUT_IX_DISCRIMINATOR: u8 = 75;

struct CashoutCloseInfo {
   seed: &'static [u8],
   mm: Address,
   cashout_id: u64,
   bump: u8,
}

#[inline(never)]
pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
   let [
      feepayer,
      rent_recipient,
      user,
      user_ata,
      original_bet_pda,
      original_bet_ata,
      cashout_pda,
      cashout_ata,
      escrow_pda,
      escrow_ata,
      mm_program,
      mm_config_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
      config_pda,
      mint,
      token_program,
      system_program,
   ] = accounts else {
      log!("revert_cashout: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(feepayer)?;
   verify_token_program(token_program)?;
   verify_system_program(system_program)?;
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
      log!("revert_cashout: rent_recipient must equal escrow.feepayer");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(!address_eq(&escrow.market_maker, mm_program.address())) {
      return Err(SpammError::InvalidCashout.into());
   }
   let expected_escrow = derive_cashout_escrow_pda(user.address(), escrow.orig_bet_id, escrow.bump);
   if unlikely(!address_eq(escrow_pda.address(), &expected_escrow)) {
      return Err(ProgramError::InvalidSeeds);
   }
   verify_token_account(true, escrow_ata, escrow_pda, mint, token_program)?;

   if !verify_mm_config_pda(mm_config_pda, mm_program) {
      return Err(SpammError::MmNotRegistered.into());
   }
   if verify_mm_encumbrance_pda(mm_encumbrance_pda, mm_program).is_none() {
      log!("revert_cashout: invalid mm encumbrance pda");
      return Err(ProgramError::InvalidAccountOwner);
   }
   verify_token_account(true, mm_liability_token_account, mm_encumbrance_pda, mint, token_program)?;

   let close_info = if escrow.is_parlay {
      restore_parlay(
         user,
         original_bet_pda,
         original_bet_ata,
         cashout_pda,
         cashout_ata,
         &escrow,
         mint,
         token_program,
      )?
   } else {
      restore_single(
         user,
         original_bet_pda,
         original_bet_ata,
         cashout_pda,
         cashout_ata,
         &escrow,
         mint,
         token_program,
      )?
   };

   // C escrow → filling MM liability ATA, then close ATAs (all CPIs) before any direct lamport moves.
   let orig_id_bytes = escrow.orig_bet_id.to_le_bytes();
   let escrow_bump_bytes = [escrow.bump];
   let escrow_signer = [
      Seed::from(CASHOUT_ESCROW_SEED),
      Seed::from(user.address().as_ref()),
      Seed::from(&orig_id_bytes),
      Seed::from(&escrow_bump_bytes),
   ];
   let escrow_signers = [Signer::from(&escrow_signer)];
   if escrow.payment > 0 {
      Transfer::new(escrow_ata, mm_liability_token_account, escrow_pda, escrow.payment)
         .invoke_signed(&escrow_signers)?;
   }

   let co_id = close_info.cashout_id.to_le_bytes();
   let co_bump = [close_info.bump];
   let co_signer = [
      Seed::from(close_info.seed),
      Seed::from(close_info.mm.as_ref()),
      Seed::from(&co_id),
      Seed::from(&co_bump),
   ];
   let co_signers = [Signer::from(&co_signer)];

   // Token CloseAccount CPIs must finish before close_pda_return_rent (direct lamports).
   safe_close_ata(escrow_ata, rent_recipient, user_ata, escrow_pda, &escrow_signers)?;
   safe_close_ata(cashout_ata, rent_recipient, user_ata, cashout_pda, &co_signers)?;
   close_pda_return_rent(escrow_pda, rent_recipient)?;
   close_pda_return_rent(cashout_pda, rent_recipient)?;

   Ok(())
}

fn restore_single(
   user: &AccountView,
   original_bet_pda: &mut AccountView,
   original_bet_ata: &AccountView,
   cashout_pda: &AccountView,
   cashout_ata: &AccountView,
   escrow: &CashoutEscrow,
   mint: &AccountView,
   token_program: &AccountView,
) -> Result<CashoutCloseInfo, ProgramError> {
   if unlikely(!address_eq(cashout_pda.owner(), &ID) || !address_eq(original_bet_pda.owner(), &ID)) {
      return Err(ProgramError::InvalidAccountData);
   }
   let mut co_fillers_buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let cashout = {
      let raw = cashout_pda.try_borrow()?;
      let h = CashoutAccountData::decode_header(raw.as_ref())?;
      let n = h.num_fillers as usize;
      CashoutAccountData::decode_fillers_into(raw.as_ref(), n, &mut co_fillers_buf)?;
      h
   };
   if cashout.cashout_id != escrow.cashout_id
      || !address_eq(&cashout.mm, &escrow.market_maker)
   {
      return Err(SpammError::InvalidCashout.into());
   }
   verify_cashout_pda(cashout_pda, &cashout.mm, cashout.cashout_id, cashout.bump)?;
   verify_token_account(true, cashout_ata, cashout_pda, mint, token_program)?;
   verify_token_account(true, original_bet_ata, original_bet_pda, mint, token_program)?;

   let mut orig_fillers_buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let mut orig = {
      let raw = original_bet_pda.try_borrow()?;
      let data = raw.as_ref();
      let h = BetAccountData::decode_header(data)?;
      let n = h.num_fillers as usize;
      BetAccountData::decode_fillers_into(data, n, &mut orig_fillers_buf)?;
      h
   };
   if !address_eq(&orig.owner, user.address()) || orig.bet_id != escrow.orig_bet_id {
      return Err(SpammError::InvalidCashout.into());
   }
   verify_bet_pda(
      original_bet_pda,
      user.address(),
      escrow.orig_bet_id,
      orig.bump,
   )?;
   let orig_result = orig.result;
   let cashout_result = cashout.result;
   if orig_result != BetResult::RolledBack && cashout_result != BetResult::RolledBack {
      return Err(SpammError::InvalidCashout.into());
   }

   let co_id = cashout.cashout_id.to_le_bytes();
   let co_bump = [cashout.bump];
   let co_signer = [
      Seed::from(CASHOUT_ACCOUNT_SEED),
      Seed::from(cashout.mm.as_ref()),
      Seed::from(&co_id),
      Seed::from(&co_bump),
   ];
   let co_signers = [Signer::from(&co_signer)];
   if escrow.amount > 0 {
      Transfer::new(cashout_ata, original_bet_ata, cashout_pda, escrow.amount)
         .invoke_signed(&co_signers)?;
   }

   let n = orig.num_fillers as usize;
   let cn = cashout.num_fillers as usize;
   if n != cn || n > MAX_NUMBER_OF_MMS {
      return Err(SpammError::InvalidCashout.into());
   }
   let orig_fillers = unsafe {
      core::slice::from_raw_parts(orig_fillers_buf.as_ptr().cast::<BetFiller>(), n)
   };
   let co_fillers = unsafe {
      core::slice::from_raw_parts(co_fillers_buf.as_ptr().cast::<BetFiller>(), n)
   };
   let mut merged = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   for i in 0..n {
      merged[i].write(BetFiller {
         mm_address: orig_fillers[i].mm_address,
         amount: orig_fillers[i].amount
            .checked_add(co_fillers[i].amount).ok_or(ProgramError::ArithmeticOverflow)?,
         reserved_profit: orig_fillers[i].reserved_profit
            .checked_add(co_fillers[i].reserved_profit).ok_or(ProgramError::ArithmeticOverflow)?,
         odds_scaled: orig_fillers[i].odds_scaled,
         is_potentially_netted: orig_fillers[i].is_potentially_netted,
      });
   }
   orig.amount = orig.amount
      .checked_add(escrow.amount).ok_or(ProgramError::ArithmeticOverflow)?;
   orig.payout = orig.payout
      .checked_add(escrow.payout_removed).ok_or(ProgramError::ArithmeticOverflow)?;
   if orig_result != BetResult::RolledBack {
      orig.result = BetResult::Pending;
   }
   let merged_live = unsafe {
      core::slice::from_raw_parts(merged.as_ptr().cast::<BetFiller>(), n)
   };
   let mut data = original_bet_pda.try_borrow_mut()?;
   BetAccountData::write_header_and_fillers(&mut data, &orig, merged_live)?;

   Ok(CashoutCloseInfo {
      seed: CASHOUT_ACCOUNT_SEED,
      mm: cashout.mm,
      cashout_id: cashout.cashout_id,
      bump: cashout.bump,
   })
}

#[inline(never)]
fn restore_parlay(
   user: &AccountView,
   original_bet_pda: &mut AccountView,
   original_bet_ata: &AccountView,
   cashout_pda: &AccountView,
   cashout_ata: &AccountView,
   escrow: &CashoutEscrow,
   mint: &AccountView,
   token_program: &AccountView,
) -> Result<CashoutCloseInfo, ProgramError> {
   if unlikely(!address_eq(cashout_pda.owner(), &ID) || !address_eq(original_bet_pda.owner(), &ID)) {
      return Err(ProgramError::InvalidAccountData);
   }
   let cashout = {
      let raw = cashout_pda.try_borrow()?;
      CashoutParlayAccountData::decode_header(raw.as_ref())?
   };
   if cashout.cashout_id != escrow.cashout_id
      || !address_eq(&cashout.mm, &escrow.market_maker)
   {
      return Err(SpammError::InvalidCashout.into());
   }
   verify_cashout_parlay_pda(
      cashout_pda,
      &cashout.mm,
      cashout.cashout_id,
      cashout.bump,
   )?;
   verify_token_account(true, cashout_ata, cashout_pda, mint, token_program)?;
   verify_token_account(true, original_bet_ata, original_bet_pda, mint, token_program)?;

   let (orig_result, cashout_result) = {
      let raw = original_bet_pda.try_borrow()?;
      let data = raw.as_ref();
      let h = ParlayBetAccountData::decode_header(data)?;
      if !address_eq(&h.owner, user.address()) || h.bet_id != escrow.orig_bet_id {
         return Err(SpammError::InvalidCashout.into());
      }
      verify_parlay_pda(
         original_bet_pda,
         user.address(),
         escrow.orig_bet_id,
         h.bump,
      )?;
      (h.result, cashout.result)
   };
   if orig_result != BetResult::RolledBack && cashout_result != BetResult::RolledBack {
      return Err(SpammError::InvalidCashout.into());
   }

   let co_id = cashout.cashout_id.to_le_bytes();
   let co_bump = [cashout.bump];
   let co_signer = [
      Seed::from(CASHOUT_PARLAY_ACCOUNT_SEED),
      Seed::from(cashout.mm.as_ref()),
      Seed::from(&co_id),
      Seed::from(&co_bump),
   ];
   let co_signers = [Signer::from(&co_signer)];
   if escrow.amount > 0 {
      Transfer::new(cashout_ata, original_bet_ata, cashout_pda, escrow.amount)
         .invoke_signed(&co_signers)?;
   }

   let result = if orig_result == BetResult::RolledBack {
      BetResult::RolledBack
   } else {
      BetResult::Pending
   };
   add_parlay_amounts(original_bet_pda, escrow.amount, escrow.payout_removed, result)?;

   Ok(CashoutCloseInfo {
      seed: CASHOUT_PARLAY_ACCOUNT_SEED,
      mm: cashout.mm,
      cashout_id: cashout.cashout_id,
      bump: cashout.bump,
   })
}
