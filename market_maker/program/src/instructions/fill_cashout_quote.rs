//! MM `fill_cashout_quote` (disc 141): transfer `amount_to_send` from MM ATA to payment dest; set quote buffer `is_used`.
//!
//! Accounts **(10)** — match aggregator:
//! 0. `user` (readonly)
//! 1. `mm_market_data_pda` (writable)
//! 2. `mm_event_state_pda` (writable)
//! 3. `mm_config_pda` (writable)
//! 4. `mm_quote_buffer` (writable)
//! 5. `mm_token_account` (writable)
//! 6. `payment_dest` (writable)
//! 7. `mint` (readonly)
//! 8. `token_program` (readonly)
//! 9. `instructions_sysvar` (readonly)

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, error::ProgramError, hint::{likely, unlikely},
};
use pinocchio_log::log;

use crate::{
   constants::{MM_CONFIG_PDA, QUOTE_BUFFER_PDA},
   instructions::token_transfer::transfer_mm_config_signed,
   mm_helpers::check_quote_matches,
   state::FillCashoutQuoteIxPayload,
};
use spamm_aggregator::{
   helpers::verify_invoked_via_aggregator,
   instructions::FILL_CASHOUT_IX_DISCRIMINATOR,
   writers::write_u8_unchecked,
   state::{
      MMQuoteBuffer, MM_QUOTE_BUFFER_LEN,
      mm_quote::MM_QUOTE_BUFFER_DISCRIMINATOR,
   },
};

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      _mm_market_data,
      _mm_event_state,
      mm_config_pda,
      mm_quote_buffer,
      mm_token_account,
      payment_dest,
      _mint,
      _token_program,
      instructions_sysvar,
   ] = accounts else {
      log!("fill_cashout_quote: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parent_disc = verify_invoked_via_aggregator(instructions_sysvar)?;
   if unlikely(parent_disc != FILL_CASHOUT_IX_DISCRIMINATOR) {
      log!("fill_cashout_quote: parent must be fill_cashout");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      return Err(ProgramError::InvalidSeeds);
   }
   if unlikely(!address_eq(mm_quote_buffer.address(), &QUOTE_BUFFER_PDA)) {
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
