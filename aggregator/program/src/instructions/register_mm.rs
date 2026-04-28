use pinocchio::{
   AccountView, Address, ProgramResult, Resize, cpi::{Seed, Signer}, error::ProgramError, hint::unlikely
};
use pinocchio_token::instructions::InitializeAccount3;
use pinocchio_log::log;
use pinocchio_system::instructions::{CreateAccount, Transfer};

use crate::{
   helpers::{
      TOKEN_ACCOUNT_LEN, get_rent_local, verify_config_pda, verify_mint, verify_mm_auth_signer, verify_mm_list_pda, verify_mm_program_executable, verify_signer, verify_system_program, verify_token_account, verify_token_program
   }, readers::read_u16_le_unchecked, state::{MM_LIST_HEADER_LEN, other::{LIABILITY_TOKEN_ACCOUNT_SEED, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET}}, writers::{write_arbitrary_bytes_unchecked, write_u16_le_unchecked}
};

/// Accounts (9):
/// 0. `mm_auth_signer` (writable signer)
/// 1. `mm_program` (readonly)
/// 2. `mm_config_pda` (readonly)
/// 3. `mm_liability_token_account` (writable)
/// 4. `our_config_pda` (readonly)
/// 5. `mm_list_pda` (writable) — registry of MM program ids (see [`MM_LIST_HEADER_LEN`])
/// 6. `token_program` (readonly)
/// 7. `mint` (readonly)
/// 8. `system_program` (readonly)
///
/// No instruction data after the router discriminator.

pub const REGISTER_MM_IX_DISCRIMINATOR: u8 = 2;

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      mm_auth_signer, //check for signer
      mm_program, //check for executable
      mm_config_pda, //check for config pda from seed
      mm_liability_token_account, //check for liability token account
      our_config_pda, //check from const
      mm_list_pda, //check from const
      token_program, //check from const
      mint, //check from const
      system_program, //check from const
   ] = accounts else {
      log!("register_mm: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if unlikely(!data.is_empty()) {
      log!("register_mm: instruction data must be empty");
      return Err(ProgramError::InvalidInstructionData);
   }

   verify_signer(&mm_auth_signer)?;
   verify_mm_program_executable(&mm_program)?;
   verify_mm_auth_signer(&mm_auth_signer, &mm_program, mm_config_pda)?;
   verify_system_program(&system_program)?;
   verify_token_program(&token_program)?;
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
         from: &mm_auth_signer,
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

   // create the mm token account
   if unlikely(mm_liability_token_account.lamports() > 0 || mm_liability_token_account.data_len() != 0) {
      log!("register_mm: mm token account must be uninitialized");
      return Err(ProgramError::InvalidAccountData);
   }

   let seeds = [
      LIABILITY_TOKEN_ACCOUNT_SEED,
      mm_program.address().as_ref(),
      mint.address().as_ref(),
   ];
   let (_expected_pda, bump) = Address::find_program_address(
      &seeds,
      &token_program.address()
   );

   let bump_seed = &[bump];
   let signer_seeds = [
      Seed::from(LIABILITY_TOKEN_ACCOUNT_SEED),
      Seed::from(mm_program.address().as_ref()),
      Seed::from(mint.address().as_ref()),
      Seed::from(bump_seed),
   ];

   let signer = &[Signer::from(&signer_seeds)];

   CreateAccount {
      from: &mm_auth_signer,
      to: &mm_liability_token_account,
      lamports: get_rent_local(TOKEN_ACCOUNT_LEN as u64),
      space: TOKEN_ACCOUNT_LEN as u64,
      owner: &token_program.address(),
   }.invoke_signed(signer)?;

   InitializeAccount3::new(
      &mm_liability_token_account, 
      &mint, 
      &our_config_pda.address()
   ).invoke()?;

   verify_token_account(true, 
      &mm_liability_token_account,
      &our_config_pda,
      &mint,
      &token_program
   )?;

   Ok(())
}
