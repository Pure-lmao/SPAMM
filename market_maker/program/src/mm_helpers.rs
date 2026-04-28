use core::result::Result;

use pinocchio::account::AccountView;
use pinocchio::address::{Address, address_eq};
use pinocchio::cpi::Signer;
use pinocchio::error::ProgramError;
use pinocchio::hint::unlikely;
use pinocchio::ProgramResult;
use pinocchio_system::instructions::Transfer;
use spamm_aggregator::state::{
   EVENT_STATE_DISCRIMINATOR, EVENT_STATE_LEN, EVENT_STATE_SEED, EventId, EventStateData, 
   MM_ACCOUNT_CONFIG_SEED, MM_QUOTE_BUFFER_LEN, MarketId
};
use zeropod::ZeroPodFixed;

use crate::constants::ORACLE_SEED;

/// Quote buffer: MM-owned, fixed length, matches [`MM_QUOTE_BUFFER_LEN`].
#[inline(always)]
pub fn verify_quote_buffer(quote_buffer: &AccountView, program_id: &Address) -> bool {
   if unlikely(!address_eq(quote_buffer.owner(), program_id)) {
      return false;
   }
   let quote_buffer_data = match quote_buffer.try_borrow() {
      Ok(data) => data,
      Err(_) => return false,
   };
   if unlikely(quote_buffer_data.len() != MM_QUOTE_BUFFER_LEN) {
      return false;
   }
   true
}

/// MM config PDA `["config"]` under `program_id`; `feepayer` must match `auth_signer`.
#[inline(always)]
pub fn verify_mm_config_auth(
   feepayer: &AccountView,
   config_pda: &AccountView,
   program_id: &Address,
) -> Result<(), ProgramError> {

   let stored_bump = unsafe { *(config_pda.data_ptr().add(1) as *const u8) };
   let stored_auth_signer = unsafe { *(config_pda.data_ptr().add(2) as *const Address) };
   let expected_address = Address::derive_address(
      &[MM_ACCOUNT_CONFIG_SEED],
      Some(stored_bump),
      program_id,
   );
   if unlikely(!address_eq(config_pda.address(), &expected_address)) {
      return Err(ProgramError::InvalidSeeds);
   }
   
   if unlikely(!address_eq(feepayer.address(), &stored_auth_signer)) {
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

/// Oracle PDA: `["oracle", market_id_wire]`, with `to_zc(true)` on `market_id` (see `get_quote`).
#[inline(always)]
pub fn find_oracle_pda(program_id: &Address, market_id: &MarketId) -> (Address, u8) {
   let mut market_wire = [0u8; MarketId::WIRE_SIZE];
   let zc = market_id.to_zc(true);
   unsafe {
      core::ptr::write(market_wire.as_mut_ptr().cast(), zc);
   }
   let seeds: [&[u8]; 2] = [ORACLE_SEED, market_wire.as_slice()];
   Address::find_program_address(&seeds, program_id)
}

#[inline(always)]
pub fn mm_oracle_pda_ok(oracle: &AccountView, program_id: &Address, market_id: &MarketId) -> bool {
   if unlikely(!address_eq(oracle.owner(), program_id)) {
      return false;
   }
   let (expected, _) = find_oracle_pda(program_id, market_id);
   address_eq(oracle.address(), &expected)
}

/// Event state PDA `["event_state", event_id]`, plus sequence and hash.
#[inline(always)]
pub fn verify_event_state(
   event_state_pda: &AccountView,
   program_id: &Address,
   event_id: &EventId,
   event_state_hash: &[u8; 32],
   event_state_sequence: u16,
) -> bool {
   if unlikely(!address_eq(event_state_pda.owner(), program_id)) {
      return false;
   }

   let event_state_data = match event_state_pda.try_borrow() {
      Ok(data) => data,
      Err(_) => return false,
   };

   if unlikely(event_state_data.len() != EVENT_STATE_LEN) {
      return false;
   }

   let state = match EventStateData::from_bytes(&event_state_data) {
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

   if unlikely(&state.state_hash != event_state_hash) {
      return false;
   }

   true
}

/// Transfers all lamports from `pda` to `recipient` (PDA signs with `signers`), then closes `pda`.
#[inline(never)]
pub fn close_pda_return_rent(
   pda: &mut AccountView,
   recipient: &mut AccountView,
   signers: &[Signer],
) -> ProgramResult {
   let lamports = pda.lamports();
   if lamports > 0 {
      Transfer {
         from: pda,
         to: recipient,
         lamports,
      }
      .invoke_signed(signers)?;
   }
   pda.close()
}
