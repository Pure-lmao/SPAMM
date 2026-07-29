//! Settle the graded bet and move funds to the winner then close bet/ata to the feepayer.
//! SPL token moves use a single token program batch CPI (p-token) including dust sweep and ATA close.
//!
//! Accounts: **9** then **5** per filler but can be blank if no fillers
//! 0. `signer` (signer)
//! 1. `bet_account` (writable)
//! 2. `bet_ata` (writable)
//! 3. `bet_feepayer` (writable)
//! 4. `user` (readonly)
//! 5. `user_ata` (writable)
//! 6. `config_pda` (readonly)
//! 7. `mint` (readonly)
//! 8. `token_program` (readonly)
//! 
//! Per filler:
//! 0 `mm_address` (readonly)
//! 1. `mm_config_pda` (readonly)
//! 2. `mm_encumbrance_pda` (writable)
//! 3. `mm_liability_token_account` (writable)
//! 4. `mm_token_account` (writable)
//! 
//! No Data

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError, hint::{unlikely}
};
use pinocchio_log::log;
use pinocchio_system::ID as SYSTEM_ID;
use pinocchio_token::instructions::{Batch, CloseAccount, IntoBatch, Transfer};
use pinocchio::{cpi::CpiAccount, instruction::InstructionAccount};
use crate::{ID, constants::{SETTLE_BET_TOKEN_BATCH_CPI_ACCOUNTS, SETTLE_BET_TOKEN_BATCH_IX_CAP, SETTLE_TOKEN_BATCH_MAX_INNER_DATA}, helpers::{calc_potential_profit, close_pda_return_rent, push_bet_ata_out, verify_config_pda, verify_mint, verify_mm_encumbrance_pda, verify_signer, verify_token_account, verify_token_program}, parsers::{get_encumbrance, get_token_account_balance}, state::{
      BET_ACCOUNT_LEN, BET_ACCOUNT_SEED, BetAccountData, BetFiller, account_bet::BetResult, other::{MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, MM_ENCUMBRANCE_PDA_SEED}
   }, writers::write_i64_le_unchecked
};

pub const SETTLE_BET_IX_DISCRIMINATOR: u8 = 25;

/// Account handles for the SPL token batch CPI in `settle_bet` (keeps `process` stack small).
struct SettleBetTokenBatchCx<'a> {
   user: &'a AccountView,
   bet_account: &'a mut AccountView,
   bet_ata: &'a mut AccountView,
   bet_feepayer: &'a mut AccountView,
   user_ata: &'a mut AccountView,
   mint: &'a AccountView,
   token_program: &'a AccountView,
   f0_mm: &'a mut AccountView,
   f0_cfg: &'a mut AccountView,
   f0_enc: &'a mut AccountView,
   f0_liab: &'a mut AccountView,
   f0_tok: &'a mut AccountView,
   f1_mm: &'a mut AccountView,
   f1_cfg: &'a mut AccountView,
   f1_enc: &'a mut AccountView,
   f1_liab: &'a mut AccountView,
   f1_tok: &'a mut AccountView,
   f2_mm: &'a mut AccountView,
   f2_cfg: &'a mut AccountView,
   f2_enc: &'a mut AccountView,
   f2_liab: &'a mut AccountView,
   f2_tok: &'a mut AccountView,
   f3_mm: &'a mut AccountView,
   f3_cfg: &'a mut AccountView,
   f3_enc: &'a mut AccountView,
   f3_liab: &'a mut AccountView,
   f3_tok: &'a mut AccountView,
   f4_mm: &'a mut AccountView,
   f4_cfg: &'a mut AccountView,
   f4_enc: &'a mut AccountView,
   f4_liab: &'a mut AccountView,
   f4_tok: &'a mut AccountView,
}

