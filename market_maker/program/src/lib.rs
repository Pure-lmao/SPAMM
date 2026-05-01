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
   account::AccountView,
   entrypoint::deserialize,
   error::ProgramError,
   ProgramResult, MAX_TX_ACCOUNTS,
};
use pinocchio_log::log;

pub use constants::ID;

const UPDATE_ORACLE_IX_DISCRIMINATOR: u8 = 0;

pinocchio::no_allocator!();

#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
   if unsafe { doppler::read::<u64>(input, 0) } == 0x2 {
      let account_data_len = unsafe { doppler::read::<u64>(input, 0x28B8) };
      let instruction_offset =
         ((0x28c0 + account_data_len as usize + 0x2800 + 0x7) & !0x7) + 0x10;

      if unsafe { doppler::read::<u8>(input, instruction_offset) } == UPDATE_ORACLE_IX_DISCRIMINATOR {
         let instruction_len =
            unsafe { doppler::read::<u64>(input, instruction_offset - 8) } as usize;
         let oracle_data_size = instruction_len - 5;
         let instruction_sequence_offset = instruction_offset + 0x1;

         doppler::prelude::Admin::check(input);
         doppler::prelude::Oracle::check_and_update(
            oracle_data_size,
            instruction_sequence_offset,
            input,
         );
         return 0;
      }
   }

   match deserialize_and_route(input) {
      Ok(()) => 0,
      Err(e) => e.into()
   }
}

unsafe fn deserialize_and_route(input: *mut u8) -> ProgramResult {
   // Same layout and logic as `pinocchio::entrypoint::process_entrypoint`: `AccountView`s
   // reference `RuntimeAccount` in the SVM input buffer, not `solana_program::AccountInfo`.
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
