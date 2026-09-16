use core::result::Result;

use pinocchio::{
   account::AccountView,
   ProgramResult,
   error::ProgramError,
   hint::unlikely,
   address::{Address, address_eq},
};
use pinocchio_log::log;
use solana_define_syscall::definitions::sol_get_stack_height;
use spamm_aggregator::helpers::verify_invoked_via_aggregator;
use spamm_aggregator::readers::read_u8_unchecked;
use spamm_aggregator::state::mm_account_config::MM_CONFIG_PDA_ADMIN_OFFSET;
use spamm_aggregator::state::{
   EVENT_STATE_DISCRIMINATOR, EVENT_STATE_HEADER_LEN, EVENT_STATE_SEED, EventGameState,
   EventId, EventStateData, EventStateDataZc, MARKET_ID_LEN, MMQuoteBuffer, MarketId,
   market_id_pda_seed_parts,
};
use spamm_aggregator::state::other::{MM_MARKET_DATA_PDA_BUMP_OFFSET, MM_MARKET_DATA_PDA_MIN_LEN};
use zeropod::ZeroPodFixed;
use crate::constants::{find_config_pda, MM_MARKET_DATA_PDA_SEED};

/// Must be a CPI from the aggregator (not a top-level MM call).
/// `allowed_parent` is the aggregator instruction discriminator (`fill_bet`, etc.).
#[inline(never)]
pub fn verify_aggregator_cpi(
   instructions_sysvar: &AccountView,
   allowed_parent: &[u8],
) -> Result<(), ProgramError> {
   if unlikely(unsafe { sol_get_stack_height() } <= 1) {
      log!("verify_aggregator_cpi: must be invoked via CPI");
      return Err(ProgramError::InvalidInstructionData);
   }
   let discriminator = verify_invoked_via_aggregator(instructions_sysvar)?;
   if unlikely(!allowed_parent.iter().any(|&d| d == discriminator)) {
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(())
}

/// MM config PDA `["config"]` under `program_id`; `feepayer` must match `admin`.
#[inline(always)]
pub fn verify_mm_config_auth(
   program_id: &Address,
   feepayer: &AccountView,
   config_pda: &AccountView,
) -> Result<(), ProgramError> {
   let (expected_config, _) = find_config_pda(program_id);
   if unlikely(!address_eq(config_pda.address(), &expected_config)) {
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

   if unlikely(event_state_data.len() < EVENT_STATE_HEADER_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }

   let state = match EventStateData::from_bytes(&event_state_data[..EVENT_STATE_HEADER_LEN]) {
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

#[inline(always)]
fn market_id_wire_bytes(market_id: &MarketId) -> [u8; MarketId::WIRE_SIZE] {
   let mut market_wire = [0u8; MarketId::WIRE_SIZE];
   let zc = market_id.to_zc();
   unsafe {
      core::ptr::write(market_wire.as_mut_ptr().cast(), zc);
   }
   market_wire
}

/// Market-data PDA: `["market_data", market_id_body_wire, operator]`.
#[inline(always)]
pub fn find_market_data_pda_from_wire(program_id: &Address, market_wire: &[u8; MARKET_ID_LEN]) -> (Address, u8) {
   let (body, operator) = market_id_pda_seed_parts(market_wire);
   let seeds: [&[u8]; 3] = [MM_MARKET_DATA_PDA_SEED, body, operator];
   Address::find_program_address(&seeds, program_id)
}

#[inline(always)]
pub fn find_market_data_pda(program_id: &Address, market_id: &MarketId) -> (Address, u8) {
   let market_wire = market_id_wire_bytes(market_id);
   find_market_data_pda_from_wire(program_id, &market_wire)
}

#[inline(always)]
pub fn verify_market_data_pda(
   mm_market_data_pda: &AccountView,
   program_id: &Address,
   market_id: &MarketId,
) -> Result<(), ProgramError> {
   if unlikely(!address_eq(mm_market_data_pda.owner(), program_id)) {
      return Err(ProgramError::InvalidAccountOwner);
   }
   if unlikely(mm_market_data_pda.data_len() < MM_MARKET_DATA_PDA_MIN_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }

   let bump = unsafe {
      read_u8_unchecked(mm_market_data_pda.data_ptr(), MM_MARKET_DATA_PDA_BUMP_OFFSET)
   };

   let market_wire = market_id_wire_bytes(market_id);
   let (body, operator) = market_id_pda_seed_parts(&market_wire);
   let expected_pda = Address::derive_address(
      &[MM_MARKET_DATA_PDA_SEED, body, operator],
      Some(bump),
      program_id,
   );
   if unlikely(!address_eq(mm_market_data_pda.address(), &expected_pda)) {
      return Err(ProgramError::InvalidSeeds);
   }

   Ok(())
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
      return false;
   }

   let event_state_data = match event_state_pda.try_borrow() {
      Ok(data) => data,
      Err(_) => return false,
   };

   if unlikely(event_state_data.len() < EVENT_STATE_HEADER_LEN) {
      return false;
   }

   let state = match EventStateData::from_bytes(&event_state_data[..EVENT_STATE_HEADER_LEN]) {
      Ok(s) => s,
      Err(_) => return false,
   };
   if unlikely(state.discriminator != EVENT_STATE_DISCRIMINATOR) {
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
      return false;
   }

   if unlikely(state.sequence.get() != event_state_sequence) {
      return false;
   }

   let state_game_state = EventGameState::from_zc(&state.game_state);
   if unlikely(state_game_state.as_u64() != event_game_state.as_u64()) {
      return false;
   }

   if unlikely(state.event_id.event != event_id.event
      || state.event_id.league != event_id.league
      || state.event_id.sport != event_id.sport)
   {
      return false;
   }

   true
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

/// Full SPAMM zeropod ix wire after `lib.rs` strips the router discriminator (byte 0 of CPI data).
#[inline(always)]
pub fn spamm_ix_wire<const WIRE_LEN: usize>(
   discriminator: u8,
   data_after_router: &[u8],
) -> Result<[u8; WIRE_LEN], ProgramError> {
   if data_after_router.len() != WIRE_LEN - 1 {
      return Err(ProgramError::InvalidInstructionData);
   }
   let mut wire = [0u8; WIRE_LEN];
   wire[0] = discriminator;
   wire[1..].copy_from_slice(data_after_router);
   Ok(wire)
}
