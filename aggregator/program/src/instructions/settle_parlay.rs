//! Settle the graded parlay and move funds, then close bet ATA and PDA.
//! SPL token moves use one token program batch CPI (p-token), including dust to the user and ATA close.
//!
//! Accounts: **14**
//! 0. `signer` (signer)
//! 1. `bet_account` (writable)
//! 2. `bet_ata` (writable)
//! 3. `bet_feepayer` (writable)
//! 4. `user` (readonly)
//! 5. `user_ata` (writable)
//! 6. `config_pda` (readonly)
//! 7. `mint` (readonly)
//! 8. `token_program` (readonly)
//! 9. `mm_address` (readonly) — must match `ParlayBetAccountData::filler_address`
//! 10. `mm_config_pda` (readonly)
//! 11. `mm_encumbrance_pda` (writable)
//! 12. `mm_liability_token_account` (writable)
//! 13. `mm_token_account` (writable)
//!
//! Data: None

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError, hint::{unlikely}
};
use pinocchio_log::log;
use pinocchio_token::instructions::{Batch, CloseAccount, IntoBatch, Transfer};
use pinocchio::{cpi::CpiAccount, instruction::InstructionAccount};
use crate::{ID, constants::{SETTLE_PARLAY_TOKEN_BATCH_IX_CAP, SETTLE_TOKEN_BATCH_MAX_INNER_DATA}, helpers::{close_pda_return_rent, verify_config_pda, verify_mint, verify_mm_encumbrance_pda, verify_signer, verify_token_account, verify_token_program}, parsers::{get_encumbrance, get_token_account_balance}, state::{
      PARLAY_BET_ACCOUNT_LEN, PARLAY_BET_ACCOUNT_SEED, ParlayBetAccountData, account_bet::BetResult, other::{MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, MM_ENCUMBRANCE_PDA_SEED}
   }, writers::write_i64_le_unchecked
};

fn push_bet_ata_out<'acc, 'buf>(
   batch: &mut Batch<'acc, 'buf>,
   bet_ata_remaining: &mut u64,
   amount: u64,
   bet_ata: &'acc AccountView,
   to: &'acc AccountView,
   bet_authority: &'acc AccountView,
) -> ProgramResult
where
   'acc: 'buf,
{
   if amount == 0 {
      return Ok(());
   }
   *bet_ata_remaining = bet_ata_remaining
      .checked_sub(amount)
      .ok_or(ProgramError::ArithmeticOverflow)?;
   Transfer::new(bet_ata, to, bet_authority, amount).into_batch(batch)?;
   Ok(())
}

pub const SETTLE_PARLAY_IX_DISCRIMINATOR: u8 = 7;

