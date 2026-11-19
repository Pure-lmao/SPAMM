use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::{log};
use crate::helpers::verify_signer;

pub const MESSAGE_IX_DISCRIMINATOR: u8 = 220;

pub fn process(accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
   let [market_operator] = accounts else {
      log!("message: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   verify_signer(market_operator)?;
   Ok(())
}