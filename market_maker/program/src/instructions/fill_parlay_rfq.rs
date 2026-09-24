//! CPI entry used by the aggregator for a parlay RFQ fill.
//! Validates config PDA, then transfer from MM ATA.
//!
//! Accounts **(7)** — no market_data:
//! 0. `user`
//! 1. `config_pda` — aggregator config (readonly signer)
//! 2. `mm_config_pda`
//! 3. `mm_token_account`
//! 4. `liability_account`
//! 5. `mint` (readonly)
//! 6. `token_program` (readonly)

use pinocchio::{
   AccountView, Address, ProgramResult, error::ProgramError,
};

use crate::instructions::rfq_helpers::transfer_mm_collateral;
use spamm_aggregator::helpers::verify_invoked_via_aggregator;

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      _user,
      config_pda,
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
      "fill_parlay_rfq",
   )
}
