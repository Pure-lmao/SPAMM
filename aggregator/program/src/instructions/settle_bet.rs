//! Settle the graded bet and move funds to the winner then close bet/ata to the feepayer.
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

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError, hint::{unlikely}
};
use pinocchio_log::log;
use pinocchio_system::ID as SYSTEM_ID;
use pinocchio_token::instructions::{Transfer};
use crate::{ID, helpers::{calc_potential_profit, close_pda_return_rent, safe_close_ata, verify_config_pda, verify_mint, verify_mm_encumbrance_pda, verify_signer, verify_token_account, verify_token_program}, parsers::get_encumbrance, state::{
      BET_ACCOUNT_LEN, BET_ACCOUNT_SEED, BetAccountData, BetFiller, account_bet::BetResult, other::{MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, MM_ENCUMBRANCE_PDA_SEED}
   }, writers::write_i64_le_unchecked
};

pub const SETTLE_BET_IX_DISCRIMINATOR: u8 = 6;

pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
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
   
   let bet_account_signer_seeds = [
      Seed::from(BET_ACCOUNT_SEED),
      Seed::from(user.address().as_ref()),
      Seed::from(&bet_id_bytes),
      Seed::from(&bet_bump_bytes),
   ];
   let bet_account_signer = &[
      Signer::from(&bet_account_signer_seeds)];

   handle_filler(
      filler_0_mm_address,
      filler_0_mm_config_pda,
      filler_0_mm_encumbrance_pda,
      filler_0_mm_liability_token_account,
      filler_0_token_account,
      &bet_data.filler_0,
      user_ata,
      bet_account,
      bet_ata,
      mint,
      token_program,
      bet_data.result,
      bet_account_signer,      
   )?;
   handle_filler(
      filler_1_mm_address,
      filler_1_mm_config_pda,
      filler_1_mm_encumbrance_pda,
      filler_1_mm_liability_token_account,
      filler_1_token_account,
      &bet_data.filler_1,
      user_ata,
      bet_account,
      bet_ata,
      mint,
      token_program,
      bet_data.result,
      bet_account_signer,
   )?;
   handle_filler(
      filler_2_mm_address,
      filler_2_mm_config_pda,
      filler_2_mm_encumbrance_pda,
      filler_2_mm_liability_token_account,
      filler_2_token_account,
      &bet_data.filler_2,
      user_ata,
      bet_account,
      bet_ata,
      mint,
      token_program,
      bet_data.result,
      bet_account_signer,
   )?;
   handle_filler(
      filler_3_mm_address,
      filler_3_mm_config_pda,
      filler_3_mm_encumbrance_pda,
      filler_3_mm_liability_token_account,
      filler_3_token_account,
      &bet_data.filler_3,
      user_ata,
      bet_account,
      bet_ata,
      mint,
      token_program,
      bet_data.result,
      bet_account_signer,
   )?;
   handle_filler(
      filler_4_mm_address,
      filler_4_mm_config_pda,
      filler_4_mm_encumbrance_pda,
      filler_4_mm_liability_token_account,
      filler_4_token_account,
      &bet_data.filler_4,
      user_ata,
      bet_account,
      bet_ata,
      mint,
      token_program,
      bet_data.result,
      bet_account_signer,
   )?;

   let amount_to_user_from_bet_ata: u64 = match bet_data.result {
      BetResult::Won | BetResult::HalfWon | 
        BetResult::Push | BetResult::Cancelled | 
        BetResult::RolledBack => bet_data.amount,
      BetResult::Lost => 0,
      BetResult::HalfLost => bet_data.amount / 2,
      BetResult::Pending => {
         log!("settle_bet: bet result is pending");
         return Err(ProgramError::InvalidInstructionData);
      }
   };

   if amount_to_user_from_bet_ata > 0 {
      Transfer::new(
         bet_ata,
         user_ata,
         bet_account,
         amount_to_user_from_bet_ata,
      ).invoke_signed(bet_account_signer)?;
   }

   // close the bet ata
   safe_close_ata(
      bet_ata,
      bet_feepayer,
      user_ata,
      bet_account,
      bet_account_signer,
   )?;

   // close the bet pda
   close_pda_return_rent(
      bet_account, 
      bet_feepayer, 
   )?;

   Ok(())
}

fn handle_filler(
   mm_address: &AccountView,
   mm_config_pda: &AccountView,
   mm_encumbrance_pda: &mut AccountView,
   mm_liability_token_account: &AccountView,
   token_account: &AccountView,
   filler: &BetFiller,
   user_ata: &AccountView,
   bet_account: &AccountView,
   bet_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   bet_result: BetResult,
   bet_account_signer: &[Signer<'_, '_>],
) -> ProgramResult {
   if address_eq(&filler.mm_address, &SYSTEM_ID) {
      // filler was not used
      return Ok(());
   }

   if unlikely(!address_eq(&filler.mm_address, &mm_address.address())) {
      log!("settle_bet: filler mm address is invalid");
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_token_account(true, 
      &token_account, mm_config_pda, 
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

   let (
      amount_to_user_from_filler_liability_token_account, //user profit
      amount_to_filler_from_bet_ata, // bet ata -> mm token (non-netted stake / mm take)
      amount_to_liability_token_account_from_bet_ata, // bet ata -> liability (netted pool)
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
         let half_amount = filler.amount.checked_div(2).ok_or_else(|| ProgramError::ArithmeticOverflow)?;

         let user_profit = calc_potential_profit(half_amount, filler.odds_scaled)?;

         (user_profit, 0, 0)
      },
      BetResult::HalfLost => {
         let half_amount = filler.amount.checked_div(2).ok_or_else(|| ProgramError::ArithmeticOverflow)?;

         if filler.is_potentially_netted {
            (0, 0, half_amount)
         } else {
            (0, half_amount, 0)
         }
      },
      BetResult::Push | BetResult::Cancelled | BetResult::RolledBack => {
         (0, 0, 0)
      }
      BetResult::Pending => {
         log!("settle_bet: bet result is pending");
         return Err(ProgramError::InvalidInstructionData);
      }
   };

   let encumbrance_pda_bump_seed = &[valid_mm_encumbrance_pda_bump];
   let encumbrance_pda_signer_seeds = [
      Seed::from(MM_ENCUMBRANCE_PDA_SEED),
      Seed::from(mm_address.address().as_ref()),
      Seed::from(encumbrance_pda_bump_seed),
   ];

   let encumbrance_pda_signer = [
      Signer::from(&encumbrance_pda_signer_seeds),
   ];
   
   // TODO: once p-token is live, send these to be batched
   if amount_to_user_from_filler_liability_token_account > 0 {
      Transfer::new(
         mm_liability_token_account,
         user_ata,
         mm_encumbrance_pda,
         amount_to_user_from_filler_liability_token_account,
      ).invoke_signed(&encumbrance_pda_signer)?;
   };

   if amount_to_filler_from_bet_ata > 0 {
      Transfer::new(
         bet_ata,
         token_account,
         bet_account,
         amount_to_filler_from_bet_ata,
      ).invoke_signed(bet_account_signer)?;
   }

   if amount_to_liability_token_account_from_bet_ata > 0 {
      Transfer::new(
         bet_ata,
         mm_liability_token_account,
         bet_account,
         amount_to_liability_token_account_from_bet_ata,
      ).invoke_signed(bet_account_signer)?;
   }

   if filler.encumbrance_delta != 0 {
      let mut encumbrance = get_encumbrance(&mm_encumbrance_pda)?;
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