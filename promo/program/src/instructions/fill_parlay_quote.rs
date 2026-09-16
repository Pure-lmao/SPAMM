//! Promo MM does not offer parlays — reject fill.

use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError};
use pinocchio_log::log;

pub use spamm_aggregator::state::FILL_QUOTE_PARLAY_IX_DISCRIMINATOR;

pub fn process(_program_id: &Address, _accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
   log!("fill_parlay_quote: parlays not supported on promo MM");
   Err(ProgramError::InvalidInstructionData)
}
