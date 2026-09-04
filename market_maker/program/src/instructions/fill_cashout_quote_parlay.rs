//! CPI entry used by the aggregator to consume a parlay cashout quote buffer and pay the user.
//! Validates config + parlay buffer PDA, quote vs instruction, transfer, marks buffer used.
//!
//! Accounts **(8)** (aggregator order):
//! 0. `user`
//! 1. `mm_config_pda`
//! 2. `mm_parlay_quote_buffer`
//! 3. `mm_token_account`
//! 4. `payment_dest`
//! 5. `mint` (readonly)
//! 6. `token_program` (readonly)
//! 7. `instructions_sysvar` (readonly) — introspect parent `fill_parlay_cashout`

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, error::ProgramError, hint::{likely, unlikely},
};
use pinocchio_log::log;

use crate::{
   constants::{MM_CONFIG_PDA, PARLAY_QUOTE_BUFFER_PDA},
   instructions::token_transfer::transfer_mm_config_signed,
   state::FillCashoutQuoteParlayIxPayload,
};
use spamm_aggregator::{
   constants::MAX_PARLAY_LEGS,
   helpers::verify_invoked_via_aggregator,
   instructions::FILL_PARLAY_CASHOUT_IX_DISCRIMINATOR,
   writers::write_u8_unchecked,
   state::{
      MMParlayQuoteBuffer, MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR, MM_PARLAY_QUOTE_BUFFER_LEN,
   },
};

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      mm_config_pda,
      mm_parlay_quote_buffer,
      mm_token_account,
      payment_dest,
      _mint,
      _token_program,
      instructions_sysvar,
   ] = accounts else {
      log!("fill_cashout_quote_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parent_disc = verify_invoked_via_aggregator(instructions_sysvar)?;
   if unlikely(parent_disc != FILL_PARLAY_CASHOUT_IX_DISCRIMINATOR) {
      log!("fill_cashout_quote_parlay: parent must be fill_parlay_cashout");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      return Err(ProgramError::InvalidSeeds);
   }
   if unlikely(!address_eq(mm_parlay_quote_buffer.address(), &PARLAY_QUOTE_BUFFER_PDA)) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(mm_parlay_quote_buffer.data_len() != MM_PARLAY_QUOTE_BUFFER_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }

   let ix_data = FillCashoutQuoteParlayIxPayload::decode(data)?;
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
