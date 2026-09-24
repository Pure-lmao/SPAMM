//! MM `fill_cashout_rfq` (disc 144): transfer `amount_to_send` from MM ATA to payment dest.
//!
//! Accounts (9): user, config_pda, mm_market_data, mm_event_state, mm_config, mm_token, payment_dest, mint, token

use pinocchio::{
   AccountView, Address, ProgramResult, error::ProgramError,
};

use crate::instructions::rfq_helpers::transfer_mm_collateral;
use spamm_aggregator::helpers::verify_invoked_via_aggregator;

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      _user,
      config_pda,
      _mm_market_data,
      _mm_event_state,
      mm_config_pda,
      mm_token_account,
      payment_dest,
      _mint,
      _token_program,
   ] = accounts else {
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_invoked_via_aggregator(config_pda)?;

   transfer_mm_collateral(
      mm_config_pda,
      mm_token_account,
      payment_dest,
      data,
      "fill_cashout_rfq",
   )
}
