use pinocchio::{
   account::AccountView, address::address_eq, error::ProgramError, hint::unlikely, Address, ProgramResult,
};
use pinocchio_log::log;
use zeropod::ZeroPodFixed;

use crate::checks::admin_is;
use spamm_aggregator::{
   helpers::verify_signer,
   state::{
      EventGameState, EventId, EventStateData, EVENT_STATE_BUMP_OFFSET, EVENT_STATE_DISCRIMINATOR,
      EVENT_STATE_HEADER_LEN, EVENT_STATE_SEED,
   },
};

pub const UPDATE_EVENT_STATE_IX_DISCRIMINATOR: u8 = 114;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let event_len = EventId::WIRE_SIZE;
   if unlikely(data.len() != event_len + 2 + 8) {
      log!("update_event_state: data len");
      return Err(ProgramError::InvalidInstructionData);
   }
   let event_id = EventId::decode(&data[..event_len]).ok_or(ProgramError::InvalidInstructionData)?;
   let sequence = u16::from_le_bytes([data[event_len], data[event_len + 1]]);
   let gs = <EventGameState as ZeroPodFixed>::from_bytes(&data[event_len + 2..])
      .map_err(|_| ProgramError::InvalidInstructionData)?;
   let game_state = EventGameState::from_zc(gs);

   let [
      admin,       // `verify_signer`; `admin_is`
      config,      // `admin_is`
      event_state, // `Address::derive_address`; `EventStateData` header
   ] = accounts else {
      log!("update_event_state: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_signer(admin)?;
   if unlikely(!admin_is(admin, config, program_id)) {
      log!("update_event_state: admin");
      return Err(ProgramError::IncorrectAuthority);
   }
   if unlikely(!address_eq(event_state.owner(), program_id)) {
      return Err(ProgramError::InvalidAccountOwner);
   }
   if unlikely(event_state.data_len() != EVENT_STATE_HEADER_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }

   let wire = event_id.as_wire_bytes();
   let bump = event_state.try_borrow()?[EVENT_STATE_BUMP_OFFSET];
   let expected = Address::derive_address(
      &[EVENT_STATE_SEED, wire.as_slice()],
      Some(bump),
      program_id,
   );
   if unlikely(!address_eq(event_state.address(), &expected)) {
      return Err(ProgramError::InvalidSeeds);
   }

   let mut body = event_state.try_borrow_mut()?;
   let header = <EventStateData as ZeroPodFixed>::from_bytes_mut(&mut body)
      .map_err(|_| ProgramError::InvalidAccountData)?;
   if unlikely(header.discriminator != EVENT_STATE_DISCRIMINATOR) {
      return Err(ProgramError::InvalidAccountData);
   }
   let Some(stored) = EventId::from_zc(&header.event_id) else {
      return Err(ProgramError::InvalidAccountData);
   };
   if unlikely(
      stored.event != event_id.event || stored.league != event_id.league || stored.sport != event_id.sport,
   ) {
      return Err(ProgramError::InvalidAccountData);
   }
   header.sequence = sequence.into();
   header.game_state = game_state.to_zc();
   Ok(())
}
