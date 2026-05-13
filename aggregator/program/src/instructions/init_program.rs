//! Create the aggregator config PDA (single seed [`CONFIG_PDA_SEED`]) and the MM list PDA
//! (single seed [`MM_LIST_PDA_SEED`]), then create + extend an address lookup table whose
//! authority is the config PDA.
//!
//! Accounts:
//! 0. `authority` (writable signer) — pays rent; stored as initial `authority` in config
//! 1. `config_pda` (writable) — must be uninitialized; address must match derived PDA
//! 2. `mm_list_pda` (writable) — must be uninitialized; address must match derived PDA
//! 3. `system_program` (readonly)
//! 4. `lookup_table` (writable) — must be uninitialized; address = ALT PDA for `(config, recent_slot)`
//! 5. `mint` (readonly)
//! 6. `token_program` (readonly)
//! 7. `associated_token_program` (readonly)
//!
//! Instruction data (after router discriminator): `recent_slot: u64` (LE) for ALT derivation + create CPI.

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely, sysvars::{clock::CLOCK_ID, rent::RENT_ID},
};
use pinocchio_associated_token_account::ID as ASSOCIATED_TOKEN_PROGRAM_ID;
use pinocchio_log::log;
use pinocchio_system::{ID as SYSTEM_PROGRAM_ID, instructions::CreateAccount};
use pinocchio_token::ID as TOKEN_PROGRAM_ID;

use crate::{
   ID,
   alt_ix::{cpi_create_lookup_table, cpi_extend_lookup_table},
   constants::{ADDRESS_LOOKUP_TABLE_PROGRAM, CONFIG_PDA_SEED, MINT, MM_LIST_PDA, MM_LIST_PDA_SEED},
   helpers::{
      get_rent_local, verify_address_lookup_table_program, verify_config_pda, verify_signer, verify_system_program
   },
   state::{
      CONFIG_PDA_DISCRIMINATOR, CONFIG_PDA_LEN, CONFIG_PDA_LOOKUP_TABLE_OFFSET, ConfigPdaData,
      MM_LIST_HEADER_LEN, MM_LIST_PDA_DISCRIMINATOR,
   },
   writers::write_arbitrary_bytes_unchecked,
};


pub const INIT_PROGRAM_IX_DISCRIMINATOR: u8 = 0;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      authority,
      config_pda,
      mm_list_pda,
      system_program,
      lookup_table,
      lookup_table_program,
   ] = accounts else {
      log!("init_program: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if unlikely(data.len() != 8) {
      log!("init_program: expected 8 bytes recent_slot (u64 le)");
      return Err(ProgramError::InvalidInstructionData);
   }
   let mut rs = [0u8; 8];
   rs.copy_from_slice(data);
   let recent_slot = u64::from_le_bytes(rs);

   verify_signer(&authority)?;
   verify_system_program(&system_program)?;
   verify_address_lookup_table_program(&lookup_table_program)?;

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
   let config_signer = Signer::from(&signer_seeds);

   let config_space = CONFIG_PDA_LEN as u64;
   CreateAccount {
      from: authority,
      to: config_pda,
      lamports: get_rent_local(config_space),
      space: config_space,
      owner: &ID,
   }
   .invoke_signed(&[config_signer])?;

   let body = ConfigPdaData {
      discriminator: CONFIG_PDA_DISCRIMINATOR,
      status: 0,
      authority: *authority.address(),
      lookup_table: Address::new_from_array([0u8; 32]),
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
      write_arbitrary_bytes_unchecked(p, 0, &[MM_LIST_PDA_DISCRIMINATOR, 0, 0]);
   }

   //-----ADDRESS LOOKUP TABLE (authority = config PDA)-----

   if unlikely(lookup_table.lamports() != 0 || lookup_table.data_len() != 0) {
      log!("init_program: lookup_table account must be empty");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!address_eq(lookup_table.owner(), &SYSTEM_PROGRAM_ID)) {
      log!("init_program: lookup_table must be system-owned before init");
      return Err(ProgramError::InvalidAccountOwner);
   }

   let slot_bytes = recent_slot.to_le_bytes();
   let alt_seeds = [config_pda.address().as_ref(), slot_bytes.as_slice()];
   let (expected_alt, alt_bump) = Address::find_program_address(
      &alt_seeds, &ADDRESS_LOOKUP_TABLE_PROGRAM);
   if unlikely(!address_eq(lookup_table.address(), &expected_alt)) {
      log!("init_program: lookup_table address mismatch for authority+recent_slot");
      return Err(ProgramError::InvalidSeeds);
   }

   let config_signer_alt = Signer::from(&signer_seeds);
   cpi_create_lookup_table(
      lookup_table,
      config_pda,
      authority,
      system_program,
      recent_slot,
      alt_bump,
      config_signer_alt,
   )?;

   let initial_addresses: [Address; 7] = [
      *config_pda.address(),
      MINT,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      SYSTEM_PROGRAM_ID,
      RENT_ID,
      CLOCK_ID,
   ];
   let config_signer_extend = Signer::from(&signer_seeds);
   cpi_extend_lookup_table(
      lookup_table,
      config_pda,
      authority,
      system_program,
      &initial_addresses,
      config_signer_extend,
   )?;

   unsafe {
      write_arbitrary_bytes_unchecked(
         config_pda.data_mut_ptr(),
         CONFIG_PDA_LOOKUP_TABLE_OFFSET,
         lookup_table.address().as_ref(),
      );
   }

   Ok(())
}