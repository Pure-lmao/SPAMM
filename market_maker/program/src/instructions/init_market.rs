//! Create the MM market-data PDA for one market: `["market_data", market_id_wire]` with `MarketId` wire bytes (`to_zc`).
//!
//! On-chain account layout: **`[u8 disc][u8 bump][u8; 2 pad][u32 sequence LE][oracle_body]`** —
//! `get_quote` reads odds from `oracle_body` at offset **8** (2 or 3 × `u32` LE, see `get_quote`).
//!
//! Accounts **(4)**
//! 0. `feepayer` (signer) — must match `admin` for `config_pda`
//! 1. `config_pda` (readonly) — PDA `["config"]`
//! 2. `mm_market_data_pda` (writable) — created; space `8 + oracle_body.len()` (8-byte header + body)
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

use spamm_aggregator::helpers::{verify_signer, verify_system_program, get_rent_local};
use spamm_aggregator::writers::write_arbitrary_bytes_unchecked;

use crate::constants::MM_MARKET_DATA_PDA_SEED;
use crate::mm_helpers::{find_market_data_pda, verify_mm_config_auth};

use crate::state::InitMarketIxPayload;


pub const INIT_MARKET_IX_DISCRIMINATOR: u8 = 8;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let InitMarketIxPayload { market_id, oracle_body } = InitMarketIxPayload::decode(data)?;
   let [
      feepayer,
      config_pda,
      mm_market_data_pda,
      system_program,
   ] = accounts else {
      log!("init_market: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(feepayer)?;
   verify_system_program(system_program)?;
   verify_mm_config_auth(feepayer, config_pda, program_id)?;

   if unlikely(
      mm_market_data_pda.lamports() > 0 || mm_market_data_pda.data_len() > 0,
   ) {
      log!("init_market: market data pda must be empty");
      return Err(ProgramError::InvalidAccountData);
   }

   let (pda, bump) = find_market_data_pda(program_id, &market_id);
   if unlikely(!address_eq(mm_market_data_pda.address(), &pda)) {
      log!("init_market: market data pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   let body_len: u64 = u64::try_from(oracle_body.len()).map_err(|_| {
      log!("init_market: body length");
      ProgramError::InvalidInstructionData
   })?;
   let oracle_space: u64 = 6u64
      .checked_add(body_len)
      .ok_or(ProgramError::InvalidInstructionData)?;
   log!("init_market: oracle space: {}", oracle_space);
   {
      let b = [bump];
      let mut market_wire = [0u8; MarketId::WIRE_SIZE];
      let zc = market_id.to_zc();
      unsafe {
         core::ptr::write(market_wire.as_mut_ptr().cast(), zc);
      }
      let signer = [
         Seed::from(MM_MARKET_DATA_PDA_SEED),
         Seed::from(market_wire.as_slice()),
         Seed::from(&b as &[u8]),
      ];
      let signers = [Signer::from(&signer)];
      CreateAccount {
         from: feepayer,
         to: mm_market_data_pda,
         lamports: get_rent_local(oracle_space),
         space: oracle_space,
         owner: program_id,
      }
      .invoke_signed(&signers)?;
   }
   unsafe {
      let ptr = mm_market_data_pda.data_mut_ptr();
      let header = [
         0u8,    // discriminator
         bump,
         0, 0, 0, 0, // u32 sequence LE = 0
      ];
      write_arbitrary_bytes_unchecked(ptr, 0, &header);
      if body_len > 0 {
         write_arbitrary_bytes_unchecked(ptr, 6, &oracle_body);
      }
   }
   Ok(())
}
