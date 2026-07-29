//! CPI entry used by the aggregator for a parlay RFQ fill.
//! Validates config PDA + parent `fill_rfq_parlay` ix, then transfer from MM ATA.
//!
//! Accounts **(7)** — no market_data:
//! 0. `user`
//! 1. `mm_config_pda`
//! 2. `mm_token_account`
//! 3. `liability_account`
//! 4. `mint` (readonly)
//! 5. `token_program` (readonly)
//! 6. `instructions_sysvar` (readonly)

use pinocchio::{
   AccountView, Address, ProgramResult, error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;

use crate::instructions::rfq_helpers::transfer_rfq_collateral;
use spamm_aggregator::{
   helpers::verify_invoked_via_aggregator_rfq_ix,
   instructions::FILL_RFQ_PARLAY_IX_DISCRIMINATOR,
};

pub const FILL_PARLAY_RFQ_IX_DISCRIMINATOR: u8 = 16;

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      _user, 
      mm_config_pda, 
      mm_token_account, 
      liability_account, 
      _mint, 
      _token_program, 
      instructions_sysvar
   ] =
      accounts
   else {
      log!("fill_parlay_rfq: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parent_disc = verify_invoked_via_aggregator_rfq_ix(instructions_sysvar)?;
   if unlikely(parent_disc != FILL_RFQ_PARLAY_IX_DISCRIMINATOR) {
      log!("fill_parlay_rfq: parent must be fill_rfq_parlay");
      return Err(ProgramError::InvalidInstructionData);
   }

   transfer_rfq_collateral(
      mm_config_pda,
      mm_token_account,
      liability_account,
      data,
      "fill_parlay_rfq",
   )
}
