//! Create the MM market-data PDA for one promo market:
//! `["market_data", market_id_body_wire, operator]`.
//!
//! Accounts **(5)**
//! 0. `feepayer` (signer) — must match `admin` for `config_pda`
//! 1. `config_pda` (readonly) — PDA `["config"]`
//! 2. `mm_market_data_pda` (writable) — created; [`ORACLE_SIZE`](crate::state::account_oracle::ORACLE_SIZE)
//! 3. `rent_sysvar` (readonly)
//! 4. `system_program` (readonly)
//!
//! Instruction `data`: [`InitMarketIxPayload`]

use pinocchio::ProgramResult;
use pinocchio::address::address_eq;
use pinocchio::cpi::Seed;
use pinocchio::cpi::Signer;
use pinocchio::error::ProgramError;
use pinocchio::hint::unlikely;
use pinocchio::{AccountView, Address};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use spamm_aggregator::helpers::{get_rent, verify_rent_sysvar, verify_signer, verify_system_program};
use spamm_aggregator::state::{MarketId, market_id_pda_seed_parts};

use crate::constants::MM_MARKET_DATA_PDA_SEED;
use crate::constants::PROMO_MKT;
use crate::mm_helpers::{find_market_data_pda, verify_mm_config_auth};

use crate::state::InitMarketIxPayload;
use crate::state::account_oracle::{ORACLE_SIZE, init_account};


pub const INIT_MARKET_IX_DISCRIMINATOR: u8 = 111;

#[inline(never)]
pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      feepayer,
      config_pda,
      mm_market_data_pda,
      rent_sysvar,
      system_program,
   ] = accounts else {
      log!("init_market: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(feepayer)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   verify_mm_config_auth(program_id, feepayer, config_pda)?;

   if unlikely(
      mm_market_data_pda.lamports() > 0 || mm_market_data_pda.data_len() > 0,
   ) {
      log!("init_market: market data pda must be empty");
      return Err(ProgramError::InvalidAccountData);
   }

   let InitMarketIxPayload {
      market_id_bytes,
      event_start_time,
      parlay_factor: _,
      market_outcomes,
      max_amount,
      max_total_amount,
      allowed,
   } = InitMarketIxPayload::decode(data)?;

   if unlikely(market_outcomes != 2 && market_outcomes != 3) {
      log!("init_market: market outcomes must be 2 or 3");
      return Err(ProgramError::InvalidInstructionData);
   }

   let market_id = MarketId::decode(&market_id_bytes)
      .ok_or(ProgramError::InvalidInstructionData)?;
   if unlikely(market_id.mkt != PROMO_MKT) {
      log!("init_market: promo markets require mkt 9");
      return Err(ProgramError::InvalidInstructionData);
   }

   let (pda, bump) = find_market_data_pda(program_id, &market_id);
   if unlikely(!address_eq(mm_market_data_pda.address(), &pda)) {
      log!("init_market: market data pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   {
      let b = [bump];
      let (body, operator) = market_id_pda_seed_parts(&market_id_bytes);
      let signer = [
         Seed::from(MM_MARKET_DATA_PDA_SEED),
         Seed::from(body),
         Seed::from(operator),
         Seed::from(&b as &[u8]),
      ];
      let signers = [Signer::from(&signer)];
      CreateAccount {
         from: feepayer,
         to: mm_market_data_pda,
         lamports: get_rent(rent_sysvar, ORACLE_SIZE)?,
         space: ORACLE_SIZE,
         owner: program_id,
      }
      .invoke_signed(&signers)?;
   }
   unsafe {
      init_account(
         mm_market_data_pda.data_mut_ptr(),
         bump,
         event_start_time,
         market_outcomes,
         max_amount,
         max_total_amount,
         allowed,
      );
   }
   Ok(())
}
