//! Create the MM market-data PDA for one market: `["market_data", market_id_body_wire, operator]`.
//!
//! On-chain account layout: **`[u8 disc][u8 bump][u32 sequence LE][oracle_body padded to ≥12]`** —
//! `get_quote` reads odds from `oracle_body` at offset **6** (2 or 3 × `u32` LE;
//! `mkt` 1 or 5 is **home, away, draw**).
//!
//! Accounts **(5)**
//! 0. `feepayer` (signer) — must match `admin` for `config_pda`
//! 1. `config_pda` (readonly) — PDA `["config"]`
//! 2. `mm_market_data_pda` (writable) — created; space `6 + max(oracle_body.len(), 12)`
//! 3. `rent_sysvar` (readonly)
//! 4. `system_program` (readonly)
//!
//! Instruction `data`: [`InitMarketIxPayload`] — `market_id` + `oracle_body`.

use pinocchio::{
   AccountView, Address, ProgramResult,
   address::address_eq,
   cpi::{Seed, Signer},
   error::ProgramError,
   hint::unlikely,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
   constants::MM_MARKET_DATA_PDA_SEED,
   mm_helpers::{find_market_data_pda, verify_mm_config_auth},
   state::InitMarketIxPayload,
};
use spamm_aggregator::{
   helpers::{get_rent, verify_rent_sysvar, verify_signer, verify_system_program},
   state::{MarketId, MM_MARKET_DATA_PDA_DISCRIMINATOR, market_id_pda_seed_parts},
   writers::write_arbitrary_bytes_unchecked,
};


pub const INIT_MARKET_IX_DISCRIMINATOR: u8 = 111;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let InitMarketIxPayload { market_id, oracle_body } = InitMarketIxPayload::decode(data)?;
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
   verify_mm_config_auth(feepayer, config_pda)?;

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

   let body_len_usize = oracle_body.len();
   let body_len: u64 = u64::try_from(body_len_usize).map_err(|_| {
      log!("init_market: body length");
      ProgramError::InvalidInstructionData
   })?;
   let stored_body_len: u64 = core::cmp::max(body_len, 12);
   let oracle_space: u64 = 6u64
      .checked_add(stored_body_len).ok_or(ProgramError::InvalidInstructionData)?;
   log!("init_market: oracle space: {}", oracle_space);
   {
      let b = [bump];
      let mut market_wire = [0u8; MarketId::WIRE_SIZE];
      let zc = market_id.to_zc();
      unsafe {
         core::ptr::write(market_wire.as_mut_ptr().cast(), zc);
      }
      let (body, operator) = market_id_pda_seed_parts(&market_wire);
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
         lamports: get_rent(rent_sysvar, oracle_space)?,
         space: oracle_space,
         owner: program_id,
      }
      .invoke_signed(&signers)?;
   }
   unsafe {
      let ptr = mm_market_data_pda.data_mut_ptr();
      let header = [
         MM_MARKET_DATA_PDA_DISCRIMINATOR,
         bump,
         0, 0, 0, 0, // u32 sequence LE = 0
      ];
      write_arbitrary_bytes_unchecked(ptr, 0, &header);
      if body_len_usize > 0 {
         write_arbitrary_bytes_unchecked(ptr, 6, &oracle_body);
      }
      if body_len_usize < 12 {
         let pad = [0u8; 12];
         write_arbitrary_bytes_unchecked(ptr, 6 + body_len_usize, &pad[..12 - body_len_usize]);
      }
   }
   Ok(())
}
