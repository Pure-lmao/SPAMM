//! Config-PDA-signed SPL transfer.

use pinocchio::{
   account::AccountView, cpi::{Seed, Signer}, error::ProgramError, hint::unlikely, Address, ProgramResult,
};
use pinocchio_token::instructions::Transfer;

use crate::checks::config_ok;
use spamm_aggregator::{
   readers::read_u8_unchecked,
   state::{mm_account_config::MM_CONFIG_PDA_BUMP_OFFSET, MM_ACCOUNT_CONFIG_SEED},
};

#[inline(never)]
pub fn transfer_from_config(
   program_id: &Address,
   config: &AccountView,
   from: &AccountView,
   to: &AccountView,
   amount: u64,
) -> ProgramResult {
   if unlikely(!config_ok(config, program_id)) {
      return Err(ProgramError::InvalidSeeds);
   }
   if amount == 0 {
      return Ok(());
   }
   let bump = unsafe { read_u8_unchecked(config.data_ptr(), MM_CONFIG_PDA_BUMP_OFFSET) };
   let bump_seed = [bump];
   let seeds = [
      Seed::from(MM_ACCOUNT_CONFIG_SEED),
      Seed::from(&bump_seed as &[u8]),
   ];
   let signers = [Signer::from(&seeds)];
   Transfer::new(from, to, config, amount).invoke_signed(&signers)
}
