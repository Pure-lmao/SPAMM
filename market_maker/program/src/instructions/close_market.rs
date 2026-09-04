//! Close the MM market-data PDA created in `init_market` and return rent to `auth`.
//!
//! Accounts: **(4)**
//! 0. `auth` (signer, writable) — must match `admin` for `config_pda`
//! 1. `config_pda` (readonly)
//! 2. `mm_market_data_pda` (writable)
//! 3. `system_program` (readonly)
//!
//! Instruction `data`: `market_id` wire (`MarketId::WIRE_SIZE` bytes).

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq,
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use crate::mm_helpers::{find_market_data_pda_from_wire, verify_mm_config_auth};
use crate::state::decode_close_market_wire;
use spamm_aggregator::helpers::close_pda_return_rent;
use spamm_aggregator::helpers::{verify_signer, verify_system_program};


pub const CLOSE_MARKET_IX_DISCRIMINATOR: u8 = 113;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let market_wire = decode_close_market_wire(data)?;
   let [
      auth,
      config_pda,
      mm_market_data_pda,
      system_program,
   ] = accounts else {
      log!("close_market: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(auth)?;
   verify_system_program(system_program)?;
   verify_mm_config_auth(auth, config_pda)?;

   if unlikely(!mm_market_data_pda.owned_by(program_id)) {
      log!("close_market: market data must be owned by this program");
      return Err(ProgramError::InvalidAccountData);
   }

   let (pda, _bump) = find_market_data_pda_from_wire(program_id, market_wire);
   if unlikely(!address_eq(mm_market_data_pda.address(), &pda)) {
      log!("close_market: market data pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   if unlikely(mm_market_data_pda.data_len() < 8) {
      log!("close_market: market data account too small");
      return Err(ProgramError::InvalidAccountData);
   }

   close_pda_return_rent(mm_market_data_pda, auth)
}
