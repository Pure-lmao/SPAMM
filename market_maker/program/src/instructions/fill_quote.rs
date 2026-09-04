//! CPI entry used by the aggregator to fill a leg after quotes are sorted.
//! Validates MM config + quote-buffer PDAs, instruction vs buffer snapshot, transfer from MM ATA.
//!
//! Accounts **(10)** (aggregator order):
//! 0. `user`
//! 1. `mm_market_data_pda` — writable; unused here (MM may write on fill)
//! 2. `mm_event_state_pda` — writable, unverified; unused here (MM may write the tail on fill)
//! 3. `mm_config_pda`
//! 4. `mm_quote_buffer`
//! 5. `mm_token_account` — SPL authority must be the config PDA (`init_program`)
//! 6. `liability_account`
//! 7. `mint` (readonly)
//! 8. `token_program` (readonly)
//! 9. `instructions_sysvar` (readonly) — introspect parent `fill_bet`

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, error::ProgramError, hint::{likely, unlikely},
};
use pinocchio_log::log;

use crate::{
   constants::{MM_CONFIG_PDA, QUOTE_BUFFER_PDA},
   instructions::token_transfer::transfer_mm_config_signed,
   mm_helpers::check_quote_matches,
   state::FillQuoteIxPayload,
};
use spamm_aggregator::{
   helpers::verify_invoked_via_aggregator,
   instructions::{FILL_BET_IX_DISCRIMINATOR, FREEBET_FILL_BET_IX_DISCRIMINATOR},
   writers::write_u8_unchecked,
   state::{
      MMQuoteBuffer, MM_QUOTE_BUFFER_LEN,
      mm_quote::MM_QUOTE_BUFFER_DISCRIMINATOR,
   },
};

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      _mm_market_data_pda,
      _mm_event_state_pda,
      mm_config_pda,
      mm_quote_buffer,
      mm_token_account,
      liability_account,
      _mint,
      _token_program,
      instructions_sysvar,
   ] = accounts else {
      log!("fill_quote: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parent_disc = verify_invoked_via_aggregator(instructions_sysvar)?;
   if unlikely(parent_disc != FILL_BET_IX_DISCRIMINATOR && parent_disc != FREEBET_FILL_BET_IX_DISCRIMINATOR) {
      log!("fill_quote: parent must be fill_bet or freebet_fill_bet");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      log!("fill_quote: mm config pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   if unlikely(!address_eq(mm_quote_buffer.address(), &QUOTE_BUFFER_PDA)) {
      log!("fill_quote: quote buffer invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(mm_quote_buffer.data_len() != MM_QUOTE_BUFFER_LEN) {
      log!("fill_quote: quote buffer len mismatch");
      return Err(ProgramError::InvalidAccountData);
   }

   let ix_data = FillQuoteIxPayload::decode(data)?;

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
