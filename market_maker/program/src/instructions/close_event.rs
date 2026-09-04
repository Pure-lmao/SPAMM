//! Close the event-state PDA created in `init_event` and return rent to `auth`.
//!
//! Accounts: **(4)**
//! 0. `auth` (signer, writable) — must match `MmAccountConfig::admin` on `config_pda`
//! 1. `config_pda` (readonly)
//! 2. `event_state_pda` (writable)
//! 3. `system_program` (readonly)
//!
//! Instruction `data`: `event_id` (same as `init_event`)

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq,
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use crate::{
   mm_helpers::{find_event_state_pda, verify_mm_config_auth},
   state::decode_close_event_id,
};
use spamm_aggregator::{
   helpers::{close_pda_return_rent, verify_signer, verify_system_program},
   readers::read_u8_unchecked,
   state::{
      EVENT_STATE_DISCRIMINATOR, EVENT_STATE_DISCRIMINATOR_OFFSET, EVENT_STATE_BUMP_OFFSET,
      EVENT_STATE_HEADER_LEN,
   },
};


pub const CLOSE_EVENT_IX_DISCRIMINATOR: u8 = 112;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth,
      config_pda,
      event_state_pda,
      system_program,
   ] = accounts else {
      log!("close_event: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let event_id = decode_close_event_id(data)?;

   verify_signer(auth)?;
   verify_system_program(system_program)?;
   verify_mm_config_auth(auth, config_pda)?;

   if unlikely(!event_state_pda.owned_by(program_id)) {
      log!("close_event: event state must be owned by this program");
      return Err(ProgramError::InvalidAccountData);
   }

   let (pda, bump) = find_event_state_pda(program_id, &event_id);
   if unlikely(!address_eq(event_state_pda.address(), &pda)) {
      log!("close_event: event state pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   if unlikely(event_state_pda.data_len() < EVENT_STATE_HEADER_LEN) {
      log!("close_event: event state data length invalid");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(unsafe { read_u8_unchecked(event_state_pda.data_ptr(), EVENT_STATE_DISCRIMINATOR_OFFSET) } != EVENT_STATE_DISCRIMINATOR) {
      log!("close_event: event state discriminator invalid");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(unsafe { read_u8_unchecked(event_state_pda.data_ptr(), EVENT_STATE_BUMP_OFFSET) } != bump) {
      log!("close_event: bump mismatch");
      return Err(ProgramError::InvalidAccountData);   
   }

   close_pda_return_rent(event_state_pda, auth)
}
