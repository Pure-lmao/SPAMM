use pinocchio::{account::AccountView, error::ProgramError, hint::unlikely, Address, ProgramResult};
use pinocchio_log::log;

use crate::checks::{admin_is, market_ok};
use spamm_aggregator::{
   helpers::verify_signer,
   state::MarketId,
};

pub const UPDATE_MARKET_IX_DISCRIMINATOR: u8 = 115;

/// Admin refresh of a market PDA. This template stores only the framework
/// header (discriminator + bump), so the instruction checks the account and
/// returns. Write any body you add after that header here.
pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let market_id = MarketId::decode(data).ok_or(ProgramError::InvalidInstructionData)?;
   let [
      admin,          // `verify_signer`; `admin_is`
      config,         // `admin_is`
      market,         // `market_ok`
   ] = accounts else {
      log!("update_market: accounts");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_signer(admin)?;
   if unlikely(!admin_is(admin, config, program_id)) {
      log!("update_market: admin");
      return Err(ProgramError::IncorrectAuthority);
   }
   if unlikely(!market_ok(market, program_id, &market_id)) {
      log!("update_market: market pda");
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(())
}
