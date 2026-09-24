//! CPI entry used by the aggregator to fill a leg after quotes are sorted.
//! Validates MM config + quote-buffer PDAs, instruction vs buffer snapshot, transfer from MM ATA.
//!
//! Accounts **(10)** (aggregator order):
//! 0. `user`
//! 1. `config_pda` — aggregator config (readonly signer)
//! 2. `mm_market_data_pda` — writable; unused here (MM may write on fill)
//! 3. `mm_event_state_pda` — writable, unverified; unused here (MM may write the tail on fill)
//! 4. `mm_config_pda`
//! 5. `mm_quote_buffer`
//! 6. `mm_token_account` — SPL authority must be the config PDA (`init_program`)
//! 7. `liability_account`
//! 8. `mint` (readonly)
//! 9. `token_program` (readonly)

use pinocchio::{
   AccountView, Address, ProgramResult, error::ProgramError, hint::{likely, unlikely},
};
use pinocchio_log::log;

use crate::{
   instructions::token_transfer::transfer_mm_config_signed,
   mm_helpers::{check_quote_matches, mm_config_address_ok, quote_buffer_address_ok},
   state::FillBetQuoteIxPayload,
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
      _mm_market_data_pda,
      _mm_event_state_pda,
      mm_config_pda,
      mm_quote_buffer,
      mm_token_account,
      liability_account,
      _mint,
      _token_program,
   ] = accounts else {
      log!("fill_bet_quote: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_invoked_via_aggregator(config_pda)?;

   if unlikely(!mm_config_address_ok(mm_config_pda, program_id)) {
      log!("fill_bet_quote: mm config pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   if unlikely(!quote_buffer_address_ok(mm_quote_buffer, program_id)) {
      log!("fill_bet_quote: quote buffer invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(mm_quote_buffer.data_len() != MM_QUOTE_BUFFER_LEN) {
      log!("fill_bet_quote: quote buffer len mismatch");
      return Err(ProgramError::InvalidAccountData);
   }

   let ix_data = FillBetQuoteIxPayload::decode(data)?;

   let expected = MMQuoteBuffer {
      discriminator: MM_QUOTE_BUFFER_DISCRIMINATOR,
      is_used: 0,
      user_address: *user.address(),
      market_id: ix_data.market_id,
      side: ix_data.side,
      max_amount: ix_data.amount_to_fill,
      odds_scaled: ix_data.odds_scaled,
      event_game_state: ix_data.event_game_state,
      event_state_sequence: ix_data.event_state_sequence,
   };
   let quote = {
      let quote_buf = mm_quote_buffer.try_borrow()?;
      MMQuoteBuffer::decode(quote_buf.as_ref())?
   };
   check_quote_matches(&expected, &quote, true)?;

   if likely(ix_data.amount_to_send > 0) {
      transfer_mm_config_signed(
         mm_config_pda,
         mm_token_account,
         liability_account,
         ix_data.amount_to_send,
      )?;
   }

   unsafe {
      write_u8_unchecked(mm_quote_buffer.data_mut_ptr(), MMQuoteBuffer::IS_USED_OFFSET, 1);
   }

   Ok(())
}
