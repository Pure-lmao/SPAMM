//! CPI entry used by the aggregator for a single-bet RFQ fill.
//! Validates config PDA + parent `fill_rfq_bet` ix, then transfer from MM ATA.
//!
//! Accounts **(8)**:
//! 0. `user`
//! 1. `mm_market_data_pda` (writable; reserved for MM market updates)
//! 2. `mm_config_pda`
//! 3. `mm_token_account`
//! 4. `liability_account`
//! 5. `mint` (readonly)
//! 6. `token_program` (readonly)
//! 7. `instructions_sysvar` (readonly)

use pinocchio::{
   AccountView, Address, ProgramResult, error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;

use crate::instructions::rfq_helpers::transfer_rfq_collateral;
use spamm_aggregator::{
   helpers::verify_invoked_via_aggregator_rfq_ix,
   instructions::FILL_RFQ_BET_IX_DISCRIMINATOR,
};

pub const FILL_BET_RFQ_IX_DISCRIMINATOR: u8 = 14;

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      _user, 
      _mm_market_data, 
      mm_config_pda, 
      mm_token_account, 
      liability_account, 
      _mint, 
      _token_program, 
      instructions_sysvar,
   ] =
      accounts
   else {
      log!("fill_bet_rfq: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parent_disc = verify_invoked_via_aggregator_rfq_ix(instructions_sysvar)?;
   if unlikely(parent_disc != FILL_RFQ_BET_IX_DISCRIMINATOR) {
      log!("fill_bet_rfq: parent must be fill_rfq_bet");
      return Err(ProgramError::InvalidInstructionData);
   }

   transfer_rfq_collateral(
      mm_config_pda,
      mm_token_account,
      liability_account,
      data,
      "fill_bet_rfq",
   )
}
