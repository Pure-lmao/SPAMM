//! One-time setup: create `["config"]`, then `["mm_quote_buffer"]`, then `["mm_parlay_quote_buffer"]`,
//! then the MM collateral ATA whose **authority is the config PDA**.
//!
//! Accounts **(10)** — order matters for ATA creation:
//! 0. `feepayer` (signer)
//! 1. `config_pda` (writable, empty)
//! 2. `mm_quote_buffer_pda` (writable, empty)
//! 3. `mm_parlay_quote_buffer_pda` (writable, empty)
//! 4. `mm_token_account` (writable, empty) — ATA created with authority = config PDA
//! 5. `mint` (readonly)
//! 6. `token_program` (readonly)
//! 7. `associated_token_program` (readonly)
//! 8. `rent_sysvar` (readonly)
//! 9. `system_program` (readonly)
//!
//! Instruction `data`: [`InitProgramIxPayload`] — `admin` + `rfq_signer` (`admin` must equal `feepayer`).

use pinocchio::ProgramResult;
use pinocchio::address::address_eq;
use pinocchio::cpi::Seed;
use pinocchio::cpi::Signer;
use pinocchio::error::ProgramError;
use pinocchio::hint::unlikely;
use pinocchio::{AccountView, Address};
use pinocchio_log::log;
use pinocchio_associated_token_account::instructions::Create as CreateAssociatedTokenAccount;
use pinocchio_system::instructions::CreateAccount;

use spamm_aggregator::helpers::verify_associated_token_program;
use spamm_aggregator::helpers::{
   get_rent, verify_rent_sysvar, verify_signer, verify_system_program, verify_token_program,
};
use spamm_aggregator::state::{
   MM_ACCOUNT_CONFIG_SEED,
   MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR, MM_QUOTE_BUFFER_DISCRIMINATOR,
   MM_QUOTE_BUFFER_LEN, MM_PARLAY_QUOTE_BUFFER_LEN,
};
use spamm_aggregator::writers::write_u8_unchecked;

use crate::constants::{MM_PARLAY_QUOTE_BUFFER_SEED, MM_QUOTE_BUFFER_SEED};
use crate::state::account_config::CONFIG_DISCRIMINATOR;
use crate::state::account_config::CONFIG_SIZE;
use crate::state::account_config::Config;
use crate::state::InitProgramIxPayload;

pub const INIT_PROGRAM_IX_DISCRIMINATOR: u8 = 100;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let parsed = InitProgramIxPayload::decode(data)?;
   let [
      feepayer,
      config_pda,
      mm_quote_buffer_pda,
      mm_parlay_quote_buffer_pda,
      token_account,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
   ] = accounts else {
      log!("init_program: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(feepayer)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;

   if unlikely(!address_eq(feepayer.address(), &parsed.admin)) {
      log!("init_program: feepayer must match admin");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(
      config_pda.lamports() > 0
         || config_pda.data_len() != 0
         || mm_quote_buffer_pda.lamports() > 0
         || mm_quote_buffer_pda.data_len() != 0
         || mm_parlay_quote_buffer_pda.lamports() > 0
         || mm_parlay_quote_buffer_pda.data_len() != 0,
   ) {
      log!("init_program: pda(s) must be empty");
      return Err(ProgramError::InvalidAccountData);
   }

   let (config_addr, config_bump) = Address::find_program_address(&[MM_ACCOUNT_CONFIG_SEED], program_id);
   if unlikely(!address_eq(config_pda.address(), &config_addr)) {
      log!("init_program: config pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   let (buf_addr, buf_bump) = Address::find_program_address(&[MM_QUOTE_BUFFER_SEED], program_id);
   if unlikely(!address_eq(mm_quote_buffer_pda.address(), &buf_addr)) {
      log!("init_program: quote buffer pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   let (pbuf_addr, pbuf_bump) = Address::find_program_address(&[MM_PARLAY_QUOTE_BUFFER_SEED], program_id);
   if unlikely(!address_eq(mm_parlay_quote_buffer_pda.address(), &pbuf_addr)) {
      log!("init_program: parlay quote buffer pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   {
      let config_b = [config_bump];
      let config_signer = [
         Seed::from(MM_ACCOUNT_CONFIG_SEED),
         Seed::from(&config_b as &[u8]),
      ];
      let signers = [Signer::from(&config_signer)];

      let config_space = CONFIG_SIZE as u64;
      CreateAccount {
         from: feepayer,
         to: config_pda,
         lamports: get_rent(rent_sysvar, config_space)?,
         space: config_space,
         owner: program_id,
      }
      .invoke_signed(&signers)?;
   }

   {
      let ptr = config_pda.data_mut_ptr();
      let initial = Config {
         discriminator: CONFIG_DISCRIMINATOR,
         bump: config_bump,
         admin: parsed.admin,
         rfq_signer: parsed.rfq_signer,
         status: false,
      };
      unsafe {
         initial.write_zc_to_ptr(ptr);
      }
   }

   {
      let buf_b = [buf_bump];
      let buf_signer = [
         Seed::from(MM_QUOTE_BUFFER_SEED),
         Seed::from(&buf_b as &[u8]),
      ];
      let signers = [Signer::from(&buf_signer)];

      let buf_space = MM_QUOTE_BUFFER_LEN as u64;
      CreateAccount {
         from: feepayer,
         to: mm_quote_buffer_pda,
         lamports: get_rent(rent_sysvar, buf_space)?,
         space: buf_space,
         owner: program_id,
      }
      .invoke_signed(&signers)?;
      unsafe {
         write_u8_unchecked(
            mm_quote_buffer_pda.data_mut_ptr(),
            0,
            MM_QUOTE_BUFFER_DISCRIMINATOR,
         );
      }
   }

   {
      let pb = [pbuf_bump];
      let parlay_signer = [
         Seed::from(MM_PARLAY_QUOTE_BUFFER_SEED),
         Seed::from(&pb as &[u8]),
      ];
      let signers = [Signer::from(&parlay_signer)];

      let p_space = MM_PARLAY_QUOTE_BUFFER_LEN as u64;
      CreateAccount {
         from: feepayer,
         to: mm_parlay_quote_buffer_pda,
         lamports: get_rent(rent_sysvar, p_space)?,
         space: p_space,
         owner: program_id,
      }.invoke_signed(&signers)?;
      unsafe {
         write_u8_unchecked(
            mm_parlay_quote_buffer_pda.data_mut_ptr(),
            0,
            MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR,
         );
      }
   }

   CreateAssociatedTokenAccount {
      funding_account: feepayer,
      account: token_account,
      wallet: config_pda,
      mint,
      token_program,
      system_program,
   }
   .invoke()?;

   Ok(())
}
