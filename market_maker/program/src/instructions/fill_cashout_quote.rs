//! MM `fill_cashout_quote` (disc 141): transfer `amount_to_send` from MM ATA to payment dest; set quote buffer `is_used`.
//!
//! Accounts **(10)** — match aggregator:
//! 0. `user` (readonly)
//! 1. `config_pda` — aggregator config (readonly signer)
//! 2. `mm_market_data_pda` (writable)
//! 3. `mm_event_state_pda` (writable)
//! 4. `mm_config_pda` (writable)
//! 5. `mm_quote_buffer` (writable)
//! 6. `mm_token_account` (writable)
//! 7. `payment_dest` (writable)
//! 8. `mint` (readonly)
//! 9. `token_program` (readonly)

use pinocchio::{
   AccountView, Address, ProgramResult, error::ProgramError, hint::{likely, unlikely},
};
use pinocchio_log::log;

use crate::{
   instructions::token_transfer::transfer_mm_config_signed,
   mm_helpers::{check_quote_matches, mm_config_address_ok, quote_buffer_address_ok},
   state::FillCashoutQuoteIxPayload,
};
use spamm_aggregator::{
   helpers::verify_invoked_via_aggregator,
   writers::write_u8_unchecked,
   state::{
      MMQuoteBuffer, MM_QUOTE_BUFFER_LEN,
      mm_quote::MM_QUOTE_BUFFER_DISCRIMINATOR,
   },
};

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      config_pda,
      _mm_market_data,
      _mm_event_state,
      mm_config_pda,
      mm_quote_buffer,
      mm_token_account,
      payment_dest,
      _mint,
      _token_program,
   ] = accounts else {
      log!("fill_cashout_quote: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_invoked_via_aggregator(config_pda)?;

   if unlikely(!mm_config_address_ok(mm_config_pda, program_id)) {
      return Err(ProgramError::InvalidSeeds);
   }
   if unlikely(!quote_buffer_address_ok(mm_quote_buffer, program_id)) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(mm_quote_buffer.data_len() != MM_QUOTE_BUFFER_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }

   let ix_data = FillCashoutQuoteIxPayload::decode(data)?;
   let expected = MMQuoteBuffer {
      discriminator: MM_QUOTE_BUFFER_DISCRIMINATOR,
      is_used: 0,
      user_address: *user.address(),
      market_id: ix_data.market_id,
      side: ix_data.side,
      max_amount: ix_data.amount_to_send,
      odds_scaled: 0,
      event_game_state: ix_data.event_game_state,
      event_state_sequence: ix_data.event_state_sequence,
   };
   let quote = {
      let quote_buf = mm_quote_buffer.try_borrow()?;
      MMQuoteBuffer::decode(quote_buf.as_ref())?
   };
   check_quote_matches(&expected, &quote, false)?;

   if likely(ix_data.amount_to_send > 0) {
      transfer_mm_config_signed(
         mm_config_pda,
         mm_token_account,
         payment_dest,
         ix_data.amount_to_send,
      )?;
   }

   unsafe {
      write_u8_unchecked(mm_quote_buffer.data_mut_ptr(), MMQuoteBuffer::IS_USED_OFFSET, 1);
   }
   Ok(())
}
