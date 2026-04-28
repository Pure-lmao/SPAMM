//! Create the aggregator config PDA (single seed [`CONFIG_PDA_SEED`]) and the MM list PDA
//! (single seed [`MM_LIST_PDA_SEED`]).
//!
//! Accounts:
//! 0. `authority` (writable signer) — pays rent; stored as initial `authority` in config
//! 1. `config_pda` (writable) — must be uninitialized; address must match derived PDA
//! 2. `mm_list_pda` (writable) — must be uninitialized; address must match derived PDA
//! 3. `system_program` (readonly)
//!
//! No instruction data after the router discriminator.

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
   ID,
   constants::{CONFIG_PDA_SEED, MM_LIST_PDA, MM_LIST_PDA_SEED},
   helpers::{get_rent_local, verify_config_pda, verify_signer, verify_system_program},
   state::{
      CONFIG_PDA_DISCRIMINATOR, CONFIG_PDA_LEN, ConfigPdaData, MM_LIST_HEADER_LEN,
      MM_LIST_PDA_DISCRIMINATOR
   },
   writers::{write_arbitrary_bytes_unchecked},
};


pub const INIT_PROGRAM_IX_DISCRIMINATOR: u8 = 0;

pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
   let [
      authority,
      config_pda,
      mm_list_pda,
      system_program,
   ] = accounts else {
      log!("init_program: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&authority)?;
   verify_system_program(&system_program)?;

   //-----CONFIG PDA-----

   if unlikely(
      config_pda.lamports() > 0 || config_pda.data_len() != 0,
   ) {
      log!("init_program: config pda must be uninitialized");
      return Err(ProgramError::InvalidAccountData);
   }

   let (_, config_bump) = Address::find_program_address(&[CONFIG_PDA_SEED], &ID);
   verify_config_pda(&config_pda, false)?;

   let config_bump_seed = [config_bump];
   let signer_seeds: [Seed<'_>; 2] = [
      Seed::from(CONFIG_PDA_SEED),
      Seed::from(&config_bump_seed as &[u8]),
   ];
   let signers = [Signer::from(&signer_seeds)];

   let config_space = CONFIG_PDA_LEN as u64;
   CreateAccount {
      from: authority,
      to: config_pda,
      lamports: get_rent_local(config_space),
      space: config_space,
      owner: &ID,
   }
   .invoke_signed(&signers)?;

   let body = ConfigPdaData {
      discriminator: CONFIG_PDA_DISCRIMINATOR,
      status: 0,
      authority: *authority.address(),
   };
   unsafe {
      core::ptr::write(config_pda.data_mut_ptr().cast::<ConfigPdaData>(), body);
   }

   //-----MM LIST PDA-----

   if unlikely(
      mm_list_pda.lamports() > 0 || mm_list_pda.data_len() != 0,
   ) {
      log!("init_program: mm_list pda must be uninitialized");
      return Err(ProgramError::InvalidAccountData);
   }

   let (_, mm_list_bump) = Address::find_program_address(&[MM_LIST_PDA_SEED], &ID);
   if unlikely(!address_eq(mm_list_pda.address(), &MM_LIST_PDA)) {
      log!("init_program: mm_list pda address mismatch");
      return Err(ProgramError::InvalidSeeds);
   }

   let mm_list_bump_seed = [mm_list_bump];
   let mm_list_signer_seeds = [
      Seed::from(MM_LIST_PDA_SEED),
      Seed::from(&mm_list_bump_seed as &[u8]),
   ];
   let mm_list_signers = [Signer::from(&mm_list_signer_seeds)];

   let mm_list_space = MM_LIST_HEADER_LEN as u64;
   CreateAccount {
      from: authority,
      to: mm_list_pda,
      lamports: get_rent_local(mm_list_space),
      space: mm_list_space,
      owner: &ID,
   }
   .invoke_signed(&mm_list_signers)?;

   unsafe {
      let p = mm_list_pda.data_mut_ptr();
      write_arbitrary_bytes_unchecked(p, 0, 
         // disc u8, 0 u16
         &[MM_LIST_PDA_DISCRIMINATOR, 0, 0]);
   }

   Ok(())
}

