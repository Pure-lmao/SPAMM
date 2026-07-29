//! Admin-controlled teardown of an MM registration (inverse of `register_mm`).
//!
//! Accounts (17):
//! 0. `aggregator_admin` (writable signer) — must match aggregator config authority
//! 1. `mm_admin` (writable) — receives ATA + encumbrance rent; must match MM config admin
//! 2. `mm_program` (readonly)
//! 3. `mm_config_pda` (readonly)
//! 4. `mm_encumbrance_pda` (writable)
//! 5. `mm_liability_token_account` (writable)
//! 6. `our_config_pda` (readonly)
//! 7. `mm_list_pda` (writable)
//! 8. `mint` (readonly)
//! 9. `token_program` (readonly)
//! 10. `associated_token_program` (readonly)
//! 11. `system_program` (readonly)
//! 12. `lookup_table` (writable)
//! 13. `lookup_table_program` (readonly)
//! 14. `mm_token_account` (writable)
//! 15. `mm_quote_buffer` (readonly)
//! 16. `mm_parlay_quote_buffer` (readonly)
//!
//! Instruction data: empty.

use pinocchio::{
   AccountView, Address, ProgramResult, Resize, address::address_eq, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;

use crate::{
   helpers::{
      close_pda_return_rent, get_rent_local, safe_close_ata, verify_address_lookup_table_program,
      verify_associated_token_program, verify_authority, verify_config_pda, verify_lookup_table,
      verify_mint, verify_mm_admin, verify_mm_encumbrance_pda, verify_mm_list_pda,
      verify_mm_program_executable, verify_parlay_quote_buffer, verify_quote_buffer, verify_signer,
      verify_system_program, verify_token_account, verify_token_program,
   },
   parsers::get_encumbrance,
   readers::{read_address_unchecked, read_u16_le_unchecked},
   state::{
      MM_LIST_HEADER_LEN,
      other::{MM_ENCUMBRANCE_PDA_SEED, MM_LIST_ENTRY_LEN, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET},
   },
   writers::write_u16_le_unchecked,
};

pub const DEREGISTER_MM_IX_DISCRIMINATOR: u8 = 3;

fn find_mm_list_index(mm_list: &AccountView, mm_program: &Address) -> Result<usize, ProgramError> {
   let data_len = mm_list.data_len();
   if unlikely(data_len < MM_LIST_HEADER_LEN) {
      log!("deregister_mm: mm_list data too short");
      return Err(ProgramError::InvalidAccountData);
   }

   let number_of_mms =
      unsafe { read_u16_le_unchecked(mm_list.data_ptr(), MM_LIST_PDA_NUMBER_OF_MMS_OFFSET) }
         as usize;
   let expected_len = MM_LIST_HEADER_LEN
      .checked_add(number_of_mms.checked_mul(MM_LIST_ENTRY_LEN).ok_or(ProgramError::ArithmeticOverflow)?)
      .ok_or(ProgramError::ArithmeticOverflow)?;
   if unlikely(data_len != expected_len) {
      log!("deregister_mm: mm_list length does not match number_of_mms");
      return Err(ProgramError::InvalidAccountData);
   }

   let ptr = mm_list.data_ptr();
   for i in 0..number_of_mms {
      let off = MM_LIST_HEADER_LEN + i * MM_LIST_ENTRY_LEN;
      let entry = unsafe { read_address_unchecked(ptr, off) };
      if address_eq(&entry, mm_program) {
         return Ok(i);
      }
   }

   log!("deregister_mm: mm_program not in mm_list");
   Err(ProgramError::InvalidAccountData)
}

fn remove_mm_from_list(
   mm_list_pda: &mut AccountView,
   lamport_recipient: &mut AccountView,
   idx: usize,
) -> ProgramResult {
   let number_of_mms =
      unsafe { read_u16_le_unchecked(mm_list_pda.data_ptr(), MM_LIST_PDA_NUMBER_OF_MMS_OFFSET) }
         as usize;

   if number_of_mms == 0 {
      log!("deregister_mm: mm_list is empty");
      return Err(ProgramError::InvalidAccountData);
   }

   let ptr = mm_list_pda.data_mut_ptr();
   if idx + 1 < number_of_mms {
      let last_off = MM_LIST_HEADER_LEN + (number_of_mms - 1) * MM_LIST_ENTRY_LEN;
      let idx_off = MM_LIST_HEADER_LEN + idx * MM_LIST_ENTRY_LEN;
      // Byte copy only: entries sit at header_len (3), so pubkeys are never Address-aligned.
      unsafe {
         core::ptr::copy_nonoverlapping(
            ptr.add(last_off),
            ptr.add(idx_off),
            MM_LIST_ENTRY_LEN,
         );
      }
   }

   let new_count = number_of_mms - 1;
   unsafe {
      write_u16_le_unchecked(ptr, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET, new_count as u16);
   }

   let new_len = MM_LIST_HEADER_LEN
      .checked_add(new_count.checked_mul(MM_LIST_ENTRY_LEN).ok_or(ProgramError::ArithmeticOverflow)?)
      .ok_or(ProgramError::ArithmeticOverflow)?;
   let new_rent = get_rent_local(new_len as u64);
   let cur_lamports = mm_list_pda.lamports();
   if cur_lamports > new_rent {
      let sweep = cur_lamports - new_rent;
      let recipient_lamports = lamport_recipient.lamports();
      mm_list_pda.set_lamports(new_rent);
      lamport_recipient.set_lamports(recipient_lamports + sweep);
   }
   mm_list_pda.resize(new_len)?;

   Ok(())
}

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      aggregator_admin,
      mm_admin,
      mm_program,
      mm_config_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
      our_config_pda,
      mm_list_pda,
      mint,
      token_program,
      associated_token_program,
      system_program,
      lookup_table,
      lookup_table_program,
      mm_token_account,
      mm_quote_buffer,
      mm_parlay_quote_buffer,
   ] = accounts else {
      log!("deregister_mm: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if unlikely(!data.is_empty()) {
      log!("deregister_mm: instruction data must be empty");
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_signer(aggregator_admin)?;
   verify_config_pda(our_config_pda, false)?;
   verify_authority(aggregator_admin, our_config_pda)?;
   verify_mm_program_executable(mm_program)?;
   verify_mm_admin(mm_admin, mm_program, mm_config_pda)?;
   verify_system_program(system_program)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;
   verify_mint(mint)?;
   verify_mm_list_pda(mm_list_pda)?;
   verify_token_account(
      true,
      mm_liability_token_account,
      mm_encumbrance_pda,
      mint,
      token_program,
   )?;
   verify_token_account(
      true,
      mm_token_account,
      mm_config_pda,
      mint,
      token_program,
   )?;
   verify_address_lookup_table_program(lookup_table_program)?;
   verify_lookup_table(lookup_table)?;

   if unlikely(!verify_quote_buffer(mm_quote_buffer, mm_program)) {
      log!("deregister_mm: quote buffer is invalid");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!verify_parlay_quote_buffer(mm_parlay_quote_buffer, mm_program)) {
      log!("deregister_mm: parlay quote buffer is invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   let idx = find_mm_list_index(mm_list_pda, mm_program.address())?;

   let Some(encumbrance_bump) = verify_mm_encumbrance_pda(mm_encumbrance_pda, mm_program) else {
      log!("deregister_mm: invalid mm encumbrance pda");
      return Err(ProgramError::InvalidAccountOwner);
   };

   let encumbrance = get_encumbrance(mm_encumbrance_pda)?;
   if unlikely(encumbrance != 0) {
      log!("deregister_mm: encumbrance must be zero");
      return Err(ProgramError::InvalidAccountData);
   }

   let encumbrance_bump_seed = [encumbrance_bump];
   let encumbrance_pda_seeds = [
      Seed::from(MM_ENCUMBRANCE_PDA_SEED),
      Seed::from(mm_program.address().as_ref()),
      Seed::from(&encumbrance_bump_seed),
   ];
   let encumbrance_pda_signer = Signer::from(&encumbrance_pda_seeds);

   safe_close_ata(
      mm_liability_token_account,
      mm_admin,
      mm_token_account,
      mm_encumbrance_pda,
      &[encumbrance_pda_signer],
   )?;

   close_pda_return_rent(mm_encumbrance_pda, mm_admin)?;

   remove_mm_from_list(mm_list_pda, mm_admin, idx)?;

   Ok(())
}