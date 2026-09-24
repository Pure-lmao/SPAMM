//! CPI entry used by the aggregator to consume a parlay cashout quote buffer and pay the user.
//! Validates config + parlay buffer PDA, quote vs instruction, transfer, marks buffer used.
//!
//! Accounts **(8)** (aggregator order):
//! 0. `user`
//! 1. `config_pda` — aggregator config (readonly signer)
//! 2. `mm_config_pda`
//! 3. `mm_parlay_quote_buffer`
//! 4. `mm_token_account`
//! 5. `payment_dest`
//! 6. `mint` (readonly)
//! 7. `token_program` (readonly)

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, error::ProgramError, hint::{likely, unlikely},
};
use pinocchio_log::log;

use crate::{
   instructions::token_transfer::transfer_mm_config_signed,
   mm_helpers::{mm_config_address_ok, parlay_quote_buffer_address_ok},
   state::FillCashoutParlayQuoteIxPayload,
};
use spamm_aggregator::{
   constants::MAX_PARLAY_LEGS,
   helpers::verify_invoked_via_aggregator,
   writers::write_u8_unchecked,
   state::{
      MMParlayQuoteBuffer, MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR, MM_PARLAY_QUOTE_BUFFER_LEN,
   },
};

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      config_pda,
      mm_config_pda,
      mm_parlay_quote_buffer,
      mm_token_account,
      payment_dest,
      _mint,
      _token_program,
   ] = accounts else {
      log!("fill_cashout_parlay_quote: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_invoked_via_aggregator(config_pda)?;

   if unlikely(!mm_config_address_ok(mm_config_pda, program_id)) {
      return Err(ProgramError::InvalidSeeds);
   }
   if unlikely(!parlay_quote_buffer_address_ok(mm_parlay_quote_buffer, program_id)) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(mm_parlay_quote_buffer.data_len() != MM_PARLAY_QUOTE_BUFFER_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }

   let ix_data = FillCashoutParlayQuoteIxPayload::decode(data)?;
   let quote = {
      let quote_buf = mm_parlay_quote_buffer.try_borrow()?;
      MMParlayQuoteBuffer::decode(quote_buf.as_ref())?
   };
   if unlikely(quote.discriminator != MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(quote.is_used != 0) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!address_eq(&quote.user_address, user.address())) {
      return Err(ProgramError::InvalidAccountData);
   }
   let n = quote.num_legs as usize;
   if unlikely(n < 2 || n > MAX_PARLAY_LEGS) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(quote.odds_scaled == 0) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(ix_data.amount_to_send > quote.max_amount) {
      return Err(ProgramError::InvalidInstructionData);
   }

   if likely(ix_data.amount_to_send > 0) {
      transfer_mm_config_signed(
         mm_config_pda,
         mm_token_account,
         payment_dest,
         ix_data.amount_to_send,
      )?;
   }
   unsafe {
      write_u8_unchecked(
         mm_parlay_quote_buffer.data_mut_ptr(),
         MMParlayQuoteBuffer::IS_USED_OFFSET,
         1,
      );
   }
   Ok(())
}
