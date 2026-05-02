//! Settle the graded bet and move funds to the winner then close bet/ata to the feepayer.
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
use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError, hint::{unlikely}
};
use pinocchio_log::log;
use pinocchio_token::instructions::{Transfer};
use crate::{ID, helpers::{close_pda_return_rent, safe_close_ata, verify_config_pda, verify_mint, verify_mm_encumbrance_pda, verify_signer, verify_token_account, verify_token_program}, parsers::get_encumbrance, state::{
      PARLAY_BET_ACCOUNT_LEN, PARLAY_BET_ACCOUNT_SEED, ParlayBetAccountData, account_bet::BetResult, other::{MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, MM_ENCUMBRANCE_PDA_SEED}
   }, writers::write_i64_le_unchecked
};

pub const SETTLE_PARLAY_IX_DISCRIMINATOR: u8 = 7;

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
   let bet_account_signer = &[Signer::from(&bet_account_signer_seeds)];

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
      amount_to_user_from_bet_ata, // bet ata -> user
      amount_to_user_from_filler_liability_token_account, //user profit
      amount_to_filler_from_bet_ata, // bet ata -> mm token (non-netted stake / mm take)
      amouunt_to_filler_token_account_from_liability_token_account, // mm liability token account -> mm token account
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

   if amount_to_user_from_bet_ata > 0 {
      Transfer::new(
         bet_ata,
         user_ata,
         bet_account,
         amount_to_user_from_bet_ata,
      ).invoke_signed(bet_account_signer)?;
   }

   if amount_to_filler_from_bet_ata > 0 {
      Transfer::new(
         bet_ata,
         mm_token_account,
         bet_account,
         amount_to_filler_from_bet_ata,
      ).invoke_signed(bet_account_signer)?;
   }

   if amouunt_to_filler_token_account_from_liability_token_account > 0 {
      Transfer::new(
         mm_liability_token_account,
         mm_token_account,
         mm_encumbrance_pda,
         amouunt_to_filler_token_account_from_liability_token_account,
      ).invoke_signed(&encumbrance_pda_signer)?;
   }

   let encumbrance_delta: i64 = potential_profit.try_into().map_err(|_| ProgramError::ArithmeticOverflow)?;
   if encumbrance_delta != 0 {
      let mut encumbrance = get_encumbrance(&mm_encumbrance_pda)?;
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