pub fn process<'a>(accounts: &'a mut [AccountView]) -> ProgramResult {
   let [
      signer,
      bet_account,
      bet_ata,
      bet_feepayer,
      user,
      user_ata,
      our_config_pda,
      mint,
      token_program,
      mm_address,
      mm_config_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
   ] = accounts else {
      log!("settle_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&signer)?;
   verify_config_pda(&our_config_pda, true)?;

   if unlikely(!address_eq(bet_account.owner(), &ID)) {
      log!("settle_parlay: bet account must be owned by this program");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(bet_account.data_len() != PARLAY_BET_ACCOUNT_LEN as usize) {
      log!("settle_parlay: bet account data length is invalid");
      return Err(ProgramError::InvalidInstructionData);
   }
   let bet_data = {
      let bet_account_data = bet_account.try_borrow()?;
      ParlayBetAccountData::decode(bet_account_data.as_ref())?
   };
   let bet_result = bet_data.result;

   let bet_id_bytes = bet_data.bet_id.to_le_bytes();
   let bet_bump_bytes = bet_data.bump.to_le_bytes();

   let bet_account_signer_seeds = [
      Seed::from(PARLAY_BET_ACCOUNT_SEED),
      Seed::from(user.address().as_ref()),
      Seed::from(&bet_id_bytes),
      Seed::from(&bet_bump_bytes),
   ];

   if unlikely(bet_data.result == BetResult::Pending) {
      log!("settle_parlay: bet is pending");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(!address_eq(&bet_data.feepayer, &bet_feepayer.address())) {
      log!("settle_parlay: bet feepayer is invalid");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(!address_eq(&bet_data.owner, &user.address())) {
      log!("settle_parlay: bet owner is invalid");
      return Err(ProgramError::InvalidInstructionData);
   }
   verify_token_account(true,
      &user_ata, &user,
      &mint, &token_program
   )?;

   verify_token_program(token_program)?;
   verify_mint(&mint)?;

   verify_token_account(true,
      &bet_ata, bet_account,
      &mint, &token_program
   )?;

   if unlikely(!address_eq(&bet_data.filler_address, mm_address.address())) {
      log!("settle_parlay: filler mm address is invalid");
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_token_account(true,
      &mm_token_account, mm_config_pda,
      &mint, &token_program
   )?;

   let Some(valid_mm_encumbrance_pda_bump) = verify_mm_encumbrance_pda(
      mm_encumbrance_pda,
      mm_address,
   ) else {
      return Err(ProgramError::InvalidInstructionData);
   };

   verify_token_account(true,
      &mm_liability_token_account, mm_encumbrance_pda,
      &mint, &token_program
   )?;

   let stake = bet_data.amount;
   let potential_profit = bet_data.payout.checked_sub(stake).ok_or_else(|| ProgramError::ArithmeticOverflow)?;

   let (
      amount_to_user_from_bet_ata,
      amount_to_user_from_filler_liability_token_account,
      amount_to_filler_from_bet_ata,
      amount_to_filler_token_account_from_liability_token_account,
   ): (u64, u64, u64, u64) = match bet_result {
      BetResult::Won => {
         (stake, potential_profit, 0, 0)
      },
      BetResult::Lost => {
         (0, 0, stake, potential_profit)
      },
      BetResult::Push | BetResult::Cancelled | BetResult::RolledBack => {
         (stake, 0, 0, potential_profit)
      },
      BetResult::HalfWon | BetResult::HalfLost => {
         log!("settle_parlay: bet result is half won or half lost");
         return Err(ProgramError::InvalidInstructionData);
      },
      BetResult::Pending => {
         log!("settle_parlay: bet result is pending");
         return Err(ProgramError::InvalidInstructionData);
      },
   };

   let encumbrance_pda_bump_seed = [valid_mm_encumbrance_pda_bump];
   let encumbrance_pda_signer_seeds = [
      Seed::from(MM_ENCUMBRANCE_PDA_SEED),
      Seed::from(mm_address.address().as_ref()),
      Seed::from(&encumbrance_pda_bump_seed[..]),
   ];

   let mut bet_ata_remaining = get_token_account_balance(bet_ata)?;

   let mut batch_data = [const { MaybeUninit::<u8>::uninit() }; 1 + SETTLE_PARLAY_TOKEN_BATCH_IX_CAP * (2 + SETTLE_TOKEN_BATCH_MAX_INNER_DATA)];
   let mut batch_ix_accounts = [const { MaybeUninit::<InstructionAccount>::uninit() }; SETTLE_PARLAY_TOKEN_BATCH_IX_CAP * 3];
   let mut batch_accounts = [const { MaybeUninit::<CpiAccount>::uninit() }; SETTLE_PARLAY_TOKEN_BATCH_IX_CAP * 3];

   let mut batch = Batch::new(
      &mut batch_data,
      &mut batch_ix_accounts,
      &mut batch_accounts,
   )?;

   if amount_to_user_from_filler_liability_token_account > 0 {
      Transfer::new(
         mm_liability_token_account,
         user_ata,
         mm_encumbrance_pda,
         amount_to_user_from_filler_liability_token_account,
      ).into_batch(&mut batch)?;
   }

   push_bet_ata_out(
      &mut batch,
      &mut bet_ata_remaining,
      amount_to_user_from_bet_ata,
      bet_ata,
      user_ata,
      bet_account,
   )?;
   push_bet_ata_out(
      &mut batch,
      &mut bet_ata_remaining,
      amount_to_filler_from_bet_ata,
      bet_ata,
      mm_token_account,
      bet_account,
   )?;

   if amount_to_filler_token_account_from_liability_token_account > 0 {
      Transfer::new(
         mm_liability_token_account,
         mm_token_account,
         mm_encumbrance_pda,
         amount_to_filler_token_account_from_liability_token_account,
      ).into_batch(&mut batch)?;
   }

   let dust_to_user = bet_ata_remaining;
   if dust_to_user > 0 {
      push_bet_ata_out(
         &mut batch,
         &mut bet_ata_remaining,
         dust_to_user,
         bet_ata,
         user_ata,
         bet_account,
      )?;
   }

   if unlikely(bet_ata_remaining != 0) {
      log!("settle_parlay: bet ata remaining balance after batch");
      return Err(ProgramError::InvalidInstructionData);
   }

   CloseAccount::new(bet_ata, bet_feepayer, bet_account).into_batch(&mut batch)?;

   let need_enc = amount_to_user_from_filler_liability_token_account > 0
      || amount_to_filler_token_account_from_liability_token_account > 0;
   let s_bet = Signer::from(&bet_account_signer_seeds);
   if need_enc {
      let s_enc = Signer::from(&encumbrance_pda_signer_seeds);
      batch.invoke_signed(&[s_bet, s_enc])?;
   } else {
      batch.invoke_signed(core::slice::from_ref(&s_bet))?;
   }

   let encumbrance_delta: i64 = potential_profit.try_into().map_err(|_| ProgramError::ArithmeticOverflow)?;
   if encumbrance_delta != 0 {
      let mut encumbrance = get_encumbrance(mm_encumbrance_pda)?;
      encumbrance = encumbrance
         .checked_sub(encumbrance_delta)
         .ok_or_else(|| ProgramError::ArithmeticOverflow)?;

      unsafe {
         write_i64_le_unchecked(
            mm_encumbrance_pda.data_mut_ptr(),
            MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
            encumbrance
         );
      }
   }

   close_pda_return_rent(
      bet_account,
      bet_feepayer,
   )?;

   Ok(())
}
