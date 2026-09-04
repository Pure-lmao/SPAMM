//! Register an MM: create encumbrance PDA + liability ATA and append to the MM list.
//!
//! Accounts (15):
//! 0. `mm_admin` (writable signer)
//! 1. `mm_program` (readonly)
//! 2. `mm_config_pda` (readonly)
//! 3. `mm_encumbrance_pda` (writable)
//! 4. `mm_liability_token_account` (writable)
//! 5. `our_config_pda` (readonly)
//! 6. `mm_list_pda` (writable)
//! 7. `mint` (readonly)
//! 8. `token_program` (readonly)
//! 9. `associated_token_program` (readonly)
//! 10. `rent_sysvar` (readonly)
//! 11. `system_program` (readonly)
//! 12. `mm_token_account` (readonly) — ATA of the MM config PDA + mint
//! 13. `mm_quote_buffer` (readonly)
//! 14. `mm_parlay_quote_buffer` (readonly)
//!
//! Instruction data: empty.

use pinocchio::{
   AccountView, ProgramResult, Resize, address::address_eq, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_associated_token_account::instructions::Create as CreateATA;
use pinocchio_log::log;
use pinocchio_system::instructions::{CreateAccount, Transfer};

use crate::{
   ID,
   helpers::{
      find_encumbrance_pda, get_rent, ensure_mm_program_not_in_list,
      verify_associated_token_program, verify_config_pda, verify_mint, verify_mm_admin,
      verify_mm_list_pda, verify_mm_program_executable, verify_parlay_quote_buffer,
      verify_quote_buffer, verify_rent_sysvar, verify_signer, verify_system_program,
      verify_token_account, verify_token_program,
   },
   state::{
      MM_LIST_HEADER_LEN, other::{
         MM_ENCUMBRANCE_PDA_DISCRIMINATOR, MM_ENCUMBRANCE_PDA_LEN, MM_ENCUMBRANCE_PDA_SEED,
         MM_LIST_ENTRY_LEN, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET, MmEncumbrancePdaDataZc,
      }
   },
   writers::{write_arbitrary_bytes_unchecked, write_u16_le_unchecked},
};

pub const REGISTER_MM_IX_DISCRIMINATOR: u8 = 2;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
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
   verify_token_program(&token_program)?;
   verify_associated_token_program(&associated_token_program)?;
   verify_mint(&mint)?;
   verify_config_pda(&our_config_pda, false)?;
   verify_mm_list_pda(mm_list_pda)?;
   verify_token_account(true, &mm_token_account, &mm_config_pda, &mint, &token_program)?;
   let quote_buffer_valid = verify_quote_buffer(mm_quote_buffer, &mm_program);
   if unlikely(!quote_buffer_valid) {
      log!("register_mm: quote buffer is invalid");
      return Err(ProgramError::InvalidAccountData);
   }
   let parlay_quote_buffer_valid = verify_parlay_quote_buffer(mm_parlay_quote_buffer, &mm_program);
   if unlikely(!parlay_quote_buffer_valid) {
      log!("register_mm: parlay quote buffer is invalid");
      return Err(ProgramError::InvalidAccountData);
   }

   #[cfg(feature = "log")]
   log!("register_mm: verification complete");

   // register mm in the list
   let number_of_mms = ensure_mm_program_not_in_list(mm_list_pda, mm_program.address())?;

   if unlikely(mm_encumbrance_pda.data_len() != 0 || mm_encumbrance_pda.lamports() != 0) {
      log!("register_mm: mm encumbrance pda must be empty");
      return Err(ProgramError::InvalidAccountData);
   }

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

   let (expected_mm_encumbrance_pda, mm_encumbrance_pda_bump) =
      find_encumbrance_pda(mm_program.address());
   if unlikely(!address_eq(mm_encumbrance_pda.address(), &expected_mm_encumbrance_pda)) {
      log!("register_mm: mm encumbrance pda address mismatch");
      return Err(ProgramError::InvalidSeeds);
   }

   let mm_encumbrance_pda_bump_seed = [mm_encumbrance_pda_bump];
   let mm_encumbrance_pda_seeds = [
      Seed::from(MM_ENCUMBRANCE_PDA_SEED),
      Seed::from(mm_program.address().as_ref()),
      Seed::from(&mm_encumbrance_pda_bump_seed),
   ];
   let mm_encumbrance_pda_signer = Signer::from(&mm_encumbrance_pda_seeds);

   CreateAccount {
      from: mm_admin,
      to: mm_encumbrance_pda,
      lamports: get_rent(rent_sysvar, MM_ENCUMBRANCE_PDA_LEN as u64)?,
      space: MM_ENCUMBRANCE_PDA_LEN as u64,
      owner: &ID,
   }
   .invoke_signed(&[mm_encumbrance_pda_signer])?;

   unsafe {
      let p = mm_encumbrance_pda.data_mut_ptr();
      let enc = MmEncumbrancePdaDataZc {
         discriminator: MM_ENCUMBRANCE_PDA_DISCRIMINATOR.into(),
         bump: mm_encumbrance_pda_bump.into(),
         encumbrance: 0i64.into(),
      };
      core::ptr::write(p.cast::<MmEncumbrancePdaDataZc>(), enc);
   }

   // create the mm liability token account (ata of pda)
   CreateATA {
      funding_account: mm_admin,
      account: mm_liability_token_account,
      wallet: mm_encumbrance_pda,
      mint,
      token_program,
      system_program,
   }
   .invoke()?;

   Ok(())
}
