//! MM `fill_cashout_rfq` (disc 144): transfer `amount_to_send` from MM ATA to payment dest under parent `fill_rfq_cashout`.
//!
//! Accounts (9): user, mm_market_data, mm_event_state, mm_config, mm_token, payment_dest, mint, token, ix_sysvar

use pinocchio::{
   AccountView, Address, ProgramResult, error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;

use crate::instructions::rfq_helpers::transfer_mm_collateral;
use spamm_aggregator::{
   helpers::verify_invoked_via_aggregator,
   instructions::FILL_RFQ_CASHOUT_IX_DISCRIMINATOR,
};

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      _user,
      _mm_market_data,
      _mm_event_state,
      mm_config_pda,
      mm_token_account,
      payment_dest,
      _mint,
      _token_program,
      instructions_sysvar,
   ] = accounts else {
      log!("fill_cashout_rfq: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parent_disc = verify_invoked_via_aggregator(instructions_sysvar)?;
   if unlikely(parent_disc != FILL_RFQ_CASHOUT_IX_DISCRIMINATOR) {
      log!("fill_cashout_rfq: parent must be fill_rfq_cashout");
      return Err(ProgramError::InvalidInstructionData);
   }

   transfer_mm_collateral(
      mm_config_pda,
      mm_token_account,
      payment_dest,
      data,
      "fill_cashout_rfq",
   )
}
