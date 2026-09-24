use pinocchio::{account::AccountView, address::address_eq, error::ProgramError, hint::unlikely, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::token::transfer_from_config;
use spamm_aggregator::{
   helpers::verify_invoked_via_aggregator,
   state::{FillCashoutQuoteIxData, MMQuoteBuffer},
};

pub fn process(
   program_id: &Address,
   accounts: &mut [AccountView],
   full_data: &[u8],
) -> ProgramResult {
   let [
      user,           // matched to the quote buffer
      agg_config,     // aggregator config PDA signer
      _market,        // aggregator `verify_mm_market_data_pda`
      _event_state,   // aggregator `verify_event_state`
      config,         // aggregator `verify_mm_config_pda`; `transfer_from_config`
      quote_buffer,   // aggregator `verify_quote_buffer`; `MMQuoteBuffer::decode`
      source,         // aggregator `verify_token_account` (owner = config)
      payment_dest,   // aggregator `cashout_payment_dest`
      _mint,          // aggregator `verify_mint`
      _token_program, // aggregator `verify_token_program`
   ] = accounts else {
      log!("fill_cashout_quote: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_invoked_via_aggregator(agg_config)?;
   let ix = FillCashoutQuoteIxData::decode(full_data)?;
   let quote = {
      let buf = quote_buffer.try_borrow()?;
      MMQuoteBuffer::decode(buf.as_ref())?
   };
   if unlikely(quote.is_used != 0 || !address_eq(&quote.user_address, user.address())) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!quote.market_id.eq(&ix.market_id) || quote.side != ix.side) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(ix.amount_to_send > quote.max_amount) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(
      quote.event_state_sequence != ix.event_state_sequence
         || quote.event_game_state != ix.event_game_state,
   ) {
      return Err(ProgramError::InvalidInstructionData);
   }
   transfer_from_config(program_id, config, source, payment_dest, ix.amount_to_send)?;
   let mut buf = quote_buffer.try_borrow_mut()?;
   buf[MMQuoteBuffer::IS_USED_OFFSET] = 1;
   Ok(())
}
