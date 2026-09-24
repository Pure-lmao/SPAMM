use pinocchio::{account::AccountView, address::address_eq, error::ProgramError, hint::unlikely, Address, ProgramResult};
use pinocchio_log::log;
use zeropod::ZeroPodFixed;

use crate::checks::admin_is;
use spamm_aggregator::{
   helpers::{close_pda_return_rent, verify_signer, verify_system_program},
   state::{
      EventId, EventStateData, EVENT_STATE_DISCRIMINATOR, EVENT_STATE_HEADER_LEN, EVENT_STATE_SEED,
   },
};

pub const CLOSE_EVENT_IX_DISCRIMINATOR: u8 = 112;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let event_id = EventId::decode(data).ok_or(ProgramError::InvalidInstructionData)?;
   let [
      admin,          // `verify_signer`; `admin_is`; rent recipient
      config,         // `admin_is`
      event_state,    // `Address::derive_address`; `EventStateData` header
      system_program, // `verify_system_program`
   ] = accounts else {
      log!("close_event: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_signer(admin)?;
   verify_system_program(system_program)?;
   if unlikely(!admin_is(admin, config, program_id)) {
      log!("close_event: admin");
      return Err(ProgramError::IncorrectAuthority);
   }
   if unlikely(!address_eq(event_state.owner(), program_id)) {
      return Err(ProgramError::InvalidAccountOwner);
   }
   if unlikely(event_state.data_len() != EVENT_STATE_HEADER_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }
   let body = event_state.try_borrow()?;
   let zc = <EventStateData as ZeroPodFixed>::from_bytes(body.as_ref())
      .map_err(|_| ProgramError::InvalidAccountData)?;
   if unlikely(zc.discriminator != EVENT_STATE_DISCRIMINATOR) {
      return Err(ProgramError::InvalidAccountData);
   }
   let wire = event_id.as_wire_bytes();
   let expected = Address::derive_address(
      &[EVENT_STATE_SEED, wire.as_slice()],
      Some(zc.bump),
      program_id,
   );
   if unlikely(!address_eq(event_state.address(), &expected)) {
      return Err(ProgramError::InvalidSeeds);
   }
   let stored = EventId::from_zc(&zc.event_id).ok_or(ProgramError::InvalidAccountData)?;
   if unlikely(stored.event != event_id.event || stored.league != event_id.league || stored.sport != event_id.sport) {
      return Err(ProgramError::InvalidAccountData);
   }
   drop(body);
   close_pda_return_rent(event_state, admin)
}
