//! CPI entry used by the aggregator to fill a leg after quotes are sorted.
//! Validates MM config + quote-buffer PDAs, instruction vs buffer snapshot, transfer from MM ATA.
//!
//! Accounts **(9)** (aggregator order):
//! 0. `user`
//! 1. `mm_market_data_pda` — unused here (reserved for future market-data checks)
//! 2. `mm_config_pda`
//! 3. `mm_quote_buffer`
//! 4. `mm_token_account` — SPL authority must be the config PDA (`init_program`)
//! 5. `liability_account`
//! 6. `mint` (readonly)
//! 7. `token_program` (readonly)
//! 8. `instructions_sysvar` (readonly) — introspect parent `fill_bet`
use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError, hint::{likely, unlikely}
};
use pinocchio_log::log;
use pinocchio_token::{instructions::Transfer,};

use crate::{constants::{MM_CONFIG_PDA, QUOTE_BUFFER_PDA}, mm_helpers::check_quote_matches};
use crate::state::FillQuoteIxPayload;
use spamm_aggregator::{
   helpers::verify_invoked_via_aggregator_fill_ix,
   instructions::FILL_BET_IX_DISCRIMINATOR,
   readers::read_u8_unchecked,
   writers::write_u8_unchecked,
};
use spamm_aggregator::state::mm_account_config::MM_CONFIG_PDA_BUMP_OFFSET;
use spamm_aggregator::state::mm_quote::MM_QUOTE_BUFFER_DISCRIMINATOR;
use spamm_aggregator::state::{MM_ACCOUNT_CONFIG_SEED, MMQuoteBuffer, MM_QUOTE_BUFFER_LEN};

/// `MMQuoteBuffer::is_used` byte offset in the wire buffer (after `discriminator`).
const IS_USED_OFFSET: usize = 1;

pub use spamm_aggregator::state::FILL_QUOTE_IX_DISCRIMINATOR;

pub fn process(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      _mm_market_data_pda,
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

   verify_invoked_via_aggregator_fill_ix(instructions_sysvar, FILL_BET_IX_DISCRIMINATOR)?;

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

   if unlikely(ix_data.amount_to_fill == 0) {
      unsafe { 
         write_u8_unchecked(mm_quote_buffer.data_mut_ptr(), IS_USED_OFFSET, 1);
      }
      return Ok(());
   }

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
      MMQuoteBuffer::from_bytes(quote_buf.as_ref())?
   };
   check_quote_matches(&expected, &quote)?;
   
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

   // set quote is_used to 1
   unsafe {
      write_u8_unchecked(mm_quote_buffer.data_mut_ptr(), IS_USED_OFFSET, 1);
   }

   // The Config PDA data such as global exposure and Market Data PDA data 
   // such as skew or remaining liquidity can be updated here.
   // unsafe {
   //    let prev_global_exposure = read_u64_le_unchecked(
   //       mm_config_pda.data_ptr(), GLOBAL_EXPOSURE_OFFSET);
   //    write_u64_le_unchecked(
   //       mm_config_pda.data_mut_ptr(), GLOBAL_EXPOSURE_OFFSET, 
   //       prev_global_exposure + ix_data.amount_to_send
   //    );
   // }

   Ok(())
}