pub fn process<'a>(accounts: &'a mut [AccountView]) -> ProgramResult {
   let [
      signer, //verified as signer, can be anyone
      bet_account, //verified inline
      bet_ata, //verified by verify_token_account
      bet_feepayer, //verified inline
      user, //verified inline
      user_ata, //verified by verify_token_account
      our_config_pda, //verified by verify_config_pda
      mint, //verified by verify_mint
      token_program, //verified by equ const
      filler_0_mm_address,
      filler_0_mm_config_pda,
      filler_0_mm_encumbrance_pda,
      filler_0_mm_liability_token_account,
      filler_0_token_account,
      filler_1_mm_address,
      filler_1_mm_config_pda,
      filler_1_mm_encumbrance_pda,
      filler_1_mm_liability_token_account,
      filler_1_token_account,
      filler_2_mm_address,
      filler_2_mm_config_pda,
      filler_2_mm_encumbrance_pda,
      filler_2_mm_liability_token_account,
      filler_2_token_account,
      filler_3_mm_address,
      filler_3_mm_config_pda,
      filler_3_mm_encumbrance_pda,
      filler_3_mm_liability_token_account,
      filler_3_token_account,
      filler_4_mm_address,
      filler_4_mm_config_pda,
      filler_4_mm_encumbrance_pda,
      filler_4_mm_liability_token_account,
      filler_4_token_account,
   ] = accounts else {
      log!("settle_bet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&signer)?;
   verify_config_pda(&our_config_pda, true)?;

   if unlikely(!address_eq(bet_account.owner(), &ID)) {
      log!("settle_bet: bet account must be owned by this program");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(bet_account.data_len() != BET_ACCOUNT_LEN as usize) {
      log!("settle_bet: bet account data length is invalid");
      return Err(ProgramError::InvalidInstructionData);
   }
   let bet_account_data = bet_account.try_borrow()?;
   let bet_data = BetAccountData::decode(bet_account_data.as_ref())?;
   core::mem::drop(bet_account_data);

   let bet_id_bytes = bet_data.bet_id.to_le_bytes();
   let bet_bump_bytes = bet_data.bump.to_le_bytes();

   if unlikely(bet_data.result == BetResult::Pending) {
      log!("settle_bet: bet is pending");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(!address_eq(&bet_data.feepayer, &bet_feepayer.address())) {     
      log!("settle_bet: bet feepayer is invalid");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(!address_eq(&bet_data.owner, &user.address())) {     
      log!("settle_bet: bet owner is invalid");
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

   let amount_to_user_from_bet_ata: u64 = match bet_data.result {
      BetResult::Won | BetResult::HalfWon |
        BetResult::Push | BetResult::Cancelled |
        BetResult::RolledBack => bet_data.amount,
      BetResult::Lost => 0,
      BetResult::HalfLost => bet_data.amount / 2,
      BetResult::ModifiedWin => {
         log!("settle_bet: ModifiedWin is parlay-only");
         return Err(ProgramError::InvalidInstructionData);
      }
      BetResult::Pending => {
         log!("settle_bet: bet result is pending");
         return Err(ProgramError::InvalidInstructionData);
      }
   };

   let bet_ata_start = get_token_account_balance(bet_ata)?;
   let cx = SettleBetTokenBatchCx {
      user,
      bet_account,
      bet_ata,
      bet_feepayer,
      user_ata,
      mint,
      token_program,
      f0_mm: filler_0_mm_address,
      f0_cfg: filler_0_mm_config_pda,
      f0_enc: filler_0_mm_encumbrance_pda,
      f0_liab: filler_0_mm_liability_token_account,
      f0_tok: filler_0_token_account,
      f1_mm: filler_1_mm_address,
      f1_cfg: filler_1_mm_config_pda,
      f1_enc: filler_1_mm_encumbrance_pda,
      f1_liab: filler_1_mm_liability_token_account,
      f1_tok: filler_1_token_account,
      f2_mm: filler_2_mm_address,
      f2_cfg: filler_2_mm_config_pda,
      f2_enc: filler_2_mm_encumbrance_pda,
      f2_liab: filler_2_mm_liability_token_account,
      f2_tok: filler_2_token_account,
      f3_mm: filler_3_mm_address,
      f3_cfg: filler_3_mm_config_pda,
      f3_enc: filler_3_mm_encumbrance_pda,
      f3_liab: filler_3_mm_liability_token_account,
      f3_tok: filler_3_token_account,
      f4_mm: filler_4_mm_address,
      f4_cfg: filler_4_mm_config_pda,
      f4_enc: filler_4_mm_encumbrance_pda,
      f4_liab: filler_4_mm_liability_token_account,
      f4_tok: filler_4_token_account,
   };
   settle_bet_execute_token_batch(
      &bet_data,
      amount_to_user_from_bet_ata,
      bet_ata_start,
      bet_id_bytes,
      bet_bump_bytes,
      &cx,
   )?;

   apply_filler_encumbrance_updates(
      filler_0_mm_address, filler_0_mm_encumbrance_pda, &bet_data.filler_0,
   )?;
   apply_filler_encumbrance_updates(
      filler_1_mm_address, filler_1_mm_encumbrance_pda, &bet_data.filler_1,
   )?;
   apply_filler_encumbrance_updates(
      filler_2_mm_address, filler_2_mm_encumbrance_pda, &bet_data.filler_2,
   )?;
   apply_filler_encumbrance_updates(
      filler_3_mm_address, filler_3_mm_encumbrance_pda, &bet_data.filler_3,
   )?;
   apply_filler_encumbrance_updates(
      filler_4_mm_address, filler_4_mm_encumbrance_pda, &bet_data.filler_4,
   )?;

   close_pda_return_rent(
      bet_account,
      bet_feepayer,
   )?;

   Ok(())
}

fn handle_filler<'acc, 'buf>(
   filler_slot: usize,
   mm_address: &'acc AccountView,
   mm_config_pda: &'acc AccountView,
   mm_encumbrance_pda: &'acc AccountView,
   mm_liability_token_account: &'acc AccountView,
   token_account: &'acc AccountView,
   filler: &'acc BetFiller,
   user_ata: &'acc AccountView,
   bet_account: &'acc AccountView,
   bet_ata: &'acc AccountView,
   mint: &'acc AccountView,
   token_program: &'acc AccountView,
   bet_result: BetResult,
   batch: &mut Batch<'acc, 'buf>,
   bet_ata_remaining: &mut u64,
   enc_needed: &mut [bool; 5],
   enc_bumps: &mut [u8; 5],
) -> ProgramResult
where
   'acc: 'buf,
{
   if address_eq(&filler.mm_address, &SYSTEM_ID) {
      return Ok(());
   }

   if unlikely(!address_eq(&filler.mm_address, &mm_address.address())) {
      log!("settle_bet: filler mm address is invalid");
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_token_account(true, token_account, mm_config_pda, mint, token_program)?;

   let Some(valid_mm_encumbrance_pda_bump) = verify_mm_encumbrance_pda(
      mm_encumbrance_pda,
      mm_address,
   ) else {
      return Err(ProgramError::InvalidInstructionData);
   };

   verify_token_account(true, mm_liability_token_account, mm_encumbrance_pda, mint, token_program)?;

   let (
      amount_to_user_from_filler_liability_token_account,
      amount_to_filler_from_bet_ata,
      amount_to_liability_token_account_from_bet_ata,
   ): (u64, u64, u64) = match bet_result {
      BetResult::Won => {
         let user_profit = calc_potential_profit(filler.amount, filler.odds_scaled)?;
         (user_profit, 0, 0)
      },
      BetResult::Lost => {
         if filler.is_potentially_netted {
            (0, 0, filler.amount)
         } else {
            (0, filler.amount, 0)
         }
      },
      BetResult::HalfWon => {
         let half_amount = filler.amount.checked_div(2).ok_or(ProgramError::ArithmeticOverflow)?;
         let user_profit = calc_potential_profit(half_amount, filler.odds_scaled)?;
         (user_profit, 0, 0)
      },
      BetResult::HalfLost => {
         let half_amount = filler.amount.checked_div(2).ok_or(ProgramError::ArithmeticOverflow)?;
         if filler.is_potentially_netted {
            (0, 0, half_amount)
         } else {
            (0, half_amount, 0)
         }
      },
      BetResult::Push | BetResult::Cancelled | BetResult::RolledBack => {
         (0, 0, 0)
      },
      BetResult::ModifiedWin => {
         log!("settle_bet: ModifiedWin is parlay-only");
         return Err(ProgramError::InvalidInstructionData);
      }
      BetResult::Pending => {
         log!("settle_bet: bet result is pending");
         return Err(ProgramError::InvalidInstructionData);
      }
   };

   if amount_to_user_from_filler_liability_token_account > 0 {
      enc_needed[filler_slot] = true;
      enc_bumps[filler_slot] = valid_mm_encumbrance_pda_bump;
      Transfer::new(
         mm_liability_token_account,
         user_ata,
         mm_encumbrance_pda,
         amount_to_user_from_filler_liability_token_account,
      ).into_batch(batch)?;
   }

   push_bet_ata_out(
      batch,
      bet_ata_remaining,
      amount_to_filler_from_bet_ata,
      bet_ata,
      token_account,
      bet_account,
   )?;
   push_bet_ata_out(
      batch,
      bet_ata_remaining,
      amount_to_liability_token_account_from_bet_ata,
      bet_ata,
      mm_liability_token_account,
      bet_account,
   )?;

   Ok(())
}

/// SPL token batch CPI + enc signer prep. `#[inline(never)]` so large `MaybeUninit` buffers are not on `process`'s stack.
#[inline(never)]
fn settle_bet_execute_token_batch<'a>(
   bet_data: &BetAccountData,
   amount_to_user_from_bet_ata: u64,
   bet_ata_start: u64,
   bet_id_bytes: [u8; 8],
   bet_bump_bytes: [u8; 1],
   cx: &SettleBetTokenBatchCx<'a>,
) -> ProgramResult {
   let bet_account_signer_seeds = [
      Seed::from(BET_ACCOUNT_SEED),
      Seed::from(cx.user.address().as_ref()),
      Seed::from(&bet_id_bytes),
      Seed::from(&bet_bump_bytes),
   ];

   let mut bet_ata_remaining = bet_ata_start;

   let mut enc_needed = [false; 5];
   let mut enc_bumps = [0u8; 5];
   let mut enc_seed_bufs = [const { MaybeUninit::<[Seed; 3]>::uninit() }; 5];

   let mut batch_data = [const { MaybeUninit::<u8>::uninit() }; 1 + SETTLE_BET_TOKEN_BATCH_IX_CAP * (2 + SETTLE_TOKEN_BATCH_MAX_INNER_DATA)];
   let mut batch_ix_accounts = [const { MaybeUninit::<InstructionAccount>::uninit() }; SETTLE_BET_TOKEN_BATCH_CPI_ACCOUNTS];
   let mut batch_accounts = [const { MaybeUninit::<CpiAccount>::uninit() }; SETTLE_BET_TOKEN_BATCH_CPI_ACCOUNTS];

   let mut batch = Batch::new(
      &mut batch_data,
      &mut batch_ix_accounts,
      &mut batch_accounts,
   )?;

   handle_filler(
      0,
      cx.f0_mm,
      cx.f0_cfg,
      &*cx.f0_enc,
      cx.f0_liab,
      cx.f0_tok,
      &bet_data.filler_0,
      cx.user_ata,
      cx.bet_account,
      cx.bet_ata,
      cx.mint,
      cx.token_program,
      bet_data.result,
      &mut batch,
      &mut bet_ata_remaining,
      &mut enc_needed,
      &mut enc_bumps,
   )?;
   handle_filler(
      1,
      cx.f1_mm,
      cx.f1_cfg,
      &*cx.f1_enc,
      cx.f1_liab,
      cx.f1_tok,
      &bet_data.filler_1,
      cx.user_ata,
      cx.bet_account,
      cx.bet_ata,
      cx.mint,
      cx.token_program,
      bet_data.result,
      &mut batch,
      &mut bet_ata_remaining,
      &mut enc_needed,
      &mut enc_bumps,
   )?;
   handle_filler(
      2,
      cx.f2_mm,
      cx.f2_cfg,
      &*cx.f2_enc,
      cx.f2_liab,
      cx.f2_tok,
      &bet_data.filler_2,
      cx.user_ata,
      cx.bet_account,
      cx.bet_ata,
      cx.mint,
      cx.token_program,
      bet_data.result,
      &mut batch,
      &mut bet_ata_remaining,
      &mut enc_needed,
      &mut enc_bumps,
   )?;
   handle_filler(
      3,
      cx.f3_mm,
      cx.f3_cfg,
      &*cx.f3_enc,
      cx.f3_liab,
      cx.f3_tok,
      &bet_data.filler_3,
      cx.user_ata,
      cx.bet_account,
      cx.bet_ata,
      cx.mint,
      cx.token_program,
      bet_data.result,
      &mut batch,
      &mut bet_ata_remaining,
      &mut enc_needed,
      &mut enc_bumps,
   )?;
   handle_filler(
      4,
      cx.f4_mm,
      cx.f4_cfg,
      &*cx.f4_enc,
      cx.f4_liab,
      cx.f4_tok,
      &bet_data.filler_4,
      cx.user_ata,
      cx.bet_account,
      cx.bet_ata,
      cx.mint,
      cx.token_program,
      bet_data.result,
      &mut batch,
      &mut bet_ata_remaining,
      &mut enc_needed,
      &mut enc_bumps,
   )?;

   push_bet_ata_out(
      &mut batch,
      &mut bet_ata_remaining,
      amount_to_user_from_bet_ata,
      cx.bet_ata,
      cx.user_ata,
      cx.bet_account,
   )?;

   let dust_to_user = bet_ata_remaining;
   if dust_to_user > 0 {
      push_bet_ata_out(
         &mut batch,
         &mut bet_ata_remaining,
         dust_to_user,
         cx.bet_ata,
         cx.user_ata,
         cx.bet_account,
      )?;
   }

   if unlikely(bet_ata_remaining != 0) {
      log!("settle_bet: bet ata remaining balance after batch");
      return Err(ProgramError::InvalidInstructionData);
   }

   CloseAccount::new(cx.bet_ata, cx.bet_feepayer, cx.bet_account).into_batch(&mut batch)?;

   for i in 0..5 {
      if enc_needed[i] {
         let mm: &AccountView = match i {
            0 => &*cx.f0_mm,
            1 => &*cx.f1_mm,
            2 => &*cx.f2_mm,
            3 => &*cx.f3_mm,
            _ => &*cx.f4_mm,
         };
         enc_seed_bufs[i].write([
            Seed::from(MM_ENCUMBRANCE_PDA_SEED),
            Seed::from(mm.address().as_ref()),
            Seed::from(core::slice::from_ref(&enc_bumps[i])),
         ]);
      }
   }

   let s_bet = Signer::from(&bet_account_signer_seeds);
   let mut enc_signers = [const { MaybeUninit::<Signer>::uninit() }; 5];
   let mut n_enc_signers = 0usize;
   for i in 0..5 {
      if enc_needed[i] {
         enc_signers[n_enc_signers].write(Signer::from(unsafe { enc_seed_bufs[i].assume_init_ref() }));
         n_enc_signers += 1;
      }
   }

   match n_enc_signers {
      0 => batch.invoke_signed(core::slice::from_ref(&s_bet))?,
      1 => {
         let e0 = unsafe { core::ptr::read(enc_signers[0].as_ptr().cast::<Signer>()) };
         batch.invoke_signed(&[s_bet, e0])?;
      },
      2 => {
         let e0 = unsafe { core::ptr::read(enc_signers[0].as_ptr().cast::<Signer>()) };
         let e1 = unsafe { core::ptr::read(enc_signers[1].as_ptr().cast::<Signer>()) };
         batch.invoke_signed(&[s_bet, e0, e1])?;
      },
      3 => {
         let e0 = unsafe { core::ptr::read(enc_signers[0].as_ptr().cast::<Signer>()) };
         let e1 = unsafe { core::ptr::read(enc_signers[1].as_ptr().cast::<Signer>()) };
         let e2 = unsafe { core::ptr::read(enc_signers[2].as_ptr().cast::<Signer>()) };
         batch.invoke_signed(&[s_bet, e0, e1, e2])?;
      },
      4 => {
         let e0 = unsafe { core::ptr::read(enc_signers[0].as_ptr().cast::<Signer>()) };
         let e1 = unsafe { core::ptr::read(enc_signers[1].as_ptr().cast::<Signer>()) };
         let e2 = unsafe { core::ptr::read(enc_signers[2].as_ptr().cast::<Signer>()) };
         let e3 = unsafe { core::ptr::read(enc_signers[3].as_ptr().cast::<Signer>()) };
         batch.invoke_signed(&[s_bet, e0, e1, e2, e3])?;
      },
      _ => {
         let e0 = unsafe { core::ptr::read(enc_signers[0].as_ptr().cast::<Signer>()) };
         let e1 = unsafe { core::ptr::read(enc_signers[1].as_ptr().cast::<Signer>()) };
         let e2 = unsafe { core::ptr::read(enc_signers[2].as_ptr().cast::<Signer>()) };
         let e3 = unsafe { core::ptr::read(enc_signers[3].as_ptr().cast::<Signer>()) };
         let e4 = unsafe { core::ptr::read(enc_signers[4].as_ptr().cast::<Signer>()) };
         batch.invoke_signed(&[s_bet, e0, e1, e2, e3, e4])?;
      },
   }

   Ok(())
}

fn apply_filler_encumbrance_updates(
   mm_address: &AccountView,
   mm_encumbrance_pda: &mut AccountView,
   filler: &BetFiller,
) -> ProgramResult {
   if address_eq(&filler.mm_address, &SYSTEM_ID) {
      return Ok(());
   }
   if unlikely(!address_eq(&filler.mm_address, &mm_address.address())) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if filler.encumbrance_delta != 0 {
      let mut encumbrance = get_encumbrance(mm_encumbrance_pda)?;
      encumbrance = encumbrance
         .checked_sub(filler.encumbrance_delta)
         .ok_or_else(|| ProgramError::ArithmeticOverflow)?;

      unsafe {
         write_i64_le_unchecked(
            mm_encumbrance_pda.data_mut_ptr(),
            MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
            encumbrance
         );
      }
   }
   Ok(())
}