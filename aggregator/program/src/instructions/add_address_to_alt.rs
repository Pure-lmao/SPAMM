//! Append a single address to the program's address lookup table (ALT).
//!
//! The config PDA is the ALT authority; only the config admin may invoke this. The config PDA
//! signs the `ExtendLookupTable` CPI via its seeds.
//!
//! Accounts: **5**
//! 0. `admin` (writable signer) — must equal config authority; pays rent on ALT resize.
//! 1. `config_pda` (readonly) — ALT authority; signs the extend CPI via PDA seeds.
//! 2. `lookup_table` (writable) — the program ALT.
//! 3. `system_program` (readonly)
//! 4. `lookup_table_program` (readonly) — Address Lookup Table program.
//!
//! Data:
//! 0..32. `address` (`[u8; 32]`) — the address to append to the ALT.

use pinocchio::{
   AccountView, Address, ProgramResult,
   cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;

use crate::{
   alt_ix::cpi_extend_lookup_table,
   constants::{CONFIG_PDA_BUMP, CONFIG_PDA_SEED},
   helpers::{
      verify_address_lookup_table_program, verify_authority, verify_config_pda,
      verify_lookup_table, verify_signer, verify_system_program,
   },
};


pub const ADD_ADDRESS_TO_ALT_IX_DISCRIMINATOR: u8 = 250;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      admin, //verified as signer + config authority
      config_pda, //verified by verify_config_pda; ALT authority (signs via seeds)
      lookup_table, //verified by verify_lookup_table
      system_program,
      lookup_table_program,
   ] = accounts else {
      log!("add_address_to_alt: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&admin)?;
   verify_config_pda(&config_pda, false)?;
   verify_authority(&admin, &config_pda)?;
   verify_lookup_table(&lookup_table)?;
   verify_system_program(&system_program)?;
   verify_address_lookup_table_program(&lookup_table_program)?;

   if unlikely(data.len() != 32) {
      log!("add_address_to_alt: data must be 32 bytes (one address)");
      return Err(ProgramError::InvalidInstructionData);
   }

   let mut addr_bytes = [0u8; 32];
   addr_bytes.copy_from_slice(data);
   let new_address = Address::new_from_array(addr_bytes);

   let config_bump_seed = [CONFIG_PDA_BUMP];
   let signer_seeds: [Seed<'_>; 2] = [
      Seed::from(CONFIG_PDA_SEED),
      Seed::from(&config_bump_seed as &[u8]),
   ];
   let config_signer = Signer::from(&signer_seeds);

   cpi_extend_lookup_table(
      lookup_table,
      config_pda,
      admin,
      system_program,
      &[new_address],
      config_signer,
   )?;

   Ok(())
}
