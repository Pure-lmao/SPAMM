use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_log::log;

mod close_prediction;
mod create_prediction;
mod force_close_pda;

pub use close_prediction::CLOSE_PREDICTION_IX_DISCRIMINATOR;
pub use create_prediction::CREATE_PREDICTION_IX_DISCRIMINATOR;

#[inline(never)]
pub fn dispatch(d: u8, data: &[u8], accounts: &mut [AccountView]) -> ProgramResult {
   match d {
      CREATE_PREDICTION_IX_DISCRIMINATOR => create_prediction::process(accounts, data),
      CLOSE_PREDICTION_IX_DISCRIMINATOR => close_prediction::process(accounts),
      
      255 => force_close_pda::process(accounts),
      _ => {
         log!("unknown instruction discriminator: {}", d);
         Err(ProgramError::InvalidInstructionData)
      }
   }
}
