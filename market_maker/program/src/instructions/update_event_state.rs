//! Update `event_state` PDA: set `sequence` and `game_state` (admin-only).
//!
//! Accounts: **(3)**
//! 0. `feepayer` (signer) — must match `MmAccountConfig::admin` on `config_pda`
//! 1. `config_pda` (readonly) — PDA `["config"]` under the MM
//! 2. `event_state_pda` (writable) — [`EVENT_STATE_LEN`] bytes
//!
//! Instruction `data`: [`UpdateEventStateIxPayload`] (`event_id`, `sequence` LE, `game_state`).

use core::ptr::write;

use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use spamm_aggregator::helpers::verify_signer;
use spamm_aggregator::state::EVENT_STATE_LEN;

use crate::mm_helpers::{verify_event_state_pda, verify_mm_config_auth};
use crate::state::UpdateEventStateIxPayload;

/// **13** — after parlay quote instructions **7** / **8** and lifecycle ix **9**–**12**.
pub const UPDATE_EVENT_STATE_IX_DISCRIMINATOR: u8 = 13;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [feepayer, config_pda, event_state_pda] = accounts else {
      log!("update_event_state: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let parsed = UpdateEventStateIxPayload::decode(data)?;
   let event_id = parsed.event_id;

   verify_signer(feepayer)?;
   verify_mm_config_auth(feepayer, config_pda)?;

   let mut zc = verify_event_state_pda(event_state_pda, program_id, &event_id)?;
   zc.sequence = parsed.sequence.into();
   zc.game_state = parsed.game_state.to_zc();

   {
      let mut es = event_state_pda.try_borrow_mut()?;
      if unlikely(es.len() != EVENT_STATE_LEN) {
         log!("update_event_state: event state data len");
         return Err(ProgramError::InvalidAccountData);
      }
      unsafe {
         write(es.as_mut_ptr().cast(), zc);
      }
   }

   Ok(())
}
