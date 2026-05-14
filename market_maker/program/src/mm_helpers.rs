use core::result::Result;

use pinocchio::account::AccountView;
use pinocchio::address::{Address, address_eq};
use pinocchio::error::ProgramError;
use pinocchio::hint::unlikely;
use pinocchio::ProgramResult;
use pinocchio_log::log;
use spamm_aggregator::state::mm_account_config::{
   MM_CONFIG_PDA_ADMIN_OFFSET,
};
use spamm_aggregator::state::{
   EVENT_STATE_DISCRIMINATOR, EVENT_STATE_LEN, EVENT_STATE_SEED, EventGameState, EventId, EventStateData, EventStateDataZc, MMQuoteBuffer, MarketId
};
use zeropod::ZeroPodFixed;

use crate::constants::{MM_CONFIG_PDA, MM_MARKET_DATA_PDA_SEED};

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
pub fn verify_event_state_pda(
   event_state_pda: &AccountView,
   program_id: &Address,
   event_id: &EventId,
) -> Result<EventStateDataZc, ProgramError> {
   if unlikely(!address_eq(event_state_pda.owner(), program_id)) {
      return Err(ProgramError::InvalidAccountOwner);
   }

   let event_state_data = match event_state_pda.try_borrow() {
      Ok(data) => data,
      Err(_) => return Err(ProgramError::InvalidAccountData),
   };

   if unlikely(event_state_data.len() != EVENT_STATE_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }

   let state = match EventStateData::from_bytes(&event_state_data) {
      Ok(s) => s,
      Err(_) => return Err(ProgramError::InvalidAccountData),
   };

   if unlikely(state.discriminator != EVENT_STATE_DISCRIMINATOR) {
      return Err(ProgramError::InvalidAccountData);
   }

   let event_id_wire = event_id.as_wire_bytes();
   let expected_pda = Address::derive_address(
      &[EVENT_STATE_SEED, event_id_wire.as_slice()],
      Some(state.bump),
      program_id,
   );

   if unlikely(!address_eq(event_state_pda.address(), &expected_pda)) {
      return Err(ProgramError::InvalidSeeds);
   }

   let wire_event_id = EventId::from_zc(&state.event_id).ok_or(ProgramError::InvalidAccountData)?;
   if unlikely(
      wire_event_id.event != event_id.event
         || wire_event_id.league != event_id.league
         || wire_event_id.sport != event_id.sport,
   ) {
      return Err(ProgramError::InvalidAccountData);
   }

   Ok(*state)
}

/// Market-data PDA: `["market_data", market_id_wire]`, with `MarketId` wire bytes from `to_zc` (see `get_quote`).
#[inline(always)]
pub fn find_market_data_pda(program_id: &Address, market_id: &MarketId) -> (Address, u8) {
   let mut market_wire = [0u8; MarketId::WIRE_SIZE];
   let zc = market_id.to_zc();
   unsafe {
      core::ptr::write(market_wire.as_mut_ptr().cast(), zc);
   }
   let seeds: [&[u8]; 2] = [MM_MARKET_DATA_PDA_SEED, market_wire.as_slice()];
   Address::find_program_address(&seeds, program_id)
}

#[inline(always)]
pub fn mm_market_data_pda_ok(market_data: &AccountView, program_id: &Address, market_id: &MarketId) -> bool {
   if unlikely(!address_eq(market_data.owner(), program_id)) {
      return false;
   }
   let (expected, _) = find_market_data_pda(program_id, market_id);
   address_eq(market_data.address(), &expected)
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
   if unlikely(!address_eq(event_state_pda.owner(), program_id)) {
      log!("verify_event_state: wrong owner");
      return false;
   }

   let event_state_data = match event_state_pda.try_borrow() {
      Ok(data) => data,
      Err(_) => {
         log!("verify_event_state: borrow failed");
         return false;
      }
   };

   if unlikely(event_state_data.len() != EVENT_STATE_LEN) {
      log!(
         "verify_event_state: len got {} want {}",
         event_state_data.len(),
         EVENT_STATE_LEN
      );
      return false;
   }

   let state = match EventStateData::from_bytes(&event_state_data) {
      Ok(s) => s,
      Err(_) => {
         log!("verify_event_state: from_bytes failed");
         return false;
      }
   };
   if unlikely(state.discriminator != EVENT_STATE_DISCRIMINATOR) {
      log!("verify_event_state: bad disc got {}", state.discriminator);
      return false;
   }

   let event_id_wire = event_id.as_wire_bytes();
   let seeds = [EVENT_STATE_SEED, event_id_wire.as_slice()];
   let expected_pda = Address::derive_address(
      &seeds,
      Some(state.bump),
      program_id
   );
   if unlikely(!address_eq(event_state_pda.address(), &expected_pda)) {
      log!("verify_event_state: pda mismatch");
      return false;
   }

   if unlikely(state.sequence.get() != event_state_sequence) {
      log!(
         "verify_event_state: seq on_chain {} want {}",
         state.sequence.get(),
         event_state_sequence
      );
      return false;
   }

   if unlikely(EventGameState::from_zc(&state.game_state) != *event_game_state) {
      let on_chain = EventGameState::from_zc(&state.game_state);
      log!(
         "verify_event_state: game_state mismatch on_chain_u64 {} want_u64 {}",
         on_chain.as_u64(),
         event_game_state.as_u64()
      );
      return false;
   }

   if unlikely(state.event_id.event != event_id.event
      || state.event_id.league != event_id.league
      || state.event_id.sport != event_id.sport)
   {
      log!("verify_event_state: event_id mismatch");
      return false;
   }

   true
}

/// Transfers all lamports from `pda` to `recipient` (PDA signs with `signers`), then closes `pda`.
#[inline(never)]
pub fn close_pda_return_rent(
   pda: &mut AccountView,
   recipient: &mut AccountView,
) -> ProgramResult {
   let dest_lamports = recipient.lamports();
   let pda_lamports = pda.lamports();

   pda.set_lamports(0);
   recipient.set_lamports(dest_lamports + pda_lamports);
   pda.close()
}

#[inline(always)]
pub fn check_quote_matches(expected: &MMQuoteBuffer, account: &MMQuoteBuffer) -> ProgramResult {
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
   if unlikely(expected.odds_scaled != account.odds_scaled) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(expected.event_game_state != account.event_game_state) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(expected.event_state_sequence != account.event_state_sequence) {
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(())
}