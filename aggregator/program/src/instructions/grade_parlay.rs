//! Grade legs on one parlay / cashout-parlay account and fold ticket-level `result`.
//!
//! Accounts: **3**
//! 0. `authority` (signer)
//! 1. `config_pda` (readonly)
//! 2. `parlay_or_cashout_parlay` (writable)
//!
//! Data: exactly `num_legs` grade bytes (`255` = skip).

use pinocchio::{AccountView, ProgramResult, address::address_eq, error::ProgramError, hint::{likely, unlikely}};
use pinocchio_log::log;

use crate::{
   ID, helpers::{
      parlay_helpers::{
         fold_cashout_parlay_ticket_result_from_account, fold_parlay_ticket_result_from_account,
      }, verify_config_pda, verify_market_operator_or_authority, verify_signer,
      verify_cashout_parlay_pda, verify_parlay_pda,
   }, state::{
      CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR, CashoutParlayAccountData, PARLAY_BET_ACCOUNT_DISCRIMINATOR, ParlayBetAccountData, account_bet::{BetResult, GRADE_PARLAY_LEG_SKIP},
   },
};

pub const GRADE_PARLAY_IX_DISCRIMINATOR: u8 = 21;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      authority,
      config_pda,
      bet_account,
   ] = accounts else {
      log!("grade_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(authority)?;
   verify_config_pda(config_pda, true)?;

   if unlikely(!address_eq(bet_account.owner(), &ID)) {
      log!("grade_parlay: account must be owned by this program");
      return Err(ProgramError::InvalidAccountOwner);
   }

   let disc = if bet_account.data_len() > 0 {
      unsafe { *bet_account.data_ptr() }
   } else {
      log!("grade_parlay: account data is empty");
      return Err(ProgramError::InvalidAccountData);
   };
   let is_cashout = disc == CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR;

   let (ticket_result, num_legs) = {
      let raw = bet_account.try_borrow()?;
      let acct = raw.as_ref();
      if is_cashout {
         let header = CashoutParlayAccountData::decode_header(acct)?;
         verify_cashout_parlay_pda(
            bet_account,
            &header.mm,
            header.cashout_id,
            header.bump,
         )?;
         (header.result, header.num_legs as usize)
      } else {
         if unlikely(disc != PARLAY_BET_ACCOUNT_DISCRIMINATOR) {
            log!("grade_parlay: account discriminator is not a parlay bet account");
            return Err(ProgramError::InvalidAccountData);
         }
         let header = ParlayBetAccountData::decode_header(acct)?;
         verify_parlay_pda(bet_account, &header.owner, header.bet_id, header.bump)?;
         (header.result, header.num_legs as usize)
      }
   };

   let mut raw = bet_account.try_borrow_mut()?;
   let acct = raw.as_mut();

   if unlikely(data.len() != num_legs) {
      log!("grade_parlay: grade mask len mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }

   let cashed_out_orig = !is_cashout && ticket_result == BetResult::CashedOut;
   let mut wrote_any_leg = false;

   for (leg_i, &grade_byte) in data.iter().enumerate() {
      if grade_byte == GRADE_PARLAY_LEG_SKIP {
         continue;
      }
      if unlikely(cashed_out_orig && grade_byte != BetResult::RolledBack as u8) {
         log!("grade_parlay: CashedOut original only accepts RolledBack");
         return Err(ProgramError::InvalidInstructionData);
      }
      let Some(new_result) = BetResult::try_from_grade_byte(grade_byte) else {
         log!("grade_parlay: invalid grade byte {}", grade_byte);
         return Err(ProgramError::InvalidInstructionData);
      };
      let operator = if is_cashout { 
         CashoutParlayAccountData::read_leg_operator(acct, leg_i)?
      } else { 
         ParlayBetAccountData::read_leg_operator(acct, leg_i)?
      };
      verify_market_operator_or_authority(authority, config_pda, operator)?;
      write_leg_result(acct, leg_i, new_result, is_cashout)?;
      wrote_any_leg = true;
   }

   if likely(wrote_any_leg) {
      let ticket = if is_cashout {
         fold_cashout_parlay_ticket_result_from_account(acct, num_legs)?
      } else {
         fold_parlay_ticket_result_from_account(acct, num_legs)?
      };
      write_ticket_result(acct, ticket, is_cashout)?;
   }
   Ok(())
}

#[inline(always)]
fn write_leg_result(
   acct: &mut [u8],
   leg_i: usize,
   result: BetResult,
   is_cashout: bool,
) -> ProgramResult {
   if is_cashout {
      CashoutParlayAccountData::write_leg_result(acct, leg_i, result)
   } else {
      ParlayBetAccountData::write_leg_result(acct, leg_i, result)
   }
}

#[inline(always)]
fn write_ticket_result(
   acct: &mut [u8],
   result: BetResult,
   is_cashout: bool,
) -> ProgramResult {
   if is_cashout {
      CashoutParlayAccountData::write_ticket_result(acct, result)
   } else {
      ParlayBetAccountData::write_ticket_result(acct, result)
   }
}
