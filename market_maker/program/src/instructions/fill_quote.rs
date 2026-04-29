//! CPI entry used by the aggregator to fill a leg after quotes are sorted.
//! Validates MM config + quote-buffer PDAs, instruction vs buffer snapshot, transfer from MM ATA.
//!
//! Accounts **(6)** (aggregator order):
//! 0. `user`
//! 1. `mm_oracle_pda` — unused here (reserved for future oracle checks)
//! 2. `mm_config_pda`
//! 3. `mm_quote_buffer`
//! 4. `mm_token_account` — SPL authority must be the config PDA (`init_program`)
//! 5. `liability_account`
use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError,
   hint::{likely, unlikely},
};
use pinocchio_log::log;
use pinocchio_token::{instructions::Transfer, state::Account as TokenAccount};
use zeropod::ZeroPodFixed;

use crate::state::FillQuoteIxPayload;
use crate::mm_helpers::{verify_mm_config_pda, verify_quote_buffer};
use spamm_aggregator::constants::ODDS_SCALE;
use spamm_aggregator::readers::read_u8_unchecked;
use spamm_aggregator::state::mm_account_config::MM_CONFIG_PDA_BUMP_OFFSET;
use spamm_aggregator::state::mm_quote::MM_QUOTE_BUFFER_DISCRIMINATOR;
use spamm_aggregator::state::{
   MM_ACCOUNT_CONFIG_SEED, MMQuoteBuffer, MM_QUOTE_BUFFER_LEN, MarketId,
};

/// `MMQuoteBuffer::is_used` byte offset in the wire buffer (after `discriminator`).
const IS_USED_OFFSET: usize = 1;

pub const FILL_QUOTE_IX_DISCRIMINATOR: u8 = 6;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let parsed = FillQuoteIxPayload::decode(data)?;

   let [
      user,
      _mm_oracle_pda,
      mm_config_pda,
      mm_quote_buffer,
      mm_token_account,
      liability_account,
   ] = accounts else {
      log!("fill_quote: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if unlikely(parsed.side != 0 && parsed.side != 1) {
      log!("fill_quote: side must be 0 or 1");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(parsed.amount_to_fill == 0) {
      log!("fill_quote: amount_to_fill must be > 0");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(parsed.event_state_sequence == 0) {
      log!("fill_quote: event_state_sequence must be > 0");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(parsed.odds_scaled == 0) {
      log!("fill_quote: odds_scaled must be > 0");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely((parsed.odds_scaled as u128) <= ODDS_SCALE) {
      log!("fill_quote: odds must exceed ODDS_SCALE for liability");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(!verify_mm_config_pda(mm_config_pda, program_id)) {
      log!("fill_quote: mm config pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   if unlikely(!verify_quote_buffer(mm_quote_buffer, program_id)) {
      log!("fill_quote: quote buffer invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   let on_chain = {
      let quote_borrow = mm_quote_buffer.try_borrow()?;
      if unlikely(quote_borrow.len() != MM_QUOTE_BUFFER_LEN) {
         log!("fill_quote: quote buffer len mismatch");
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <MMQuoteBuffer as ZeroPodFixed>::from_bytes(quote_borrow.as_ref())
         .map_err(|_| {
            log!("fill_quote: quote buffer wire invalid");
            ProgramError::InvalidAccountData
         })?;
      MMQuoteBuffer {
         discriminator: zc.discriminator,
         is_used: zc.is_used,
         user_address: zc.user_address,
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidAccountData)?,
         side: zc.side,
         max_amount: zc.max_amount.get(),
         odds_scaled: zc.odds_scaled.get(),
         event_state_hash: zc.event_state_hash,
         event_state_sequence: zc.event_state_sequence.get(),
      }
   };

   if unlikely(on_chain.discriminator != MM_QUOTE_BUFFER_DISCRIMINATOR) {
      log!("fill_quote: bad quote buffer discriminator");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(on_chain.is_used != 0) {
      log!("fill_quote: quote already used");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!address_eq(user.address(), &on_chain.user_address)) {
      log!("fill_quote: user must match buffer");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(parsed.side != on_chain.side) {
      log!("fill_quote: side must match buffer");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(!same_market_id(&parsed.market_id, &on_chain.market_id)) {
      log!("fill_quote: market_id must match buffer");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(parsed.event_state_sequence != on_chain.event_state_sequence) {
      log!("fill_quote: event state sequence must match buffer");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(parsed.event_state_hash != on_chain.event_state_hash) {
      log!("fill_quote: event_state_hash must match buffer");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(parsed.odds_scaled != on_chain.odds_scaled) {
      log!("fill_quote: odds must match buffer");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(parsed.amount_to_fill > on_chain.max_amount) {
      log!("fill_quote: amount exceeds max_amount");
      return Err(ProgramError::InvalidInstructionData);
   }

   {
      let src = TokenAccount::from_account_view(mm_token_account)?;
      if unlikely(!address_eq(src.owner(), mm_config_pda.address())) {
         log!("fill_quote: mm token authority must be config PDA");
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(src.amount() < parsed.amount_to_send) {
         log!("fill_quote: mm token balance insufficient");
         return Err(ProgramError::InsufficientFunds);
      }
      let dst = TokenAccount::from_account_view(liability_account)?;
      if unlikely(!address_eq(src.mint(), dst.mint())) {
         log!("fill_quote: liability mint must match source");
         return Err(ProgramError::InvalidAccountData);
      }
   }

   let config_bump = unsafe { read_u8_unchecked(mm_config_pda.data_ptr(), MM_CONFIG_PDA_BUMP_OFFSET) };
   let bump_ref = [config_bump];
   let signer_seeds = [
      Seed::from(MM_ACCOUNT_CONFIG_SEED),
      Seed::from(&bump_ref as &[u8]),
   ];
   let signers = [Signer::from(&signer_seeds)];

   if likely(parsed.amount_to_send > 0) {
      Transfer::new(
         mm_token_account,
         liability_account,
         mm_config_pda,
         parsed.amount_to_send,
      )
      .invoke_signed(&signers)?;
   }


   {
      let mut quote_buf = mm_quote_buffer.try_borrow_mut()?;
      if unlikely(quote_buf.len() != MM_QUOTE_BUFFER_LEN) {
         log!("fill_quote: quote buffer len mismatch (mut)");
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(quote_buf[IS_USED_OFFSET] != 0) {
         log!("fill_quote: is_used changed unexpectedly");
         return Err(ProgramError::InvalidAccountData);
      }
      quote_buf[IS_USED_OFFSET] = 1;
   }

   Ok(())
}

#[inline(always)]
fn same_market_id(a: &MarketId, b: &MarketId) -> bool {
   a.event_id.event_id == b.event_id.event_id
      && a.event_id.league == b.event_id.league
      && a.event_id.sport == b.event_id.sport
      && a.player == b.player
      && a.mkt == b.mkt
      && a.period == b.period
}
