//! Shared account checks. Quote paths treat a failed check as a zero quote.
//! Fill paths return the error.

use pinocchio::{
   account::AccountView,
   address::{Address, address_eq},
   error::ProgramError,
   hint::unlikely,
};
use zeropod::ZeroPodFixed;

use crate::constants::{CONFIG_PDA, PARLAY_QUOTE_BUFFER_PDA, QUOTE_BUFFER_PDA};
use spamm_aggregator::{
   helpers::{verify_mint, verify_token_program},
   readers::{read_address_ref_unchecked, read_u8_unchecked},
   state::{
      market_id_pda_seed_parts, mm_account_config::MM_CONFIG_PDA_ADMIN_OFFSET, other::{
         MM_MARKET_DATA_PDA_BUMP_OFFSET, MM_MARKET_DATA_PDA_MIN_LEN, MM_MARKET_DATA_PDA_SEED,
      }, EventGameState, EventId, EventStateData, MarketId, EVENT_STATE_DISCRIMINATOR,
      EVENT_STATE_HEADER_LEN, EVENT_STATE_SEED, MM_ACCOUNT_CONFIG_DISCRIMINATOR,
      MM_CONFIG_PDA_HEADER_LEN, MM_MARKET_DATA_PDA_DISCRIMINATOR, MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR,
      MM_PARLAY_QUOTE_BUFFER_LEN, MM_QUOTE_BUFFER_DISCRIMINATOR, MM_QUOTE_BUFFER_LEN,
   },
};

const TOKEN_ACCOUNT_LEN: usize = 165;
const TOKEN_ACCOUNT_OWNER_OFFSET: usize = 32;

#[inline(always)]
pub fn config_ok(config: &AccountView, program_id: &Address) -> bool {
   address_eq(config.address(), &CONFIG_PDA)
      && address_eq(config.owner(), program_id)
      && config.data_len() == MM_CONFIG_PDA_HEADER_LEN
      && unsafe { read_u8_unchecked(config.data_ptr(), 0) } == MM_ACCOUNT_CONFIG_DISCRIMINATOR
}

#[inline(always)]
pub fn quote_buffer_ok(buf: &AccountView, program_id: &Address) -> bool {
   address_eq(buf.address(), &QUOTE_BUFFER_PDA)
      && address_eq(buf.owner(), program_id)
      && buf.data_len() == MM_QUOTE_BUFFER_LEN
      && unsafe { read_u8_unchecked(buf.data_ptr(), 0) } == MM_QUOTE_BUFFER_DISCRIMINATOR
}

#[inline(always)]
pub fn parlay_buffer_ok(buf: &AccountView, program_id: &Address) -> bool {
   address_eq(buf.address(), &PARLAY_QUOTE_BUFFER_PDA)
      && address_eq(buf.owner(), program_id)
      && buf.data_len() == MM_PARLAY_QUOTE_BUFFER_LEN
      && unsafe { read_u8_unchecked(buf.data_ptr(), 0) } == MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR
}

#[inline(always)]
pub fn admin_is(admin: &AccountView, config: &AccountView, program_id: &Address) -> bool {
   if unlikely(!config_ok(config, program_id)) {
      return false;
   }
   let stored = unsafe {
      read_address_ref_unchecked(config.data_ptr(), MM_CONFIG_PDA_ADMIN_OFFSET)
   };
   address_eq(admin.address(), stored)
}

#[inline(always)]
pub fn market_ok(market: &AccountView, program_id: &Address, market_id: &MarketId) -> bool {
   if unlikely(!address_eq(market.owner(), program_id)) {
      return false;
   }
   if unlikely(market.data_len() != MM_MARKET_DATA_PDA_MIN_LEN) {
      return false;
   }
   if unlikely(
      unsafe { read_u8_unchecked(market.data_ptr(), 0) } != MM_MARKET_DATA_PDA_DISCRIMINATOR,
   ) {
      return false;
   }
   let bump = unsafe { read_u8_unchecked(market.data_ptr(), MM_MARKET_DATA_PDA_BUMP_OFFSET) };
   let wire = market_id.as_bytes();
   let (body, operator) = market_id_pda_seed_parts(&wire);
   let expected = Address::derive_address(
      &[MM_MARKET_DATA_PDA_SEED, body, operator],
      Some(bump),
      program_id,
   );
   address_eq(market.address(), &expected)
}

#[inline(always)]
pub fn event_ok(
   event_state: &AccountView,
   program_id: &Address,
   event_id: &EventId,
   sequence: u16,
   game_state: &EventGameState,
) -> bool {
   if unlikely(!address_eq(event_state.owner(), program_id)) {
      return false;
   }
   if unlikely(event_state.data_len() != EVENT_STATE_HEADER_LEN) {
      return false;
   }
   let data = match event_state.try_borrow() {
      Ok(d) => d,
      Err(_) => return false,
   };
   let zc = match <EventStateData as ZeroPodFixed>::from_bytes(&data[..EVENT_STATE_HEADER_LEN]) {
      Ok(z) => z,
      Err(_) => return false,
   };
   if unlikely(zc.discriminator != EVENT_STATE_DISCRIMINATOR) {
      return false;
   }
   let wire = event_id.as_wire_bytes();
   let expected = Address::derive_address(
      &[EVENT_STATE_SEED, wire.as_slice()],
      Some(zc.bump),
      program_id,
   );
   if unlikely(!address_eq(event_state.address(), &expected)) {
      return false;
   }
   let Some(stored_id) = EventId::from_zc(&zc.event_id) else {
      return false;
   };
   if unlikely(
      stored_id.event != event_id.event
         || stored_id.league != event_id.league
         || stored_id.sport != event_id.sport,
   ) {
      return false;
   }
   if unlikely(zc.sequence.get() != sequence) {
      return false;
   }
   EventGameState::from_zc(&zc.game_state) == *game_state
}

#[inline(always)]
pub fn token_account(
   token: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   owner: Option<&Address>,
) -> Result<(), ProgramError> {
   verify_mint(mint)?;
   verify_token_program(token_program)?;
   if unlikely(!address_eq(token.owner(), token_program.address())) {
      return Err(ProgramError::InvalidAccountOwner);
   }
   if unlikely(token.data_len() != TOKEN_ACCOUNT_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }
   let token_mint = unsafe { read_address_ref_unchecked(token.data_ptr(), 0) };
   if unlikely(!address_eq(token_mint, mint.address())) {
      return Err(ProgramError::InvalidAccountData);
   }
   if let Some(owner) = owner {
      let token_owner = unsafe { read_address_ref_unchecked(token.data_ptr(), TOKEN_ACCOUNT_OWNER_OFFSET) };
      if unlikely(!address_eq(token_owner, owner)) {
         return Err(ProgramError::IncorrectAuthority);
      }
   }
   Ok(())
}

#[inline(always)]
pub fn collateral_owner() -> &'static Address {
   &CONFIG_PDA
}