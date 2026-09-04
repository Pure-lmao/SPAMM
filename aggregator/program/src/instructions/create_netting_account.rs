//! Create a liability netting account for an event.
//!
//! Accounts **(6)**
//! 0. `mm_admin` (writable signer) — must match authority in mm config pda
//! 1. `mm_program` (readonly, executable)
//! 2. `mm_config_pda` (readonly) — verified by `verify_mm_admin`
//! 3. `netting_pda` (writable — uninitialized)
//! 4. `rent_sysvar` (readonly)
//! 5. `system_program` (readonly)
//!
//! Data: `{event_id: EventId}`

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
   ID,
   helpers::{find_netting_pda, get_rent, verify_mm_admin, verify_mm_program_executable, verify_rent_sysvar, verify_signer, verify_system_program},
   state::{
      EventId, NETTING_ACCOUNT_ALLOC_LEN, NETTING_PDA_DISCRIMINATOR, NETTING_PDA_SEED, account_netting::NettingPdaDataHeaderZc
   },
};

pub const CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR: u8 = 40;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      mm_admin,
      mm_program_account,
      mm_config_pda,
      netting_pda,
      rent_sysvar,
      system_program,
   ] = accounts else {
      log!("create_netting_account: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&mm_admin)?;
   verify_mm_admin(mm_admin, mm_program_account, mm_config_pda)?;
   verify_rent_sysvar(&rent_sysvar)?;
   verify_system_program(&system_program)?;
   verify_mm_program_executable(&mm_program_account)?;

   let event_id = match EventId::decode(data) {
      Some(v) => v,
      None => {
         log!("create_netting_account: data length is invalid");
         return Err(ProgramError::InvalidInstructionData);
      }
   };

   if unlikely(
      netting_pda.lamports() > 0 || netting_pda.data_len() != 0,
   ) {
      log!(
         "create_netting_account: netting pda must have 0 lamports and 0 data"
      );
      return Err(ProgramError::InvalidAccountData);
   }

   let event_id_wire = event_id.as_wire_bytes();
   let (pda, bump) = find_netting_pda(mm_program_account.address(), &event_id_wire);
   if unlikely(!address_eq(netting_pda.address(), &pda)) {
      log!("create_netting_account: netting pda is invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   let bump_seed = [bump];
   let signer_seeds = [
      Seed::from(NETTING_PDA_SEED),
      Seed::from(mm_program_account.address().as_ref()),
      Seed::from(event_id_wire.as_slice()),
      Seed::from(&bump_seed),
   ];
   let signers = [Signer::from(&signer_seeds)];

   let space = NETTING_ACCOUNT_ALLOC_LEN as u64;
   CreateAccount {
      from: mm_admin,
      to: netting_pda,
      lamports: get_rent(rent_sysvar, space)?,
      space,
      owner: &ID,
   }
   .invoke_signed(&signers)?;

   let header = NettingPdaDataHeaderZc {
      discriminator: NETTING_PDA_DISCRIMINATOR,
      bump,
      event_id: event_id.to_zc(),
      open_home: 0u64.into(),
      open_away: 0u64.into(),
      open_draw: 0u64.into(),
      number_of_lines: 0,
   };
   {
      let mut acc_data = netting_pda.try_borrow_mut()?;
      unsafe {
         core::ptr::write(
            acc_data.as_mut_ptr().cast::<NettingPdaDataHeaderZc>(),
            header,
         );
      }
   }

   Ok(())
}
