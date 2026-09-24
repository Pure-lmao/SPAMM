use pinocchio::{
   account::AccountView, address::address_eq, cpi::{Seed, Signer}, error::ProgramError, hint::unlikely,
   Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use zeropod::ZeroPodFixed;

use crate::checks::admin_is;
use spamm_aggregator::{
   helpers::{get_rent, verify_rent_sysvar, verify_signer, verify_system_program},
   state::{
      EventGameState, EventId, EventStateData, EventStateDataZc, EVENT_STATE_DISCRIMINATOR,
      EVENT_STATE_HEADER_LEN, EVENT_STATE_SEED,
   },
};

pub const INIT_EVENT_IX_DISCRIMINATOR: u8 = 110;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let event_id = EventId::decode(data).ok_or(ProgramError::InvalidInstructionData)?;
   let [
      feepayer,       // `verify_signer`; `admin_is`
      config,         // `admin_is`
      event_state,    // `Address::find_program_address`; empty
      rent_sysvar,    // `verify_rent_sysvar`
      system_program, // `verify_system_program`
   ] = accounts else {
      log!("init_event: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_signer(feepayer)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   if unlikely(!admin_is(feepayer, config, program_id)) {
      log!("init_event: admin");
      return Err(ProgramError::IncorrectAuthority);
   }
   if unlikely(event_state.lamports() > 0 || event_state.data_len() > 0) {
      log!("init_event: account must be empty");
      return Err(ProgramError::InvalidAccountData);
   }

   let wire = event_id.as_wire_bytes();
   let (pda, bump) = Address::find_program_address(&[EVENT_STATE_SEED, wire.as_slice()], program_id);
   if unlikely(!address_eq(event_state.address(), &pda)) {
      return Err(ProgramError::InvalidSeeds);
   }

   let space = EVENT_STATE_HEADER_LEN as u64;
   let bump_seed = [bump];
   let signer_seeds = [
      Seed::from(EVENT_STATE_SEED),
      Seed::from(wire.as_slice()),
      Seed::from(&bump_seed as &[u8]),
   ];
   let signers = [Signer::from(&signer_seeds)];
   CreateAccount {
      from: feepayer,
      to: event_state,
      lamports: get_rent(rent_sysvar, space)?,
      space,
      owner: program_id,
   }
   .invoke_signed(&signers)?;

   let mut body = event_state.try_borrow_mut()?;
   let header = <EventStateData as ZeroPodFixed>::from_bytes_mut(&mut body)
      .map_err(|_| ProgramError::InvalidAccountData)?;
   *header = EventStateDataZc {
      discriminator: EVENT_STATE_DISCRIMINATOR,
      bump,
      event_id: event_id.to_zc(),
      sequence: 0u16.into(),
      game_state: EventGameState::zeroed().to_zc(),
   };
   Ok(())
}
