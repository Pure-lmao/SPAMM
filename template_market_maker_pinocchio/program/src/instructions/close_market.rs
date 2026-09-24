use pinocchio::{account::AccountView, error::ProgramError, hint::unlikely, Address, ProgramResult};
use pinocchio_log::log;

use crate::checks::{admin_is, market_ok};
use spamm_aggregator::{
   helpers::{close_pda_return_rent, verify_signer, verify_system_program},
   state::MarketId,
};

pub const CLOSE_MARKET_IX_DISCRIMINATOR: u8 = 113;

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let market_id = MarketId::decode(data).ok_or(ProgramError::InvalidInstructionData)?;
   let [
      admin,          // `verify_signer`; `admin_is`; rent recipient
      config,         // `admin_is`
      market,         // `market_ok`
      system_program, // `verify_system_program`
   ] = accounts else {
      log!("close_market: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_signer(admin)?;
   verify_system_program(system_program)?;
   if unlikely(!admin_is(admin, config, program_id)) {
      log!("close_market: admin");
      return Err(ProgramError::IncorrectAuthority);
   }
   if unlikely(!market_ok(market, program_id, &market_id)) {
      log!("close_market: market pda");
      return Err(ProgramError::InvalidSeeds);
   }
   close_pda_return_rent(market, admin)
}
