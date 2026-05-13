use pinocchio::{
   AccountView, Address, ProgramResult, Resize, address::address_eq, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_associated_token_account::instructions::Create as CreateATA;
use pinocchio_log::log;
use pinocchio_system::instructions::{CreateAccount, Transfer};

use crate::{
   ID,
   alt_ix::cpi_extend_lookup_table,
   constants::CONFIG_PDA_SEED,
   helpers::{
      get_rent_local, verify_address_lookup_table_program, verify_associated_token_program, verify_config_pda, verify_lookup_table, verify_mint, verify_mm_admin, verify_mm_list_pda, verify_mm_program_executable, verify_parlay_quote_buffer, verify_quote_buffer, verify_signer, verify_system_program, verify_token_account, verify_token_program
   },
   readers::{read_u16_le_unchecked},
   state::{
      MM_LIST_HEADER_LEN, other::{
         MM_ENCUMBRANCE_PDA_DISCRIMINATOR, MM_ENCUMBRANCE_PDA_LEN, MM_ENCUMBRANCE_PDA_SEED,
         MM_LIST_PDA_NUMBER_OF_MMS_OFFSET, MmEncumbrancePdaDataZc,
      }
   },
   writers::{write_arbitrary_bytes_unchecked, write_u16_le_unchecked},
};

/// Accounts (13):
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
/// 11. `lookup_table` (writable) — aggregator ALT from config
/// 12. `mm_token_account` (readonly) — MM token account (`mm_admin` + `mint`)
/// 13. `mm_quote_buffer` (readonly) — MM quote buffer PDA
/// 14. `mm_parlay_quote_buffer` (readonly) — MM parlay quote buffer PDA
///
/// Data: recent_slot (u64) — LE - must be a recent slot for the ALT program to use

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
      system_program,
      lookup_table,
      lookup_table_program,
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
   verify_system_program(&system_program)?;
   verify_token_program(&token_program)?;
   verify_associated_token_program(&associated_token_program)?;
   verify_mint(&mint)?;
   verify_config_pda(&our_config_pda, false)?;
   verify_mm_list_pda(mm_list_pda)?;
   verify_token_account(true, &mm_token_account, &mm_config_pda, &mint, &token_program)?;
   verify_address_lookup_table_program(&lookup_table_program)?;
   verify_lookup_table(lookup_table)?;
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
   let data_len = mm_list_pda.data_len();
   if unlikely(data_len < MM_LIST_HEADER_LEN) {
      log!("register_mm: mm_list data too short");
      return Err(ProgramError::InvalidAccountData);
   }

   let number_of_mms = unsafe { read_u16_le_unchecked(mm_list_pda.data_ptr(), MM_LIST_PDA_NUMBER_OF_MMS_OFFSET) } as usize;
   let expected_len = MM_LIST_HEADER_LEN
      .checked_add(number_of_mms.checked_mul(32).ok_or(ProgramError::ArithmeticOverflow)?)
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

   let addr_off = MM_LIST_HEADER_LEN + number_of_mms * 32;
   let mm_addr = mm_program.address().as_ref();
   let ptr = mm_list_pda.data_mut_ptr();
   unsafe {
      write_arbitrary_bytes_unchecked(ptr, addr_off, mm_addr);
      write_u16_le_unchecked(ptr, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET, (number_of_mms + 1) as u16);
   }

   // create the mm encumbrance pda
   if unlikely(mm_encumbrance_pda.data_len() != 0 || mm_encumbrance_pda.lamports() != 0) {
      log!("register_mm: mm liability pda must be empty");
      return Err(ProgramError::InvalidAccountData);
   }

   let (expected_mm_encumbrance_pda, mm_encumbrance_pda_bump) = Address::find_program_address(
      &[MM_ENCUMBRANCE_PDA_SEED, mm_program.address().as_ref()],
      &ID,
   );
   if unlikely(!address_eq(mm_encumbrance_pda.address(), &expected_mm_encumbrance_pda)) {
      log!("register_mm: mm liability pda address mismatch");
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
      lamports: get_rent_local(MM_ENCUMBRANCE_PDA_LEN as u64),
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

   // add mm accounts to the lookup table
   let (_, config_bump) = Address::find_program_address(&[CONFIG_PDA_SEED], &ID);

   #[cfg(feature = "log")]
   log!("register_mm: config bump: {}", config_bump);

   let config_bump_seed = &[config_bump];
   let config_signer_seeds: [Seed<'_>; 2] = [
      Seed::from(CONFIG_PDA_SEED),
      Seed::from(config_bump_seed),
   ];
   let config_signer = Signer::from(&config_signer_seeds);

   let extend_addresses: [Address; 7] = [
      *mm_program.address(),
      *mm_config_pda.address(),
      *mm_quote_buffer.address(),
      *mm_parlay_quote_buffer.address(),
      *mm_encumbrance_pda.address(),
      *mm_token_account.address(),
      *mm_liability_token_account.address(),
   ];
   #[cfg(feature = "log")]
   log!("register_mm: cpi start");

   cpi_extend_lookup_table(
      lookup_table,
      our_config_pda,
      mm_admin,
      system_program,
      &extend_addresses,
      config_signer,
   )?;

   Ok(())
}
