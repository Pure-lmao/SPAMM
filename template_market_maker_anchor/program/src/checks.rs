//! Shared account checks. Quote paths treat a failed check as a zero quote.

use anchor_lang::{
   prelude::{AccountInfo, Pubkey},
   solana_program::{
      program_error::ProgramError,
      program_memory::sol_memcmp,
      pubkey::PUBKEY_BYTES,
   },
};
use zeropod::ZeroPodFixed;

use crate::constants::{AGGREGATOR_CONFIG_PDA, CONFIG_PDA, PARLAY_QUOTE_BUFFER_PDA, QUOTE_BUFFER_PDA};
use spamm_aggregator::state::{
   market_id_pda_seed_parts,
   other::{MM_MARKET_DATA_PDA_BUMP_OFFSET, MM_MARKET_DATA_PDA_MIN_LEN, MM_MARKET_DATA_PDA_SEED},
   EventGameState, EventId, EventStateData, MarketId, EVENT_STATE_DISCRIMINATOR,
   EVENT_STATE_HEADER_LEN, EVENT_STATE_SEED, MM_ACCOUNT_CONFIG_DISCRIMINATOR,
   MM_CONFIG_PDA_HEADER_LEN, MM_MARKET_DATA_PDA_DISCRIMINATOR, MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR,
   MM_PARLAY_QUOTE_BUFFER_LEN, MM_QUOTE_BUFFER_DISCRIMINATOR, MM_QUOTE_BUFFER_LEN,
};

#[inline(always)]
fn keys_eq(a: &Pubkey, b: &Pubkey) -> bool {
   sol_memcmp(a.as_ref(), b.as_ref(), PUBKEY_BYTES) == 0
}

#[inline(always)]
pub fn config_ok(config: &AccountInfo, program_id: &Pubkey) -> bool {
   keys_eq(config.key, &CONFIG_PDA)
      && keys_eq(config.owner, program_id)
      && config.data_len() == MM_CONFIG_PDA_HEADER_LEN
      && config.try_borrow_data().map(|d| d[0] == MM_ACCOUNT_CONFIG_DISCRIMINATOR).unwrap_or(false)
}

#[inline(always)]
pub fn quote_buffer_ok(buf: &AccountInfo, program_id: &Pubkey) -> bool {
   keys_eq(buf.key, &QUOTE_BUFFER_PDA)
      && keys_eq(buf.owner, program_id)
      && buf.data_len() == MM_QUOTE_BUFFER_LEN
      && buf.try_borrow_data().map(|d| d[0] == MM_QUOTE_BUFFER_DISCRIMINATOR).unwrap_or(false)
}

#[inline(always)]
pub fn parlay_buffer_ok(buf: &AccountInfo, program_id: &Pubkey) -> bool {
   keys_eq(buf.key, &PARLAY_QUOTE_BUFFER_PDA)
      && keys_eq(buf.owner, program_id)
      && buf.data_len() == MM_PARLAY_QUOTE_BUFFER_LEN
      && buf.try_borrow_data().map(|d| d[0] == MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR).unwrap_or(false)
}

#[inline(always)]
pub fn market_ok(market: &AccountInfo, program_id: &Pubkey, market_id: &MarketId) -> bool {
   if !keys_eq(market.owner, program_id) {
      return false;
   }
   if market.data_len() != MM_MARKET_DATA_PDA_MIN_LEN {
      return false;
   }
   let Ok(data) = market.try_borrow_data() else {
      return false;
   };
   if data[0] != MM_MARKET_DATA_PDA_DISCRIMINATOR {
      return false;
   }
   let bump = data[MM_MARKET_DATA_PDA_BUMP_OFFSET];
   let wire = market_id.as_bytes();
   let (body, operator) = market_id_pda_seed_parts(&wire);
   let Ok(expected) = Pubkey::create_program_address(
      &[MM_MARKET_DATA_PDA_SEED, body, operator, &[bump]],
      program_id,
   ) else {
      return false;
   };
   keys_eq(market.key, &expected)
}

#[inline(always)]
pub fn event_ok(
   event_state: &AccountInfo,
   program_id: &Pubkey,
   event_id: &EventId,
   sequence: u16,
   game_state: &EventGameState,
) -> bool {
   if !keys_eq(event_state.owner, program_id) {
      return false;
   }
   if event_state.data_len() != EVENT_STATE_HEADER_LEN {
      return false;
   }
   let Ok(data) = event_state.try_borrow_data() else {
      return false;
   };
   let Ok(zc) = <EventStateData as ZeroPodFixed>::from_bytes(&data[..EVENT_STATE_HEADER_LEN]) else {
      return false;
   };
   if zc.discriminator != EVENT_STATE_DISCRIMINATOR {
      return false;
   }
   let wire = event_id.as_wire_bytes();
   let Ok(expected) = Pubkey::create_program_address(
      &[EVENT_STATE_SEED, wire.as_slice(), &[zc.bump]],
      program_id,
   ) else {
      return false;
   };
   if !keys_eq(event_state.key, &expected) {
      return false;
   }
   let Some(stored_id) = EventId::from_zc(&zc.event_id) else {
      return false;
   };
   if stored_id.event != event_id.event
      || stored_id.league != event_id.league
      || stored_id.sport != event_id.sport
   {
      return false;
   }
   if zc.sequence.get() != sequence {
      return false;
   }
   EventGameState::from_zc(&zc.game_state) == *game_state
}

#[inline(always)]
pub fn invoked_via_aggregator(config_pda: &AccountInfo) -> Result<(), ProgramError> {
   if !keys_eq(config_pda.key, &AGGREGATOR_CONFIG_PDA) || !config_pda.is_signer {
      return Err(ProgramError::InvalidAccountOwner);
   }
   Ok(())
}
