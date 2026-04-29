//! One-time setup: create `["config"]`, then `["mm_quote_buffer"]`, then the MM collateral ATA whose
//! **authority is the config PDA** (SPAMM framework README; matches aggregator token checks).
//!
//! Accounts **(7)** — order matters for ATA creation:
//! 0. `feepayer` (signer)
//! 1. `config_pda` (writable, empty)
//! 2. `mm_quote_buffer_pda` (writable, empty)
//! 3. `mm_token_account` (writable, empty) — ATA created with authority = config PDA
//! 4. `mint` (readonly)
//! 5. `token_program` (readonly)
//! 6. `system_program` (readonly)
//!
//! Instruction `data`: [`InitProgramIxPayload`] — `admin` pubkey (must equal `feepayer`; example policy).

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

use spamm_aggregator::helpers::{get_rent_local, verify_signer, verify_system_program, verify_token_program};
use spamm_aggregator::state::{
   MmAccountConfig, MM_ACCOUNT_CONFIG_MIN_LEN, MM_ACCOUNT_CONFIG_SEED, MM_ACCOUNT_CONFIG_DISCRIMINATOR,
   MM_QUOTE_BUFFER_LEN,
};

use crate::constants::MM_QUOTE_BUFFER_SEED;
use crate::state::InitProgramIxPayload;

pub const INIT_PROGRAM_IX_DISCRIMINATOR: u8 = 1;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let parsed = InitProgramIxPayload::decode(data)?;
   let [
      feepayer,
      config_pda,
      mm_quote_buffer_pda,
      token_account,
      mint,
      token_program,
      system_program,
   ] = accounts else {
      log!("init_program: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(feepayer)?;
   verify_system_program(system_program)?;
   verify_token_program(token_program)?;

   // Example MM: single admin pays setup; avoids arbitrary `admin` in data without that key signing.
   if unlikely(!address_eq(feepayer.address(), &parsed.admin)) {
      log!("init_program: feepayer must match admin");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(
      config_pda.lamports() > 0
         || config_pda.data_len() != 0
         || mm_quote_buffer_pda.lamports() > 0
         || mm_quote_buffer_pda.data_len() != 0,
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

   {
      let config_b = [config_bump];
      let config_signer = [
         Seed::from(MM_ACCOUNT_CONFIG_SEED),
         Seed::from(&config_b as &[u8]),
      ];
      let signers = [Signer::from(&config_signer)];

      let config_space = MM_ACCOUNT_CONFIG_MIN_LEN as u64;
      CreateAccount {
         from: feepayer,
         to: config_pda,
         lamports: get_rent_local(config_space),
         space: config_space,
         owner: program_id,
      }
      .invoke_signed(&signers)?;
   }

   {
      let mut data = config_pda.try_borrow_mut()?;
      let initial = MmAccountConfig {
         discriminator: MM_ACCOUNT_CONFIG_DISCRIMINATOR,
         bump: config_bump,
         admin: parsed.admin,
      };
      unsafe {
         core::ptr::write(data.as_mut_ptr().cast::<MmAccountConfig>(), initial);
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
         lamports: get_rent_local(buf_space),
         space: buf_space,
         owner: program_id,
      }
      .invoke_signed(&signers)?;
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
