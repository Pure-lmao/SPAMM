use pinocchio::{
   AccountView, Address, ProgramResult, Resize, cpi::{Seed, Signer}, error::ProgramError, hint::unlikely
};
use pinocchio_associated_token_account::instructions::Create as CreateATA;
use pinocchio_log::log;
use pinocchio_system::instructions::{CreateAccount, Transfer};
use solana_address::address_eq;

use crate::{
   ID, helpers::{
      get_rent_local, verify_associated_token_program, verify_config_pda, verify_mint, verify_mm_admin, verify_mm_list_pda, verify_mm_program_executable, verify_signer, verify_system_program, verify_token_program
   }, readers::read_u16_le_unchecked, 
   state::{MM_LIST_HEADER_LEN, 
      other::{MM_ENCUMBRANCE_PDA_DISCRIMINATOR, MM_ENCUMBRANCE_PDA_LEN, MM_ENCUMBRANCE_PDA_SEED, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET, MmEncumbrancePdaDataZc},
   }, writers::{write_arbitrary_bytes_unchecked, write_u16_le_unchecked}
};

/// Accounts (11):
/// 0. `mm_admin` (writable signer)
/// 1. `mm_program` (readonly)
/// 2. `mm_config_pda` (readonly)
/// 3. `mm_encumbrance_pda` (writable)
/// 4. `mm_liability_token_account` (writable)
/// 5. `our_config_pda` (readonly)
/// 6. `mm_list_pda` (writable)
/// 7. `mint` (readonly)
/// 8. `token_program` (readonly)
/// 9. `associated_token_program` (readonly)
/// 10. `system_program` (readonly)
///
/// No instruction data after the router discriminator.

pub const REGISTER_MM_IX_DISCRIMINATOR: u8 = 2;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      mm_admin, //check for signer
      mm_program, //check for executable
      mm_config_pda, //checked in auth signer check
      mm_encumbrance_pda, //check for liability pda
      mm_liability_token_account, //check for liability token account
      our_config_pda, //check from const
      mm_list_pda, //check from const
      mint, //check from const
      token_program, //check from const
      associated_token_program, //check from const
      system_program, //check from const
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
   verify_system_program(&system_program)?;
   verify_token_program(&token_program)?;
   verify_associated_token_program(&associated_token_program)?;
   verify_system_program(system_program)?;
   verify_mint(&mint)?;
   verify_config_pda(&our_config_pda, false)?;
   verify_mm_list_pda(mm_list_pda)?;

   // register mm in the list
   let data_len = mm_list_pda.data_len();
   if unlikely(data_len < MM_LIST_HEADER_LEN) {
      log!("register_mm: mm_list data too short");
      return Err(ProgramError::InvalidAccountData);
   }

   let numbet_of_mms = unsafe { read_u16_le_unchecked(mm_list_pda.data_ptr(), MM_LIST_PDA_NUMBER_OF_MMS_OFFSET) } as usize;
   let expected_len = MM_LIST_HEADER_LEN
      .checked_add(numbet_of_mms.checked_mul(32).ok_or(ProgramError::ArithmeticOverflow)?)
      .ok_or(ProgramError::ArithmeticOverflow)?;
   if unlikely(data_len != expected_len) {
      log!("register_mm: mm_list length does not match number_of_mms");
      return Err(ProgramError::InvalidAccountData);
   }

   let new_len = expected_len
      .checked_add(32)
      .ok_or(ProgramError::ArithmeticOverflow)?;
   let new_rent = get_rent_local(new_len as u64);
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

   let addr_off = MM_LIST_HEADER_LEN + numbet_of_mms * 32;
   let mm_addr = mm_program.address().as_ref();
   let ptr = mm_list_pda.data_mut_ptr();
   unsafe {
      write_arbitrary_bytes_unchecked(ptr, addr_off, mm_addr);
      write_u16_le_unchecked(ptr, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET, (numbet_of_mms + 1) as u16);
   }

   // create the mm encumbrance pda
   if unlikely(mm_encumbrance_pda.data_len() != 0 || mm_encumbrance_pda.lamports() != 0) {
      log!("register_mm: mm liability pda must be empty");
      return Err(ProgramError::InvalidAccountData);
   }

   let (expected_mm_encumbrance_pda, mm_encumbrance_pda_bump) = Address::find_program_address(
      &[MM_ENCUMBRANCE_PDA_SEED, mm_program.address().as_ref()], 
      &ID
   );
   if unlikely(!address_eq(mm_encumbrance_pda.address(), &expected_mm_encumbrance_pda)) {
      log!("register_mm: mm liability pda address mismatch");
      return Err(ProgramError::InvalidAccountOwner);
   }

   let mm_encumbrance_pda_bump_seed = [mm_encumbrance_pda_bump];
   let mm_encumbrance_pda_seeds = [
      Seed::from(MM_ENCUMBRANCE_PDA_SEED),
      Seed::from(mm_program.address().as_ref()),
      Seed::from(&mm_encumbrance_pda_bump_seed),
   ];
   let mm_encumbrance_pda_signer = Signer::from(&mm_encumbrance_pda_seeds);
   
   CreateAccount{
      from: mm_admin,
      to: mm_encumbrance_pda,
      lamports: get_rent_local(MM_ENCUMBRANCE_PDA_LEN as u64),
      space: MM_ENCUMBRANCE_PDA_LEN as u64,
      owner: &ID,
   }.invoke_signed(&[mm_encumbrance_pda_signer])?;

   unsafe {
      let ptr = mm_encumbrance_pda.data_mut_ptr();
      let data = MmEncumbrancePdaDataZc {
         discriminator: MM_ENCUMBRANCE_PDA_DISCRIMINATOR.into(),
         bump: mm_encumbrance_pda_bump.into(),
         encumbrance: 0i64.into(),
      };
      core::ptr::write(ptr.cast::<MmEncumbrancePdaDataZc>(), data);
   }

   // create the mm liability token account (ata of pda)
   CreateATA {
      funding_account: mm_admin,
      account: mm_liability_token_account,
      wallet: mm_encumbrance_pda,
      mint,
      token_program,
      system_program,
   }.invoke()?;
   

   Ok(())
}
