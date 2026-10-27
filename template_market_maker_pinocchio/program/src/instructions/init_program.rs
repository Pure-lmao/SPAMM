use pinocchio::{
   account::AccountView, address::address_eq, cpi::{Seed, Signer}, error::ProgramError, hint::unlikely,
   Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use zeropod::ZeroPodFixed;

use spamm_aggregator::{
   constants::ADDRESS_LEN,
   helpers::{
      get_rent, verify_rent_sysvar, verify_signer, verify_system_program,
   },
   readers::read_address_unchecked,
   state::{
      MmAccountConfig, MmAccountConfigZc, MM_ACCOUNT_CONFIG_DISCRIMINATOR, MM_ACCOUNT_CONFIG_SEED,
      MM_CONFIG_PDA_HEADER_LEN, MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR, MM_PARLAY_QUOTE_BUFFER_LEN,
      MM_QUOTE_BUFFER_DISCRIMINATOR, MM_QUOTE_BUFFER_LEN,
   },
};

pub const INIT_PROGRAM_IX_DISCRIMINATOR: u8 = 100;
const MM_QUOTE_BUFFER_SEED: &[u8] = b"mm_quote_buffer";
const MM_PARLAY_QUOTE_BUFFER_SEED: &[u8] = b"mm_parlay_quote_buffer";

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   if unlikely(data.len() != 2 * ADDRESS_LEN) {
      log!("init_program: data len");
      return Err(ProgramError::InvalidInstructionData);
   }
   let admin = unsafe { read_address_unchecked(data.as_ptr(), 0) };
   let rfq_signer = unsafe { read_address_unchecked(data.as_ptr(), ADDRESS_LEN) };

   let [
      feepayer,                 // `verify_signer`; address equals ix admin
      config_pda,               // `Address::find_program_address` (`["config"]`); empty
      quote_buffer,             // `Address::find_program_address` (`["mm_quote_buffer"]`); empty
      parlay_buffer,            // `Address::find_program_address` (`["mm_parlay_quote_buffer"]`); empty
      rent_sysvar,              // `verify_rent_sysvar`
      system_program,           // `verify_system_program`
   ] = accounts else {
      log!("init_program: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(feepayer)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   if unlikely(!address_eq(feepayer.address(), &admin)) {
      log!("init_program: feepayer must be admin");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(
      config_pda.lamports() > 0
         || config_pda.data_len() != 0
         || quote_buffer.lamports() > 0
         || quote_buffer.data_len() != 0
         || parlay_buffer.lamports() > 0
         || parlay_buffer.data_len() != 0,
   ) {
      log!("init_program: accounts must be empty");
      return Err(ProgramError::InvalidAccountData);
   }

   let (config_addr, config_bump) = Address::find_program_address(&[MM_ACCOUNT_CONFIG_SEED], program_id);
   if unlikely(!address_eq(config_pda.address(), &config_addr)) {
      return Err(ProgramError::InvalidSeeds);
   }
   let (buf_addr, buf_bump) = Address::find_program_address(&[MM_QUOTE_BUFFER_SEED], program_id);
   if unlikely(!address_eq(quote_buffer.address(), &buf_addr)) {
      return Err(ProgramError::InvalidSeeds);
   }
   let (parlay_addr, parlay_bump) =
      Address::find_program_address(&[MM_PARLAY_QUOTE_BUFFER_SEED], program_id);
   if unlikely(!address_eq(parlay_buffer.address(), &parlay_addr)) {
      return Err(ProgramError::InvalidSeeds);
   }

   create_pda(
      feepayer,
      config_pda,
      rent_sysvar,
      program_id,
      MM_CONFIG_PDA_HEADER_LEN as u64,
      MM_ACCOUNT_CONFIG_SEED,
      config_bump,
   )?;
   {
      let mut body = config_pda.try_borrow_mut()?;
      let header = <MmAccountConfig as ZeroPodFixed>::from_bytes_mut(&mut body)
         .map_err(|_| ProgramError::InvalidAccountData)?;
      *header = MmAccountConfigZc {
         discriminator: MM_ACCOUNT_CONFIG_DISCRIMINATOR,
         bump: config_bump,
         admin,
         rfq_signer,
      };
   }

   create_pda(
      feepayer,
      quote_buffer,
      rent_sysvar,
      program_id,
      MM_QUOTE_BUFFER_LEN as u64,
      MM_QUOTE_BUFFER_SEED,
      buf_bump,
   )?;
   {
      let mut body = quote_buffer.try_borrow_mut()?;
      body[0] = MM_QUOTE_BUFFER_DISCRIMINATOR;
   }

   create_pda(
      feepayer,
      parlay_buffer,
      rent_sysvar,
      program_id,
      MM_PARLAY_QUOTE_BUFFER_LEN as u64,
      MM_PARLAY_QUOTE_BUFFER_SEED,
      parlay_bump,
   )?;
   {
      let mut body = parlay_buffer.try_borrow_mut()?;
      body[0] = MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR;
   }

   Ok(())
}

fn create_pda(
   from: &AccountView,
   to: &AccountView,
   rent: &AccountView,
   owner: &Address,
   space: u64,
   seed: &[u8],
   bump: u8,
) -> ProgramResult {
   let bump_seed = [bump];
   let signer_seeds = [
      Seed::from(seed),
      Seed::from(&bump_seed as &[u8]),
   ];
   let signers = [Signer::from(&signer_seeds)];
   CreateAccount {
      from,
      to,
      lamports: get_rent(rent, space)?,
      space,
      owner,
   }
   .invoke_signed(&signers)
}
