//! Minimal stub for `AddressLookupTab1e1111111111111111111111111` used in Mollusk.
//! Implements `CreateLookupTable` (discriminator `0`) and `ExtendLookupTable` (`2`) with the
//! same bincode account layout as the real program, enough for aggregator `init_program` CPIs.

use solana_address_lookup_table_interface::state::{
   AddressLookupTable, LookupTableMeta, LOOKUP_TABLE_MAX_ADDRESSES, LOOKUP_TABLE_META_SIZE,
};
use solana_program::{
   account_info::AccountInfo,
   clock::Clock,
   entrypoint,
   entrypoint::ProgramResult,
   program::{invoke, invoke_signed},
   program_error::ProgramError,
   pubkey::Pubkey,
   rent::Rent,
   system_instruction,
   sysvar::Sysvar,
};
use std::borrow::Cow;

const IX_CREATE: u32 = 0;
const IX_EXTEND: u32 = 2;

entrypoint!(process_instruction);

pub fn process_instruction(
   program_id: &Pubkey,
   accounts: &[AccountInfo],
   instruction_data: &[u8],
) -> ProgramResult {
   if accounts.len() < 4 {
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   if !accounts[1].is_signer {
      return Err(ProgramError::MissingRequiredSignature);
   }
   if !accounts[2].is_signer {
      return Err(ProgramError::MissingRequiredSignature);
   }
   if instruction_data.len() < 4 {
      return Err(ProgramError::InvalidInstructionData);
   }

   let disc = u32::from_le_bytes(instruction_data[0..4].try_into().unwrap());
   match disc {
      IX_CREATE => process_create(program_id, accounts, instruction_data),
      IX_EXTEND => process_extend(program_id, accounts, instruction_data),
      _ => Err(ProgramError::InvalidInstructionData),
   }
}

fn process_create(
   program_id: &Pubkey,
   accounts: &[AccountInfo],
   instruction_data: &[u8],
) -> ProgramResult {
   if instruction_data.len() < 13 {
      return Err(ProgramError::InvalidInstructionData);
   }
   let recent_slot = u64::from_le_bytes(instruction_data[4..12].try_into().unwrap());
   let bump_seed = instruction_data[12];

   let lookup_table = &accounts[0];
   let authority = &accounts[1];
   let payer = &accounts[2];
   let system_program = &accounts[3];

   if lookup_table.owner == program_id {
      return Ok(());
   }

   let expected = Pubkey::create_program_address(
      &[
         authority.key.as_ref(),
         &recent_slot.to_le_bytes(),
         &[bump_seed],
      ],
      program_id,
   )
   .map_err(|_| ProgramError::InvalidSeeds)?;
   if *lookup_table.key != expected {
      return Err(ProgramError::InvalidSeeds);
   }

   let rent = Rent::get()?;
   let space = LOOKUP_TABLE_META_SIZE as u64;
   let lamports = rent.minimum_balance(LOOKUP_TABLE_META_SIZE).max(1);

   let bump_arr = [bump_seed];
   let slot_bytes = recent_slot.to_le_bytes();
   let signer_seeds: &[&[u8]] = &[
      authority.key.as_ref(),
      slot_bytes.as_ref(),
      bump_arr.as_ref(),
   ];

   invoke_signed(
      &system_instruction::create_account(
         payer.key,
         lookup_table.key,
         lamports,
         space,
         program_id,
      ),
      &[payer.clone(), lookup_table.clone(), system_program.clone()],
      &[signer_seeds],
   )?;

   let meta = LookupTableMeta::new(*authority.key);
   {
      let mut data = lookup_table.try_borrow_mut_data()?;
      AddressLookupTable::overwrite_meta_data(&mut data, meta)
         .map_err(|_| ProgramError::InvalidAccountData)?;
   }

   Ok(())
}

fn process_extend(
   program_id: &Pubkey,
   accounts: &[AccountInfo],
   instruction_data: &[u8],
) -> ProgramResult {
   let lookup_table = &accounts[0];
   let authority = &accounts[1];
   let payer = &accounts[2];
   let system_program = &accounts[3];

   if lookup_table.owner != program_id {
      return Err(ProgramError::IncorrectProgramId);
   }
   if instruction_data.len() < 12 {
      return Err(ProgramError::InvalidInstructionData);
   }
   let n = u64::from_le_bytes(instruction_data[4..12].try_into().unwrap()) as usize;
   if n == 0 {
      return Err(ProgramError::InvalidInstructionData);
   }
   let need = 12usize
      .checked_add(n.checked_mul(32).ok_or(ProgramError::ArithmeticOverflow)?)
      .ok_or(ProgramError::ArithmeticOverflow)?;
   if instruction_data.len() < need {
      return Err(ProgramError::InvalidInstructionData);
   }

   let mut new_keys = Vec::with_capacity(n);
   let mut off = 12usize;
   for _ in 0..n {
      let pk = Pubkey::new_from_array(
         instruction_data[off..off + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
      );
      new_keys.push(pk);
      off += 32;
   }

   let data_copy = lookup_table.try_borrow_data()?.to_vec();
   let mut table =
      AddressLookupTable::deserialize(&data_copy).map_err(|_| ProgramError::InvalidAccountData)?;

   if table.meta.authority.is_none() {
      return Err(ProgramError::Immutable);
   }
   if table.meta.authority != Some(*authority.key) {
      return Err(ProgramError::InvalidAccountData);
   }

   let new_len = table
      .addresses
      .len()
      .checked_add(new_keys.len())
      .ok_or(ProgramError::ArithmeticOverflow)?;
   if new_len > LOOKUP_TABLE_MAX_ADDRESSES {
      return Err(ProgramError::InvalidInstructionData);
   }

   let clock = Clock::get()?;
   if clock.slot != table.meta.last_extended_slot {
      table.meta.last_extended_slot = clock.slot;
      table.meta.last_extended_slot_start_index =
         u8::try_from(table.addresses.len()).map_err(|_| ProgramError::InvalidAccountData)?;
   }

   let mut owned = table.addresses.into_owned();
   owned.extend_from_slice(&new_keys);
   let updated = AddressLookupTable {
      meta: table.meta,
      addresses: Cow::Owned(owned),
   };

   let serialized = updated
      .serialize_for_tests()
      .map_err(|_| ProgramError::InvalidAccountData)?;

   let rent = Rent::get()?;
   let min_lamports = rent.minimum_balance(serialized.len()).max(1);
   let lut_lamports = lookup_table.lamports();
   if lut_lamports < min_lamports {
      let delta = min_lamports.saturating_sub(lut_lamports);
      invoke(
         &system_instruction::transfer(payer.key, lookup_table.key, delta),
         &[payer.clone(), lookup_table.clone(), system_program.clone()],
      )?;
   }

   lookup_table.realloc(serialized.len(), false)?;
   {
      let mut data = lookup_table.try_borrow_mut_data()?;
      data.copy_from_slice(&serialized);
   }

   Ok(())
}
