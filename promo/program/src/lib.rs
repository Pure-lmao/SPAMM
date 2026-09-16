#![no_std]
#![cfg_attr(target_os = "solana", feature(asm_experimental_arch))]

pub mod constants;
pub mod instructions;
mod mm_helpers;
pub mod state;

use core::{
   mem::MaybeUninit,
   slice::from_raw_parts_mut,
};

use pinocchio::{
   MAX_TX_ACCOUNTS, ProgramResult, account::AccountView, entrypoint::deserialize, error::ProgramError
};
use pinocchio_log::log;

pub use constants::ID;

pinocchio::no_allocator!();

#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
   match deserialize_and_route(input) {
      Ok(()) => 0,
      Err(e) => e.into()
   }
}

unsafe fn deserialize_and_route(input: *mut u8) -> ProgramResult {
   const UNINIT: MaybeUninit<AccountView> = MaybeUninit::<AccountView>::uninit();
   let mut account_storage = [UNINIT; MAX_TX_ACCOUNTS];
   let (program_id, count, instruction_data) =
      unsafe { deserialize::<MAX_TX_ACCOUNTS>(input, &mut account_storage) };
   let Some((discriminator, parsed_data)) = instruction_data.split_first() else {
      log!("instruction data empty");
      return Err(ProgramError::InvalidInstructionData);
   };
   let accounts = unsafe { from_raw_parts_mut(account_storage.as_mut_ptr() as *mut AccountView, count) };
   instructions::dispatch(program_id, *discriminator, parsed_data, accounts)
}
