use core::result::Result;

use pinocchio::{
   ProgramResult,
   account::AccountView,
   address::{Address, address_eq},
   error::ProgramError,
   hint::unlikely,
};
use pinocchio_log::log;
use zeropod::ZeroPodFixed;

use crate::constants::{MM_CONFIG_PDA, MM_MARKET_DATA_PDA_SEED};
use spamm_aggregator::{
   readers::read_u8_unchecked,
   state::{
      EVENT_STATE_DISCRIMINATOR, EVENT_STATE_HEADER_LEN, EVENT_STATE_SEED, EventGameState, EventId,
      EventStateData, EventStateDataZc, MMQuoteBuffer, MarketId, MARKET_ID_LEN, market_id_pda_seed_parts,
      mm_account_config::MM_CONFIG_PDA_ADMIN_OFFSET,
      other::{MM_MARKET_DATA_PDA_BUMP_OFFSET, MM_MARKET_DATA_PDA_MIN_LEN},
   },
};

/// MM config PDA `["config"]` under `program_id`; `feepayer` must match `admin`.
#[inline(always)]
pub fn verify_mm_config_auth(
   feepayer: &AccountView,
   config_pda: &AccountView,
) -> Result<(), ProgramError> {
   if unlikely(!address_eq(config_pda.address(), &MM_CONFIG_PDA)) {
      return Err(ProgramError::InvalidSeeds);
   }

   let stored_admin = unsafe {
      *(config_pda.data_ptr().add(MM_CONFIG_PDA_ADMIN_OFFSET) as *const Address)
   };

   if unlikely(!address_eq(feepayer.address(), &stored_admin)) {
      return Err(ProgramError::InvalidInstructionData);
   }

   Ok(())
}

#[inline(always)]
pub fn find_event_state_pda(program_id: &Address, event_id: &EventId) -> (Address, u8) {
   let event_id_wire = event_id.as_wire_bytes();
   let seeds: [&[u8]; 2] = [EVENT_STATE_SEED, event_id_wire.as_slice()];
   Address::find_program_address(&seeds, program_id)
}

#[inline(always)]
fn verify_event_state_core(
   event_state_pda: &AccountView,
   program_id: &Address,
   event_id: &EventId,
   event_game_state: Option<&EventGameState>,
   event_state_sequence: Option<u16>,
   throw_on_fail: bool,
) -> Result<Option<EventStateDataZc>, ProgramError> {
   if unlikely(!address_eq(event_state_pda.owner(), program_id)) {
      if throw_on_fail {
         return Err(ProgramError::InvalidAccountOwner);
      }
      log!("verify_event_state: wrong owner");
      return Ok(None);
   }

   let event_state_data = match event_state_pda.try_borrow() {
      Ok(data) => data,
      Err(_) => {
         if throw_on_fail {
            return Err(ProgramError::InvalidAccountData);
         }
         log!("verify_event_state: borrow failed");
         return Ok(None);
      }
   };

   if unlikely(event_state_data.len() < EVENT_STATE_HEADER_LEN) {
      if throw_on_fail {
         return Err(ProgramError::InvalidAccountData);
      }
      log!(
         "verify_event_state: len got {} want>={}",
         event_state_data.len(),
         EVENT_STATE_HEADER_LEN
      );
      return Ok(None);
   }

   let state = match EventStateData::from_bytes(&event_state_data[..EVENT_STATE_HEADER_LEN]) {
      Ok(s) => s,
      Err(_) => {
         if throw_on_fail {
            return Err(ProgramError::InvalidAccountData);
         }
         log!("verify_event_state: from_bytes failed");
         return Ok(None);
      }
   };

   if unlikely(state.discriminator != EVENT_STATE_DISCRIMINATOR) {
      if throw_on_fail {
         return Err(ProgramError::InvalidAccountData);
      }
      log!("verify_event_state: bad disc got {}", state.discriminator);
      return Ok(None);
   }

   let event_id_wire = event_id.as_wire_bytes();
   let expected_pda = Address::derive_address(
      &[EVENT_STATE_SEED, event_id_wire.as_slice()],
      Some(state.bump),
      program_id,
   );

   if unlikely(!address_eq(event_state_pda.address(), &expected_pda)) {
      if throw_on_fail {
         return Err(ProgramError::InvalidSeeds);
      }
      log!("verify_event_state: pda mismatch");
      return Ok(None);
   }

   let wire_event_id = match EventId::from_zc(&state.event_id) {
      Some(id) => id,
      None => {
         if throw_on_fail {
            return Err(ProgramError::InvalidAccountData);
         }
         log!("verify_event_state: event_id decode failed");
         return Ok(None);
      }
   };
   if unlikely(
      wire_event_id.event != event_id.event
         || wire_event_id.league != event_id.league
         || wire_event_id.sport != event_id.sport,
   ) {
      if throw_on_fail {
         return Err(ProgramError::InvalidAccountData);
      }
      log!("verify_event_state: event_id mismatch");
      return Ok(None);
   }

   if let Some(seq) = event_state_sequence {
      if unlikely(state.sequence.get() != seq) {
         if throw_on_fail {
            return Err(ProgramError::InvalidAccountData);
         }
         log!(
            "verify_event_state: seq on_chain {} want {}",
            state.sequence.get(),
            seq
         );
         return Ok(None);
      }
   }

   if let Some(game_state) = event_game_state {
      if unlikely(EventGameState::from_zc(&state.game_state) != *game_state) {
         if throw_on_fail {
            return Err(ProgramError::InvalidAccountData);
         }
         let on_chain = EventGameState::from_zc(&state.game_state);
         log!(
            "verify_event_state: game_state mismatch on_chain_u64 {} want_u64 {}",
            on_chain.as_u64(),
            game_state.as_u64()
         );
         return Ok(None);
      }
   }

   Ok(Some(*state))
}

