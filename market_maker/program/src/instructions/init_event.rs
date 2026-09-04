//! Create the event-state PDA: `["event_state", event_id]`. Initial `sequence = 0` with zeroed `game_state`
//! means the account exists but no operator game state has been entered yet. The operator uses
//! `update_event_state` to advance to `sequence = 1` (pregame setup, e.g. PG / 0-0), then to `sequence >= 2`
//! when the match is underway and live markets have `is_pregame == false`.
//!
//! On-chain layout: **[`EVENT_STATE_HEADER_LEN`] header** then optional MM-chosen body.
//!
//! Accounts: **(5)**
//! 0. `feepayer` (signer) — must match `MmAccountConfig::admin` on `config_pda`
//! 1. `config_pda` (readonly) — PDA `["config"]` under the MM
//! 2. `event_state_pda` (writable) — created, header + `event_body`
//! 3. `rent_sysvar` (readonly)
//! 4. `system_program` (readonly)
//!
//! Instruction `data`: `event_id` then optional `event_body` bytes.

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::Seed, cpi::Signer,
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
   mm_helpers::{find_event_state_pda, verify_mm_config_auth},
   state::InitEventIxPayload,
};
use spamm_aggregator::{
   helpers::{get_rent, verify_rent_sysvar, verify_signer, verify_system_program},
   state::{
      EVENT_STATE_DISCRIMINATOR, EVENT_STATE_HEADER_LEN, EVENT_STATE_SEED, EventGameState,
      EventStateDataZc,
   },
   writers::write_arbitrary_bytes_unchecked,
};

pub const INIT_EVENT_IX_DISCRIMINATOR: u8 = 110;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      feepayer, 
      config_pda, 
      event_state_pda, 
      rent_sysvar,
      system_program
   ] = accounts else {
      log!("init_event: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parsed = InitEventIxPayload::decode(data)?;
   let event_id = parsed.event_id;
   let event_body = parsed.event_body;

   verify_signer(feepayer)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   verify_mm_config_auth(feepayer, config_pda)?;

   if unlikely(
      event_state_pda.lamports() > 0 || event_state_pda.data_len() > 0,
   ) {
      log!("init_event: event state pda must be empty");
      return Err(ProgramError::InvalidAccountData);
   }

   let (pda, bump) = find_event_state_pda(program_id, &event_id);
   if unlikely(!address_eq(event_state_pda.address(), &pda)) {
      log!("init_event: event state pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   let body_len = event_body.len();
   let es_space = (EVENT_STATE_HEADER_LEN as u64)
      .checked_add(body_len as u64).ok_or(ProgramError::InvalidInstructionData)?;

   {
      let event_id_wire = event_id.as_wire_bytes();
      let b = [bump];
      let signers_seeds = [
         Seed::from(EVENT_STATE_SEED),
         Seed::from(event_id_wire.as_slice()),
         Seed::from(&b as &[u8]),
      ];
      let signers = [Signer::from(&signers_seeds)];

      CreateAccount {
         from: feepayer,
         to: event_state_pda,
         lamports: get_rent(rent_sysvar, es_space)?,
         space: es_space,
         owner: program_id,
      }
      .invoke_signed(&signers)?;
   }

   {
      let mut data = event_state_pda.try_borrow_mut()?;
      if unlikely(data.len() < EVENT_STATE_HEADER_LEN) {
         log!("init_event: event state data short");
         return Err(ProgramError::InvalidAccountData);
      }
      let initial = EventStateDataZc {
         discriminator: EVENT_STATE_DISCRIMINATOR,
         bump,
         event_id: event_id.to_zc(),
         sequence: 0u16.into(),
         game_state: EventGameState::zeroed().to_zc(),
      };
      unsafe {
         core::ptr::write(data.as_mut_ptr().cast::<EventStateDataZc>(), initial);
         if body_len > 0 {
            write_arbitrary_bytes_unchecked(data.as_mut_ptr(), EVENT_STATE_HEADER_LEN, event_body);
         }
      }
   }

   Ok(())
}
