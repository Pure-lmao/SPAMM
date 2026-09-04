//! Set the Result value of single bets (and cashout tickets). Not paying out funds.
//!
//! Accounts: **2** then each bet / cashout account
//! 0. `authority` (signer) — `market_id.operator` or aggregator config authority
//! 1. `config_pda` (readonly)
//! rest. `[bet_or_cashout_account; number_of_bets]`...
//!
//! Data: [BetResult; number_of_bets]

use pinocchio::{AccountView, ProgramResult, address::address_eq, error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{
   ID, helpers::{verify_config_pda, verify_market_operator_or_authority, verify_signer}, readers::read_u8_unchecked, state::{
      CASHOUT_ACCOUNT_DISCRIMINATOR, CASHOUT_ACCOUNT_MIN_LEN, CASHOUT_RESULT_OFFSET, PARLAY_BET_ACCOUNT_DISCRIMINATOR, account_bet::{
         BET_ACCOUNT_DISCRIMINATOR, BET_ACCOUNT_MIN_LEN, BET_RESULT_OFFSET, BetAccountData, BetResult,
      }, account_cashout::CashoutAccountData,
   }, writers::write_u8_unchecked,
};

pub const GRADE_BETS_IX_DISCRIMINATOR: u8 = 20;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      authority,
      config_pda,
      bet_accounts @ ..,
   ] = accounts else {
      log!("grade_bets: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&authority)?;
   verify_config_pda(&config_pda, true)?;

   let number_of_bets = bet_accounts.len();
   let data_len = data.len();
   if unlikely(data_len != number_of_bets) {
      log!("grade_bets: data length mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }

   for i in 0..data_len {
      if unlikely(!address_eq(bet_accounts[i].owner(), &ID)) {
         log!("grade_bets: account must be owned by this program");
         return Err(ProgramError::InvalidAccountOwner);
      }
      let acc_len = bet_accounts[i].data_len();
      let acc_mut_ptr = bet_accounts[i].data_mut_ptr();
      let disc = if acc_len > 0 {
         unsafe { read_u8_unchecked(acc_mut_ptr, 0) }
      } else {
         log!("grade_bets: account data is empty");
         return Err(ProgramError::InvalidAccountData);
      };
      if unlikely(disc == PARLAY_BET_ACCOUNT_DISCRIMINATOR) {
         log!("grade_bets: use grade_parlay for parlay accounts");
         return Err(ProgramError::InvalidInstructionData);
      }

      let is_cashout = disc == CASHOUT_ACCOUNT_DISCRIMINATOR;
      if unlikely(!is_cashout && disc != BET_ACCOUNT_DISCRIMINATOR) {
         log!("grade_bets: expected bet or cashout discriminator");
         return Err(ProgramError::InvalidAccountData);
      }

      if is_cashout {
         if unlikely(acc_len < CASHOUT_ACCOUNT_MIN_LEN) {
            return Err(ProgramError::InvalidAccountData);
         }
         
         let operator = unsafe { CashoutAccountData::read_operator(acc_mut_ptr) };
         verify_market_operator_or_authority(&authority, &config_pda, operator)?;

         if BetResult::try_from_grade_byte(data[i]).is_none() {
            log!("grade_bets: invalid cashout grade byte");
            return Err(ProgramError::InvalidInstructionData);
         }
         unsafe {
            write_u8_unchecked(acc_mut_ptr, CASHOUT_RESULT_OFFSET, data[i]);
         }
         continue;
      } else {
         if unlikely(acc_len < BET_ACCOUNT_MIN_LEN) {
            log!("grade_bets: bet account data length mismatch: {}", acc_len);
            return Err(ProgramError::InvalidAccountData);
         }

         let operator = unsafe { BetAccountData::read_operator(acc_mut_ptr) };
         verify_market_operator_or_authority(&authority, &config_pda, operator)?;

         let current = unsafe { read_u8_unchecked(acc_mut_ptr, BET_RESULT_OFFSET) };
         let Some(new_result) = BetResult::try_from_grade_byte(data[i]) else {
            log!("grade_bets: invalid bet result byte");
            return Err(ProgramError::InvalidInstructionData);
         };
         if unlikely(current == BetResult::CashedOut as u8 && new_result != BetResult::RolledBack) {
            log!("grade_bets: CashedOut original only accepts RolledBack");
            return Err(ProgramError::InvalidInstructionData);
         }
         unsafe {
            write_u8_unchecked(acc_mut_ptr, BET_RESULT_OFFSET, data[i]);
         }
      }
   }

   Ok(())
}
