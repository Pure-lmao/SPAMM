//! Close the MM market-data PDA created in `init_market` and return rent to `auth`.
//!
//! Accounts: **(4)** — same ordering as `init_market`
//! 0. `auth` (signer, writable) — must match `admin` for `config_pda`
//! 1. `config_pda` (readonly)
//! 2. `mm_market_data_pda` (writable)
//! 3. `system_program` (readonly)
//!
//! Instruction `data`: `market_id` wire (`MarketId::WIRE_SIZE` bytes), same PDA derivation as
//! `init_market` (`oracle_body` is not used; extra trailing bytes are ignored).

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq,
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use spamm_aggregator::state::MarketId;

use spamm_aggregator::helpers::{verify_signer, verify_system_program};

use crate::mm_helpers::{close_pda_return_rent, find_market_data_pda, verify_mm_config_auth};
use crate::state::InitMarketIxPayload;


pub const CLOSE_MARKET_IX_DISCRIMINATOR: u8 = 10;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let InitMarketIxPayload { market_id, oracle_body: _ } = InitMarketIxPayload::decode(data)?;
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

   let (pda, _bump) = find_market_data_pda(program_id, &market_id);
   if unlikely(!address_eq(mm_market_data_pda.address(), &pda)) {
      log!("close_market: market data pda invalid");
      return Err(ProgramError::InvalidSeeds);
   }

   if unlikely(mm_market_data_pda.data_len() < 8) {
      log!("close_market: market data account too small");
      return Err(ProgramError::InvalidAccountData);
   }

   let mut market_wire = [0u8; MarketId::WIRE_SIZE];
   let zc = market_id.to_zc();
   unsafe {
      core::ptr::write(market_wire.as_mut_ptr().cast(), zc);
   }

   close_pda_return_rent(mm_market_data_pda, auth)
}
