//! CPI entry used by the aggregator for a single-bet RFQ fill.
//! Validates config PDA, then transfer from MM ATA.
//!
//! Accounts **(9)**:
//! 0. `user`
//! 1. `config_pda` — aggregator config (readonly signer)
//! 2. `mm_market_data_pda` (writable; reserved for MM market updates)
//! 3. `mm_event_state_pda` (writable; reserved for MM event updates)
//! 4. `mm_config_pda`
//! 5. `mm_token_account`
//! 6. `liability_account`
//! 7. `mint` (readonly)
//! 8. `token_program` (readonly)

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
      liability_account,
      _mint,
      _token_program,
   ] =
      accounts
   else {
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_invoked_via_aggregator(config_pda)?;

   transfer_mm_collateral(
      mm_config_pda,
      mm_token_account,
      liability_account,
      data,
      "fill_bet_rfq",
   )
}
