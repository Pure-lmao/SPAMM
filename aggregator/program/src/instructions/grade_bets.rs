//! Set the Result value of single bets. Not paying out funds to the winners.
//! 
//! Accounts: **2** then each bet account
//! 0. `authority` (signer) — `market_id.operator` or aggregator config authority
//! 1. `config_pda` (readonly)
//! rest. `[bet_account; number_of_bets]`...
//!
//! Data: [BetResult; number_of_bets]

use pinocchio::ProgramResult;
use pinocchio::{AccountView, hint::unlikely};
use pinocchio::error::ProgramError;
use pinocchio_log::log;

use crate::helpers::{verify_config_pda, verify_market_operator_or_authority, verify_signer};
use crate::state::{BET_ACCOUNT_LEN, PARLAY_BET_ACCOUNT_LEN, BetAccountData};
use crate::state::account_bet::{BET_RESULT_OFFSET, BetResult};

pub const GRADE_BETS_IX_DISCRIMINATOR: u8 = 20;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      authority, //verified as signer
      config_pda, //verified by verify_config_pda
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
      if unlikely(bet_accounts[i].data_len() == PARLAY_BET_ACCOUNT_LEN as usize) {
         log!("grade_bets: use grade_parlay for parlay accounts");
         return Err(ProgramError::InvalidInstructionData);
      }
      if unlikely(bet_accounts[i].data_len() != BET_ACCOUNT_LEN as usize) {
         log!("grade_bets: bet account data length mismatch: {}", bet_accounts[i].data_len());
         return Err(ProgramError::InvalidInstructionData);
      }

      let bet_data = {
         let raw = bet_accounts[i].try_borrow()?;
         BetAccountData::decode(raw.as_ref())?
      };
      verify_market_operator_or_authority(&authority, &config_pda, &bet_data.market_id)?;

      if data[i] == 0 || data[i] > 8 {
         log!("grade_bets: invalid bet result byte");
         return Err(ProgramError::InvalidInstructionData);
      }
      if unlikely(data[i] == BetResult::ModifiedWin as u8) {
         log!("grade_bets: ModifiedWin is parlay-only");
         return Err(ProgramError::InvalidInstructionData);
      }
      {
         let bet_data_ptr: *mut u8 = bet_accounts[i].data_mut_ptr();
         //SAFTEY: we already verified that the data is the correct length.
         //the tx will fail if the account is not owned by us so no need to check it.
         unsafe {
            bet_data_ptr.add(BET_RESULT_OFFSET).write_bytes(data[i], 1);
         }
      }
   }

   Ok(())
}
