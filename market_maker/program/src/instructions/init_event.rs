//! Create the event-state PDA: `["event_state", event_id]`. Initial `sequence = 1`, `state_hash = 0`,
//! matching the SPAMM README (first sporting sequence consumers must observe before quoting live odds).//!
//! Accounts: **(4)**
//! 0. `feepayer` (signer) — must match `MmAccountConfig::admin` on `config_pda`
//! 1. `config_pda` (readonly) — PDA `["config"]` under the MM
//! 2. `event_state_pda` (writable) — created, [`EVENT_STATE_LEN`] bytes
//! 3. `system_program` (readonly)
//!
//! Instruction `data`: `event_id`

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::Seed, cpi::Signer,
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use spamm_aggregator::helpers::get_rent_local;
use spamm_aggregator::helpers::{verify_signer, verify_system_program};
use spamm_aggregator::state::{
   EventStateDataZc, EVENT_STATE_DISCRIMINATOR, EVENT_STATE_LEN, EVENT_STATE_SEED,
};

use crate::mm_helpers::{find_event_state_pda, verify_mm_config_auth};

use crate::state::InitEventIxPayload;

pub const INIT_EVENT_IX_DISCRIMINATOR: u8 = 7;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      feepayer, 
      config_pda, 
      event_state_pda, 
      system_program
   ] = accounts else {
      log!("init_event: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parsed = InitEventIxPayload::decode(data)?;
   let event_id = parsed.event_id;

   verify_signer(feepayer)?;
   verify_system_program(system_program)?;
   verify_mm_config_auth(feepayer, config_pda, program_id)?;

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

   {
      let event_id_wire = event_id.as_wire_bytes();
      let b = [bump];
      let signers_seeds = [
         Seed::from(EVENT_STATE_SEED),
         Seed::from(event_id_wire.as_slice()),
         Seed::from(&b as &[u8]),
      ];
      let signers = [Signer::from(&signers_seeds)];

      let es_space = EVENT_STATE_LEN as u64;
      CreateAccount {
         from: feepayer,
         to: event_state_pda,
         lamports: get_rent_local(es_space),
         space: es_space,
         owner: program_id,
      }
      .invoke_signed(&signers)?;
   }

   {
      let mut data = event_state_pda.try_borrow_mut()?;
      if unlikely(data.len() < EVENT_STATE_LEN) {
         log!("init_event: event state data short");
         return Err(ProgramError::InvalidAccountData);
      }
      let initial = EventStateDataZc {
         discriminator: EVENT_STATE_DISCRIMINATOR,
         bump,
         event_id: event_id.to_zc(),
         sequence: 1u16.into(),
         state_hash: [0u8; 32],
      };
      unsafe {
         core::ptr::write(
            data.as_mut_ptr().cast::<EventStateDataZc>(),
            initial,
         );
      }
   }

   Ok(())
}
