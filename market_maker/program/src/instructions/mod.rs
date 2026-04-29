use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{
   init_program::INIT_PROGRAM_IX_DISCRIMINATOR,
   fill_quote::FILL_QUOTE_IX_DISCRIMINATOR, 
   get_quote::GET_QUOTE_IX_DISCRIMINATOR,
   init_event::INIT_EVENT_IX_DISCRIMINATOR,
   init_market::INIT_MARKET_IX_DISCRIMINATOR,
   close_event::CLOSE_EVENT_IX_DISCRIMINATOR,
   close_market::CLOSE_MARKET_IX_DISCRIMINATOR,
};

mod close_event;
mod close_market;
mod fill_quote;
mod get_quote;
mod init_event;
mod init_market;
mod init_program;

#[inline(never)]
pub fn dispatch(program_id: &Address, d: u8, data: &[u8], accounts: &mut [AccountView]) -> ProgramResult {
   match d {
      // Oracle hot-path discriminator `0` is handled in `lib.rs` (Doppler).
      INIT_PROGRAM_IX_DISCRIMINATOR => init_program::process(program_id, accounts, data),

      // Discriminator 2-4 are reserved for whatever SPAMM-specific instructions you want to add.

      // Aggregator CPI (`lib.rs` strips router byte): MUST match `GET_QUOTE_IX_DISCRIMINATOR` /
      // `FILL_QUOTE_IX_DISCRIMINATOR` in `spamm_aggregator`.
      GET_QUOTE_IX_DISCRIMINATOR => get_quote::process(program_id, accounts, data),
      FILL_QUOTE_IX_DISCRIMINATOR => fill_quote::process(program_id, accounts, data),

      INIT_EVENT_IX_DISCRIMINATOR => init_event::process(program_id, accounts, data),
      INIT_MARKET_IX_DISCRIMINATOR => init_market::process(program_id, accounts, data),
      CLOSE_EVENT_IX_DISCRIMINATOR => close_event::process(program_id, accounts, data),
      CLOSE_MARKET_IX_DISCRIMINATOR => close_market::process(program_id, accounts, data),

      _ => {
         log!("unknown instruction discriminator");
         Err(ProgramError::InvalidInstructionData)
      }
   }
}
