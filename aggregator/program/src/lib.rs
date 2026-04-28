#![no_std]

pub mod constants;
pub mod instructions;
pub mod parsers;
pub mod helpers;
pub mod readers;
pub mod writers;
pub mod state;

use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_log::log;

pub use constants::ID;
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

#[cfg(feature = "bpf-entrypoint")]
mod bpf_entrypoint {
   use pinocchio::{AccountView, Address, ProgramResult};
   use super::process_instruction as route_instruction;

   pinocchio::program_entrypoint!(process_instruction);
   pinocchio::no_allocator!();
   pinocchio::nostd_panic_handler!();

   fn process_instruction(
      _program_id: &Address,
      accounts: &mut [AccountView],
      instruction_data: &[u8],
   ) -> ProgramResult {
      route_instruction(accounts, instruction_data)
   }
}
