//! Create the MM oracle PDA for one market: `["oracle", market_id_wire]` with `MarketId` wire bytes (`to_zc`).
//!
//! On-chain account layout: **`[u64 sequence LE][oracle_body]`** — the first 8 bytes are a monotonic
//! sequence (Doppler / off-chain tools may bump it); `get_quote` reads odds from `oracle_body` at
//! offset **8** (2 or 3 × `u32` LE, see `get_quote`).
//!
//! Accounts **(4)**
//! 0. `feepayer` (signer) — must match `admin` for `config_pda`
//! 1. `config_pda` (readonly) — PDA `["config"]`
//! 2. `mm_oracle_pda` (writable) — created; space `8 + oracle_body.len()`
//! 3. `system_program` (readonly)
//!
//! Instruction `data`: [`InitMarketIxPayload`] — `market_id` + `oracle_body`.

use pinocchio::ProgramResult;
use pinocchio::address::address_eq;
use pinocchio::cpi::Seed;
use pinocchio::cpi::Signer;
use pinocchio::error::ProgramError;
use pinocchio::hint::unlikely;
use pinocchio::{AccountView, Address};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use spamm_aggregator::state::MarketId;

use spamm_aggregator::helpers::get_rent_local;
use spamm_aggregator::helpers::{verify_signer, verify_system_program};
use spamm_aggregator::writers::write_arbitrary_bytes_unchecked;

use crate::mm_helpers::{find_oracle_pda, verify_mm_config_auth};

use crate::constants::ORACLE_SEED;
use crate::state::InitMarketIxPayload;


pub const INIT_MARKET_IX_DISCRIMINATOR: u8 = 8;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let InitMarketIxPayload { market_id, oracle_body } = InitMarketIxPayload::decode(data)?;
   let [
      feepayer,
      config_pda,
      mm_oracle_pda,
      system_program,
   ] = accounts else {
      log!("init_market: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(feepayer)?;
   verify_system_program(system_program)?;
   verify_mm_config_auth(feepayer, config_pda, program_id)?;

   if unlikely(
      mm_oracle_pda.lamports() > 0 || mm_oracle_pda.data_len() > 0,
   ) {
      log!("init_market: oracle pda must be empty");
      return Err(ProgramError::InvalidAccountData);
   }

   let (pda, bump) = find_oracle_pda(program_id, &market_id);
   if unlikely(!address_eq(mm_oracle_pda.address(), &pda)) {
      log!("init_market: oracle pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   let body_len: u64 = u64::try_from(oracle_body.len()).map_err(|_| {
      log!("init_market: body length");
      ProgramError::InvalidInstructionData
   })?;
   let oracle_space: u64 = 10u64
      .checked_add(body_len)
      .ok_or(ProgramError::InvalidInstructionData)?;

   {
      let b = [bump];
      let mut market_wire = [0u8; MarketId::WIRE_SIZE];
      let zc = market_id.to_zc(true);
      unsafe {
         core::ptr::write(market_wire.as_mut_ptr().cast(), zc);
      }
      let signer = [
         Seed::from(ORACLE_SEED),
         Seed::from(market_wire.as_slice()),
         Seed::from(&b as &[u8]),
      ];
      let signers = [Signer::from(&signer)];
      CreateAccount {
         from: feepayer,
         to: mm_oracle_pda,
         lamports: get_rent_local(oracle_space),
         space: oracle_space,
         owner: program_id,
      }
      .invoke_signed(&signers)?;
   }
   unsafe {
      let ptr = mm_oracle_pda.data_mut_ptr();
      let disc_bump_seq = [
         0,
         bump, 
         0, 0, 0, 0, 0, 0, 0, 0
      ]; //0u8 disc, u8 bump, 0u64 sequence
      write_arbitrary_bytes_unchecked(ptr, 0, &disc_bump_seq);
      if body_len > 0 {
         write_arbitrary_bytes_unchecked(ptr, 10, &oracle_body);
      }
   }
   Ok(())
}
