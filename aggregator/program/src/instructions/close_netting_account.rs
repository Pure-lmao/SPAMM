use pinocchio::{
   AccountView, ProgramResult, error::ProgramError,
};
use pinocchio_log::log;

use crate::{
   helpers::{
      close_pda_return_rent, verify_mm_auth_signer, verify_mm_program_executable, verify_netting_pda_exists,
      verify_signer,
   },
   state::{EventId},
};

/// Close the netting PDA for `(mm_program, event_id)` and return rent to the MM
/// authority.
///
/// Accounts **(4)** — same roles as `remove_line_from_liability_account`:
/// 0. `auth_signer` (signer, writable) — must match `MmAccountConfig::auth_signer` on `config_pda`
///    for this `mm_program` (the MM that owns the netting record)
/// 1. `mm_program` (readonly) — MM program id used in netting PDA seeds
/// 2. `config_pda` (readonly) — that MM's `["config"]` PDA
/// 3. `netting_pda` (writable)
///
/// Instruction `data`: `event_id` (`EventId::WIRE_SIZE` bytes), same as `create_netting_account`.

pub const CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR: u8 = 9;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      auth_signer,
      mm_program,
      config_pda,
      netting_pda,
   ] = accounts else {
      log!("close_netting_account: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(auth_signer)?;
   verify_mm_program_executable(mm_program)?;
   verify_mm_auth_signer(auth_signer, mm_program, config_pda)?;

   let event_id = match EventId::decode(data) {
      Some(v) => v,
      None => {
         log!("close_netting_account: data length is invalid");
         return Err(ProgramError::InvalidInstructionData);
      }
   };

   verify_netting_pda_exists(netting_pda, mm_program, &event_id)?;
   close_pda_return_rent(netting_pda, auth_signer)
}
