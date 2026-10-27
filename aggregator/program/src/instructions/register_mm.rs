//! Register an MM on the aggregator list. Does not open a mint vault.
//!
//! Accounts (9):
//! 0. `mm_admin` (writable signer)
//! 1. `mm_program` (readonly)
//! 2. `mm_config_pda` (readonly)
//! 3. `our_config_pda` (readonly)
//! 4. `mm_list_pda` (writable)
//! 5. `rent_sysvar` (readonly)
//! 6. `system_program` (readonly)
//! 7. `mm_quote_buffer` (readonly)
//! 8. `mm_parlay_quote_buffer` (readonly)
//!
//! Instruction data: empty. Open a per-mint vault with `init_mm_mint_vault`.

use pinocchio::{
   AccountView, ProgramResult, Resize,
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use pinocchio_system::instructions::Transfer;

use crate::{
   helpers::{
      get_rent, ensure_mm_program_not_in_list,
      verify_config_pda, verify_mm_admin, verify_mm_list_pda, verify_mm_program_executable,
      verify_parlay_quote_buffer, verify_quote_buffer, verify_rent_sysvar, verify_signer,
      verify_system_program,
   },
   state::{
      MM_LIST_HEADER_LEN, other::{MM_LIST_ENTRY_LEN, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET}
   },
   writers::{write_arbitrary_bytes_unchecked, write_u16_le_unchecked},
};

pub const REGISTER_MM_IX_DISCRIMINATOR: u8 = 2;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      mm_admin,
      mm_program,
      mm_config_pda,
      our_config_pda,
      mm_list_pda,
      rent_sysvar,
      system_program,
      mm_quote_buffer,
      mm_parlay_quote_buffer,
   ] = accounts else {
      log!("register_mm: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if unlikely(!data.is_empty()) {
      log!("register_mm: instruction data must be empty");
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_signer(&mm_admin)?;
   verify_mm_program_executable(&mm_program)?;
   verify_mm_admin(&mm_admin, &mm_program, mm_config_pda)?;
   verify_rent_sysvar(&rent_sysvar)?;
   verify_system_program(&system_program)?;
   verify_config_pda(&our_config_pda, false)?;
   verify_mm_list_pda(mm_list_pda)?;
   if unlikely(!verify_quote_buffer(mm_quote_buffer, &mm_program)) {
      log!("register_mm: quote buffer is invalid");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!verify_parlay_quote_buffer(mm_parlay_quote_buffer, &mm_program)) {
      log!("register_mm: parlay quote buffer is invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   let number_of_mms = ensure_mm_program_not_in_list(mm_list_pda, mm_program.address())?;

   let expected_len = MM_LIST_HEADER_LEN
      .checked_add(number_of_mms.checked_mul(MM_LIST_ENTRY_LEN).ok_or(ProgramError::ArithmeticOverflow)?)
      .ok_or(ProgramError::ArithmeticOverflow)?;
   let new_len = expected_len
      .checked_add(MM_LIST_ENTRY_LEN).ok_or(ProgramError::ArithmeticOverflow)?;
   let new_rent = get_rent(rent_sysvar, new_len as u64)?;
   let cur_lamports = mm_list_pda.lamports();
   if new_rent > cur_lamports {
      Transfer {
         from: &mm_admin,
         to: mm_list_pda,
         lamports: new_rent - cur_lamports,
      }
      .invoke()?;
   }

   mm_list_pda.resize(new_len)?;

   let addr_off = MM_LIST_HEADER_LEN + number_of_mms * MM_LIST_ENTRY_LEN;
   let mm_addr = mm_program.address().as_ref();
   let ptr = mm_list_pda.data_mut_ptr();
   unsafe {
      write_arbitrary_bytes_unchecked(ptr, addr_off, mm_addr);
      write_u16_le_unchecked(ptr, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET, (number_of_mms + 1) as u16);
   }

   Ok(())
}
