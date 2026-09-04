#![no_std]

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod helpers;
pub mod quote_result;
pub mod readers;
pub mod rfq_verify;
pub mod writers;
pub mod state;

pub use errors::SpammError;
pub use helpers::parlay_helpers;
pub use quote_result::{quote_ok, QuoteResult};

use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_log::log;

pub use constants::{ADDRESS_LEN, ID, U32_LEN, U64_LEN};
/// Shared instruction router (used by the BPF entrypoint and tooling).
#[inline(never)]
pub fn process_instruction(
   accounts: &mut [AccountView],
   instruction_data: &[u8],
) -> ProgramResult {
   let Some((discriminator, data)) = instruction_data.split_first() else {
      log!("instruction data empty");
      return Err(ProgramError::InvalidInstructionData);
   };
   instructions::dispatch(*discriminator, data, accounts)
}

pinocchio::nostd_panic_handler!();

#[cfg(feature = "bpf-entrypoint")]
mod bpf_entrypoint {
   use pinocchio::{AccountView, Address, ProgramResult};
   use super::process_instruction as route_instruction;

   pinocchio::program_entrypoint!(process_instruction);
   pinocchio::no_allocator!();

   fn process_instruction(
      _program_id: &Address,
      accounts: &mut [AccountView],
      instruction_data: &[u8],
   ) -> ProgramResult {
      route_instruction(accounts, instruction_data)
   }
}

