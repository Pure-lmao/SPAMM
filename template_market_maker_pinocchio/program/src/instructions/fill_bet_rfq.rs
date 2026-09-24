use pinocchio::{account::AccountView, error::ProgramError, hint::unlikely, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::token::transfer_from_config;
use spamm_aggregator::{
   helpers::verify_invoked_via_aggregator,
   state::{FillRfqIxData, FILL_BET_RFQ_IX_DISCRIMINATOR},
};

pub fn process(program_id: &Address, accounts: &mut [AccountView], full_data: &[u8]) -> ProgramResult {
   let [
      _user,          // aggregator passes the bet user
      agg_config,     // aggregator config PDA signer
      _market,        // aggregator `verify_mm_market_data_pda`
      _event_state,   // aggregator `verify_event_state`
      config,         // aggregator `verify_mm_config_pda`; `transfer_from_config`
      source,         // aggregator `verify_token_account` (owner = config)
      liability,      // aggregator `verify_token_account` (owner = encumbrance)
      _mint,          // aggregator `verify_mint`
      _token_program, // aggregator `verify_token_program`
   ] = accounts else {
      log!("fill_bet_rfq: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_invoked_via_aggregator(agg_config)?;
   let ix = FillRfqIxData::decode(full_data)?;
   if unlikely(ix.instruction_discriminator != FILL_BET_RFQ_IX_DISCRIMINATOR) {
      return Err(ProgramError::InvalidInstructionData);
   }
   transfer_from_config(program_id, config, source, liability, ix.amount_to_send)
}
