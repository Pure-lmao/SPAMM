//! CPI entry used by the aggregator to consume a parlay quote buffer and pull collateral from the MM ATA.
//! Validates config + parlay buffer PDA, quote vs instruction, transfer, marks buffer used.
//!
//! Accounts **(8)** (aggregator order):
//! 0. `user`
//! 1. `mm_config_pda`
//! 2. `mm_parlay_quote_buffer`
//! 3. `mm_token_account`
//! 4. `liability_account`
//! 5. `mint` (readonly)
//! 6. `token_program` (readonly)
//! 7. `instructions_sysvar` (readonly) — introspect parent `fill_parlay`

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError, hint::{likely, unlikely},
};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::constants::{MAX_QUOTE_STAKE_UNITS, MM_CONFIG_PDA, PARLAY_QUOTE_BUFFER_PDA};
use crate::state::FillParlayQuoteIxPayload;
use spamm_aggregator::{
   helpers::verify_invoked_via_aggregator_fill_ix,
   instructions::FILL_PARLAY_IX_DISCRIMINATOR,
};
use spamm_aggregator::readers::read_u8_unchecked;
use spamm_aggregator::state::mm_account_config::MM_CONFIG_PDA_BUMP_OFFSET;
use spamm_aggregator::state::mm_parlay_quote::{MMParlayQuoteBuffer, MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR, MM_PARLAY_QUOTE_BUFFER_LEN};
use spamm_aggregator::state::MM_ACCOUNT_CONFIG_SEED;
use spamm_aggregator::writers::write_u8_unchecked;

const IS_USED_OFFSET: usize = 1;

pub use spamm_aggregator::state::FILL_QUOTE_PARLAY_IX_DISCRIMINATOR;

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      mm_config_pda,
      mm_parlay_quote_buffer,
      mm_token_account,
      liability_account,
      _mint,
      _token_program,
      instructions_sysvar,
   ] = accounts else {
      log!("fill_parlay_quote: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_invoked_via_aggregator_fill_ix(instructions_sysvar, FILL_PARLAY_IX_DISCRIMINATOR)?;

   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      log!("fill_parlay_quote: mm config pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   if unlikely(!address_eq(mm_parlay_quote_buffer.address(), &PARLAY_QUOTE_BUFFER_PDA)) {
      log!("fill_parlay_quote: parlay quote buffer invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(mm_parlay_quote_buffer.data_len() != MM_PARLAY_QUOTE_BUFFER_LEN) {
      log!("fill_parlay_quote: quote buffer len mismatch");
      return Err(ProgramError::InvalidAccountData);
   }

   let ix_data = FillParlayQuoteIxPayload::decode(data)?;

   let quote = {
      let quote_buf = mm_parlay_quote_buffer.try_borrow()?;
      MMParlayQuoteBuffer::decode(quote_buf.as_ref())?
   };

   if unlikely(quote.discriminator != MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR) {
      log!("fill_parlay_quote: buffer discriminator invalid");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(quote.is_used != 0) {
      log!("fill_parlay_quote: buffer already used");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!address_eq(&quote.user_address, user.address())) {
      log!("fill_parlay_quote: user mismatch");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(quote.odds_scaled != ix_data.odds_scaled) {
      log!("fill_parlay_quote: odds_scaled mismatch vs buffer");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(ix_data.amount_to_fill > quote.max_amount) {
      log!("fill_parlay_quote: amount_to_fill exceeds quoted max");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(quote.max_amount != MAX_QUOTE_STAKE_UNITS) {
      log!("fill_parlay_quote: buffer max_amount unexpected");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(ix_data.amount_to_fill > MAX_QUOTE_STAKE_UNITS) {
      log!("fill_parlay_quote: amount_to_fill exceeds quote max");
      return Err(ProgramError::InvalidInstructionData);
   }

   if likely(ix_data.amount_to_send > 0) {
      let config_bump = unsafe { read_u8_unchecked(mm_config_pda.data_ptr(), MM_CONFIG_PDA_BUMP_OFFSET) };
      let bump_ref = [config_bump];
      let signer_seeds = [
         Seed::from(MM_ACCOUNT_CONFIG_SEED),
         Seed::from(&bump_ref as &[u8]),
      ];
      let signers = [Signer::from(&signer_seeds)];
      Transfer::new(
         mm_token_account,
         liability_account,
         mm_config_pda,
         ix_data.amount_to_send,
      )
      .invoke_signed(&signers)?;
   }

   unsafe {
      write_u8_unchecked(mm_parlay_quote_buffer.data_mut_ptr(), IS_USED_OFFSET, 1);
   }

   Ok(())
}
