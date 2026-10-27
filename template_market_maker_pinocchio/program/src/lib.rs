#![no_std]

pub mod constants;
pub mod instructions;
pub mod price;

mod checks;

pub use constants::ID;

use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

pinocchio::nostd_panic_handler!();

#[cfg(feature = "bpf-entrypoint")]
mod bpf_entrypoint {
   use pinocchio::{AccountView, Address, ProgramResult};

   pinocchio::program_entrypoint!(process_instruction);

   fn process_instruction(
      program_id: &Address,
      accounts: &mut [AccountView],
      instruction_data: &[u8],
   ) -> ProgramResult {
      super::dispatch(program_id, accounts, instruction_data)
   }
}

pub fn dispatch(
   program_id: &Address,
   accounts: &mut [AccountView],
   instruction_data: &[u8],
) -> ProgramResult {
   let Some((discriminator, data)) = instruction_data.split_first() else {
      log!("instruction data empty");
      return Err(ProgramError::InvalidInstructionData);
   };
   instructions::dispatch(program_id, *discriminator, data, instruction_data, accounts)
}
