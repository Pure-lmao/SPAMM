use pinocchio::{account::AccountView, address::address_eq, error::ProgramError, hint::unlikely, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::token::transfer_from_config;
use spamm_aggregator::{
   constants::MAX_PARLAY_LEGS,
   helpers::verify_invoked_via_aggregator,
   state::{FillCashoutParlayQuoteIxData, MMParlayQuoteBuffer},
};

pub fn process(
   program_id: &Address,
   accounts: &mut [AccountView],
   full_data: &[u8],
) -> ProgramResult {
   let [
      user,           // matched to the parlay quote buffer
      agg_config,     // aggregator config PDA signer
      config,         // aggregator `verify_mm_config_pda`; `transfer_from_config`
      parlay_buffer,  // aggregator `verify_parlay_quote_buffer`; `MMParlayQuoteBuffer::decode`
      source,         // aggregator `verify_token_account` (owner = config)
      payment_dest,   // aggregator `cashout_payment_dest`
      _mint,          // aggregator `verify_mint`
      _token_program, // aggregator `verify_token_program`
   ] = accounts else {
      log!("fill_cashout_parlay_quote: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_invoked_via_aggregator(agg_config)?;
   let ix = FillCashoutParlayQuoteIxData::decode(full_data)?;
   let quote = {
      let buf = parlay_buffer.try_borrow()?;
      MMParlayQuoteBuffer::decode(buf.as_ref())?
   };
   let n = quote.num_legs as usize;
   if unlikely(
      quote.is_used != 0
         || !address_eq(&quote.user_address, user.address())
         || n < 2
         || n > MAX_PARLAY_LEGS,
   ) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(ix.amount_to_send > quote.max_amount) {
      return Err(ProgramError::InvalidInstructionData);
   }
   transfer_from_config(program_id, config, source, payment_dest, ix.amount_to_send)?;
   let mut buf = parlay_buffer.try_borrow_mut()?;
   buf[MMParlayQuoteBuffer::IS_USED_OFFSET] = 1;
   Ok(())
}
