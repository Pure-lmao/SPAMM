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

use doppler;

pinocchio::no_allocator!();

#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
   // Oracle refresh: same `Instruction` the TS SDK builds (`getUpdateOracleIx`, see `market_maker/client/admin.ts`
   // `updateOracle`): MM program id, accounts `[admin signer, market_data writable]`, data `0u8 || u32 seq LE ||
   // 3×u32 odds LE` (third odds `0` on two-outcome markets). Handled here via Doppler on the VM input buffer
   // before `deserialize_and_route`; not routed through `instructions::dispatch`.
   if doppler::read::<u64>(input, 0) == 0x2 {
      doppler::prelude::Admin::check(input);
      doppler::prelude::Oracle::<[u32; 3]>::check_and_update(input);
      return 0;
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
