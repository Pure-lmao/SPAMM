//! CPI fill for promo MM: transfer collateral and record bettor address (one bet per user).
//!
//! Accounts **(10)** (aggregator order):
//! 0. `user`
//! 1. `mm_market_data_pda` (writable)
//! 2. `mm_event_state_pda` (writable; unused here — tail may be written on fill)
//! 3. `mm_config_pda`
//! 4. `mm_quote_buffer`
//! 5. `mm_token_account`
//! 6. `liability_account`
//! 7. `mint` (readonly)
//! 8. `token_program` (readonly)
//! 9. `instructions_sysvar` (readonly)
use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError, hint::{likely, unlikely}
};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::{
   constants::{find_config_pda, find_quote_buffer_pda, PROMO_MKT, PROMO_SIDE},
   mm_helpers::{check_quote_matches, spamm_ix_wire, verify_aggregator_cpi, verify_market_data_pda},
};
use spamm_aggregator::instructions::{FILL_BET_IX_DISCRIMINATOR, FREEBET_FILL_BET_IX_DISCRIMINATOR};
use spamm_aggregator::{state::FillQuoteIxData};
use spamm_aggregator::state::mm_account_config::MM_CONFIG_PDA_BUMP_OFFSET;
use spamm_aggregator::state::mm_quote::MM_QUOTE_BUFFER_DISCRIMINATOR;
use spamm_aggregator::state::{MM_ACCOUNT_CONFIG_SEED, MMQuoteBuffer, MM_QUOTE_BUFFER_LEN};
use crate::state::account_oracle::{ORACLE_SIZE, add_bettor_and_stake, has_allowed, has_bettor, read_max_total_amount, read_total_stake_amount};

const IS_USED_OFFSET: usize = 1;

pub use spamm_aggregator::state::FILL_QUOTE_IX_DISCRIMINATOR;

#[inline(never)]
pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      mm_market_data_pda,
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

   verify_aggregator_cpi(
      instructions_sysvar,
      &[FILL_BET_IX_DISCRIMINATOR, FREEBET_FILL_BET_IX_DISCRIMINATOR],
   )?;

   let (expected_config, _) = find_config_pda(program_id);
   if unlikely(!address_eq(mm_config_pda.address(), &expected_config)) {
      log!("fill_quote: mm config pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   let (expected_buffer, _) = find_quote_buffer_pda(program_id);
   if unlikely(!address_eq(mm_quote_buffer.address(), &expected_buffer)) {
      log!("fill_quote: quote buffer invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(mm_quote_buffer.data_len() != MM_QUOTE_BUFFER_LEN) {
      log!("fill_quote: quote buffer len mismatch");
      return Err(ProgramError::InvalidAccountData);
   }

   let wire = spamm_ix_wire::<{ FillQuoteIxData::WIRE_LEN }>(FILL_QUOTE_IX_DISCRIMINATOR, data)?;
   let parsed = FillQuoteIxData::decode(&wire)?;

   verify_market_data_pda(mm_market_data_pda, program_id, &parsed.market_id)?;

   if unlikely(parsed.market_id.mkt != PROMO_MKT) {
      log!("fill_quote: promo markets require mkt 9");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(parsed.side != PROMO_SIDE) {
      log!("fill_quote: promo markets only accept side 0");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(parsed.amount_to_fill == 0) {
      unsafe {
         spamm_aggregator::writers::write_u8_unchecked(mm_quote_buffer.data_mut_ptr(), IS_USED_OFFSET, 1);
      }
      return Ok(());
   }

   let expected = MMQuoteBuffer {
      discriminator: MM_QUOTE_BUFFER_DISCRIMINATOR,
      is_used: 0,
      user_address: *user.address(),
      market_id: parsed.market_id,
      side: parsed.side,
      max_amount: parsed.amount_to_fill,
      odds_scaled: parsed.odds_scaled,
      event_game_state: parsed.event_game_state,
      event_state_sequence: parsed.event_state_sequence,
   };
   let quote = {
      let quote_buf = mm_quote_buffer.try_borrow()?;
      MMQuoteBuffer::decode(quote_buf.as_ref())?
   };
   check_quote_matches(&expected, &quote)?;

   if unlikely(mm_market_data_pda.data_len() != ORACLE_SIZE as usize) {
      return Err(ProgramError::InvalidAccountData);
   }

   let oracle_ptr = mm_market_data_pda.data_ptr();
   unsafe {
      if !has_allowed(oracle_ptr, user.address()) {
         log!("fill_quote: user not on allowlist");
         return Err(ProgramError::InvalidAccountData);
      }
      if has_bettor(oracle_ptr, user.address()) {
         log!("fill_quote: user already bet");
         return Err(ProgramError::InvalidAccountData);
      }
      let total = read_total_stake_amount(oracle_ptr);
      let max_total = read_max_total_amount(oracle_ptr);
      if max_total == 0 || total.saturating_add(parsed.amount_to_fill) > max_total {
         log!("fill_quote: would exceed max_total_amount");
         return Err(ProgramError::InvalidAccountData);
      }
   }

   if likely(parsed.amount_to_send > 0) {
      let config_bump = unsafe {
         spamm_aggregator::readers::read_u8_unchecked(mm_config_pda.data_ptr(), MM_CONFIG_PDA_BUMP_OFFSET)
      };
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
         parsed.amount_to_send,
      )
      .invoke_signed(&signers)?;
   }

   unsafe {
      spamm_aggregator::writers::write_u8_unchecked(mm_quote_buffer.data_mut_ptr(), IS_USED_OFFSET, 1);
   }

   unsafe {
      add_bettor_and_stake(
         mm_market_data_pda.data_mut_ptr(),
         user.address(),
         parsed.amount_to_fill,
      )
      .map_err(|_| ProgramError::InvalidAccountData)?;
   }

   Ok(())
}
