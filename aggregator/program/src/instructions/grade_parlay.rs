//! Grade one or more legs on parlay bet accounts and fold ticket-level `result`.
//!
//! Accounts: **2** then each parlay bet account
//! 0. `authority` (signer) — graded leg's `market_id.operator` or aggregator config authority
//! 1. `config_pda` (readonly)
//! rest. `[parlay_bet_account; N]`
//!
//! Data: `[u8; 5]` per parlay account (`255` = skip leg). `data.len() == 5 * N`.

use pinocchio::{AccountView, ProgramResult, error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{
   constants::MAX_PARLAY_LEGS,
   helpers::{verify_config_pda, verify_market_operator_or_authority, verify_signer},
   parlay_helpers::fold_parlay_ticket_result,
   state::{
      PARLAY_BET_ACCOUNT_LEN, ParlayBetAccountData, ParlayLegWire,
      account_bet::{BetResult, GRADE_PARLAY_LEG_SKIP},
   },
};

pub const GRADE_PARLAY_IX_DISCRIMINATOR: u8 = 21;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      authority, //verified as signer
      config_pda, //verified by verify_config_pda
      parlay_accounts @ ..,
   ] = accounts else {
      log!("grade_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&authority)?;
   verify_config_pda(&config_pda, true)?;

   let n = parlay_accounts.len();
   if unlikely(data.len() != n.saturating_mul(MAX_PARLAY_LEGS)) {
      log!("grade_parlay: data length mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }

   for (acct_i, bet_account) in parlay_accounts.iter_mut().enumerate() {
      if unlikely(bet_account.data_len() != PARLAY_BET_ACCOUNT_LEN as usize) {
         log!("grade_parlay: not a parlay bet account");
         return Err(ProgramError::InvalidInstructionData);
      }

      let offset = acct_i.saturating_mul(MAX_PARLAY_LEGS);
      let grade_mask = &data[offset..offset + MAX_PARLAY_LEGS];

      let mut bet_data = {
         let raw = bet_account.try_borrow()?;
         ParlayBetAccountData::decode(raw.as_ref())?
      };

      let num_legs = bet_data.num_legs as usize;

      for (leg_i, &grade_byte) in grade_mask.iter().enumerate() {
         if leg_i >= num_legs {
            if unlikely(grade_byte != GRADE_PARLAY_LEG_SKIP) {
               log!("grade_parlay: cannot grade past num_legs");
               return Err(ProgramError::InvalidInstructionData);
            }
            continue;
         }
         if grade_byte == GRADE_PARLAY_LEG_SKIP {
            continue;
         }
         let Some(new_result) = BetResult::try_from_grade_byte(grade_byte) else {
            log!("grade_parlay: invalid grade byte {}", grade_byte);
            return Err(ProgramError::InvalidInstructionData);
         };
         let leg = bet_data
            .legs
            .get(leg_i)
            .ok_or(ProgramError::InvalidAccountData)?;
         verify_market_operator_or_authority(&authority, &config_pda, &leg.market_id)?;
         if unlikely(leg.result != BetResult::Pending) {
            log!("grade_parlay: leg already graded");
            return Err(ProgramError::InvalidInstructionData);
         }
         bet_data.legs.set(
            leg_i,
            ParlayLegWire {
               result: new_result,
               ..*leg
            },
         );
      }

      bet_data.result = fold_parlay_ticket_result(num_legs, &bet_data.legs);

      {
         let mut raw = bet_account.try_borrow_mut()?;
         bet_data.write_to_account(&mut raw)?;
      }
   }

   Ok(())
}
