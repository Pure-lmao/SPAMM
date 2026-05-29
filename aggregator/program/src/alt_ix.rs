//! CPI to the Address Lookup Table program (`bincode` layout matching `Instruction::new_with_bincode`).

use pinocchio::{
   AccountView, Address, ProgramResult,
   cpi::{Signer, invoke_signed},
   error::ProgramError,
   instruction::{InstructionAccount, InstructionView},
};

use crate::constants::ADDRESS_LOOKUP_TABLE_PROGRAM;

const IX_CREATE_LOOKUP_TABLE: u32 = 0;
const IX_EXTEND_LOOKUP_TABLE: u32 = 2;

/// Writes `CreateLookupTable { recent_slot, bump_seed }` into `buf`.
#[inline(always)]
pub fn write_create_lookup_table_ix_data<'a>(
   buf: &'a mut [u8],
   recent_slot: u64,
   bump_seed: u8,
) -> Result<&'a mut [u8], ProgramError> {
   if buf.len() < 13 {
      return Err(ProgramError::InvalidInstructionData);
   }
   buf[0..4].copy_from_slice(&IX_CREATE_LOOKUP_TABLE.to_le_bytes());
   buf[4..12].copy_from_slice(&recent_slot.to_le_bytes());
   buf[12] = bump_seed;
   Ok(&mut buf[..13])
}

/// Writes `ExtendLookupTable { new_addresses }` into `buf`.
#[inline(always)]
pub fn write_extend_lookup_table_ix_data<'a>(
   buf: &'a mut [u8],
   addresses: &[Address],
) -> Result<&'a mut [u8], ProgramError> {
   let n = addresses.len();
   let total = 4usize
      .checked_add(8)
      .and_then(|x| x.checked_add(n.checked_mul(32)?))
      .ok_or(ProgramError::ArithmeticOverflow)?;
   if buf.len() < total {
      return Err(ProgramError::InvalidInstructionData);
   }
   buf[0..4].copy_from_slice(&IX_EXTEND_LOOKUP_TABLE.to_le_bytes());
   buf[4..12].copy_from_slice(&(n as u64).to_le_bytes());
   let mut off = 12;
   for a in addresses {
      buf[off..off + 32].copy_from_slice(a.as_ref());
      off += 32;
   }
   Ok(&mut buf[..total])
}


/// CPI `CreateLookupTable`. `config_authority` is the config PDA (signer via `signer`).
#[inline(always)]
pub fn cpi_create_lookup_table(
   lookup_table: &AccountView,
   config_authority: &AccountView,
   payer: &AccountView,
   system_program: &AccountView,
   recent_slot: u64,
   bump_seed: u8,
   signer: Signer,
) -> ProgramResult {
   let mut ix_data_buf = [0u8; 13];
   let data = write_create_lookup_table_ix_data(&mut ix_data_buf, recent_slot, bump_seed)?;
   // Authority is a PDA signed via `signer`. Pinocchio builds CPI `AccountMeta` from
   // `InstructionAccount`; it must mark the PDA as signer so Extend (and relaxed Create) work.
   let accounts = [
      InstructionAccount::new(lookup_table.address(), true, false),
      InstructionAccount::new(config_authority.address(), false, true),
      InstructionAccount::new(payer.address(), true, true),
      InstructionAccount::new(system_program.address(), false, false),
   ];
   let ix = InstructionView {
      program_id: &ADDRESS_LOOKUP_TABLE_PROGRAM,
      accounts: &accounts,
      data,
   };
   invoke_signed(
      &ix,
      &[lookup_table, config_authority, payer, system_program],
      &[signer],
   )
}

/// CPI `ExtendLookupTable` with optional payer + system for rent on resize.
#[inline(always)]
pub fn cpi_extend_lookup_table(
   lookup_table: &AccountView,
   config_authority: &AccountView,
   payer: &AccountView,
   system_program: &AccountView,
   new_addresses: &[Address],
   signer: Signer,
) -> ProgramResult {
   const TOTAL_LEN: usize = 4 + 8 + 32 * 8;
   let mut ix_data_buf = [0u8; TOTAL_LEN];
   let data = write_extend_lookup_table_ix_data(&mut ix_data_buf, new_addresses)?;
   let accounts = [
      InstructionAccount::new(lookup_table.address(), true, false),
      InstructionAccount::new(config_authority.address(), false, true),
      InstructionAccount::new(payer.address(), true, true),
      InstructionAccount::new(system_program.address(), false, false),
   ];
   let ix = InstructionView {
      program_id: &ADDRESS_LOOKUP_TABLE_PROGRAM,
      accounts: &accounts,
      data,
   };
   invoke_signed(
      &ix,
      &[lookup_table, config_authority, payer, system_program],
      &[signer],
   )
}
