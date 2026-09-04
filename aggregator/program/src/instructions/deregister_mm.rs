//! Admin-controlled teardown of an MM registration (inverse of `register_mm`).
//!
//! Accounts (16):
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
//! 11. `rent_sysvar` (readonly)
//! 12. `system_program` (readonly)
//! 13. `mm_token_account` (writable)
//! 14. `mm_quote_buffer` (readonly)
//! 15. `mm_parlay_quote_buffer` (readonly)
//!
//! Instruction data: empty.

use pinocchio::{
   AccountView, ProgramResult, Resize, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;

use crate::{
   helpers::{
      close_pda_return_rent, find_mm_program_in_list, get_rent, safe_close_ata,
      verify_associated_token_program, verify_authority, verify_config_pda, verify_mint,
      verify_mm_admin, verify_mm_encumbrance_pda, verify_mm_list_pda, verify_mm_program_executable,
      verify_parlay_quote_buffer, verify_quote_buffer, verify_rent_sysvar, verify_signer,
      verify_system_program, verify_token_account, verify_token_program, get_encumbrance,
   },
   state::{
      MM_LIST_HEADER_LEN,
      other::{MM_ENCUMBRANCE_PDA_SEED, MM_LIST_ENTRY_LEN, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET},
   },
   writers::write_u16_le_unchecked,
};

pub const DEREGISTER_MM_IX_DISCRIMINATOR: u8 = 3;

fn remove_mm_from_list(
   mm_list_pda: &mut AccountView,
   lamport_recipient: &mut AccountView,
   rent_sysvar: &AccountView,
   idx: usize,
   number_of_mms: usize,
) -> ProgramResult {
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
      .checked_add(new_count.checked_mul(MM_LIST_ENTRY_LEN).ok_or(ProgramError::ArithmeticOverflow)?).ok_or(ProgramError::ArithmeticOverflow)?;
   let new_rent = get_rent(rent_sysvar, new_len as u64)?;
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
      rent_sysvar,
      system_program,
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
   verify_rent_sysvar(rent_sysvar)?;
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

   if unlikely(!verify_quote_buffer(mm_quote_buffer, mm_program)) {
      log!("deregister_mm: quote buffer is invalid");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!verify_parlay_quote_buffer(mm_parlay_quote_buffer, mm_program)) {
      log!("deregister_mm: parlay quote buffer is invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   let (idx, number_of_mms) = find_mm_program_in_list(mm_list_pda, mm_program.address())?;

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

   remove_mm_from_list(mm_list_pda, mm_admin, rent_sysvar, idx, number_of_mms)?;

   Ok(())
}