#[inline(always)]
pub fn verify_event_state_pda(
   event_state_pda: &AccountView,
   program_id: &Address,
   event_id: &EventId,
) -> Result<EventStateDataZc, ProgramError> {
   verify_event_state_core(event_state_pda, program_id, event_id, None, None, true)?
      .ok_or(ProgramError::InvalidAccountData)
}

/// Event state PDA `["event_state", event_id]`, plus sequence and game state.
#[inline(always)]
pub fn verify_event_state(
   event_state_pda: &AccountView,
   program_id: &Address,
   event_id: &EventId,
   event_game_state: &EventGameState,
   event_state_sequence: u16,
) -> bool {
   verify_event_state_core(
      event_state_pda,
      program_id,
      event_id,
      Some(event_game_state),
      Some(event_state_sequence),
      false,
   )
   .ok()
   .flatten()
   .is_some()
}

#[inline(always)]
fn market_id_wire_bytes(market_id: &MarketId) -> [u8; MarketId::WIRE_SIZE] {
   let mut market_wire = [0u8; MarketId::WIRE_SIZE];
   let zc = market_id.to_zc();
   unsafe {
      core::ptr::write(market_wire.as_mut_ptr().cast(), zc);
   }
   market_wire
}

/// Market-data PDA: `["market_data", market_id_body_wire, operator]` (`MarketId` body = legacy wire without operator).
#[inline(always)]
pub fn find_market_data_pda_from_wire(program_id: &Address, market_wire: &[u8; MARKET_ID_LEN]) -> (Address, u8) {
   let (body, operator) = market_id_pda_seed_parts(market_wire);
   let seeds: [&[u8]; 3] = [MM_MARKET_DATA_PDA_SEED, body, operator];
   Address::find_program_address(&seeds, program_id)
}

/// Market-data PDA: `["market_data", market_id_body_wire, operator]` (`MarketId` body = legacy wire without operator).
#[inline(always)]
pub fn find_market_data_pda(program_id: &Address, market_id: &MarketId) -> (Address, u8) {
   let market_wire = market_id_wire_bytes(market_id);
   find_market_data_pda_from_wire(program_id, &market_wire)
}

#[inline(always)]
pub fn mm_market_data_pda_ok(market_data: &AccountView, program_id: &Address, market_id: &MarketId) -> bool {
   if unlikely(!address_eq(market_data.owner(), program_id)) {
      return false;
   }
   if unlikely(market_data.data_len() < MM_MARKET_DATA_PDA_MIN_LEN) {
      return false;
   }
   let bump = unsafe { read_u8_unchecked(market_data.data_ptr(), MM_MARKET_DATA_PDA_BUMP_OFFSET) };
   let market_wire = market_id_wire_bytes(market_id);
   let (body, operator) = market_id_pda_seed_parts(&market_wire);
   let expected = Address::derive_address(
      &[MM_MARKET_DATA_PDA_SEED, body, operator],
      Some(bump),
      program_id,
   );
   address_eq(market_data.address(), &expected)
}

#[inline(always)]
pub fn check_quote_matches(
   expected: &MMQuoteBuffer,
   account: &MMQuoteBuffer,
   check_odds: bool,
) -> ProgramResult {
   if unlikely(account.is_used != 0) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!address_eq(&expected.user_address, &account.user_address)) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(!expected.market_id.eq(&account.market_id)) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(expected.side != account.side) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(expected.max_amount > account.max_amount) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if check_odds {
      if unlikely(expected.odds_scaled != account.odds_scaled) {
         return Err(ProgramError::InvalidInstructionData);
      }
   }
   if unlikely(expected.event_game_state != account.event_game_state) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(expected.event_state_sequence != account.event_state_sequence) {
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(())
}
