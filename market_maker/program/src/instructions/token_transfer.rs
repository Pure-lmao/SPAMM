//! Config-PDA-signed SPL transfers used by MM fill instructions.

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError,
   hint::{likely, unlikely},
};
use pinocchio_token::instructions::Transfer;

use crate::constants::MM_CONFIG_PDA;
use spamm_aggregator::{
   readers::read_u8_unchecked,
   state::{
      MM_ACCOUNT_CONFIG_SEED,
      mm_account_config::MM_CONFIG_PDA_BUMP_OFFSET,
   },
};

#[inline(never)]
pub fn transfer_mm_config_signed(
   mm_config_pda: &AccountView,
   from: &AccountView,
   to: &AccountView,
   amount: u64,
) -> ProgramResult {
   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      return Err(ProgramError::InvalidSeeds);
   }
   if likely(amount > 0) {
      let config_bump = unsafe { read_u8_unchecked(mm_config_pda.data_ptr(), MM_CONFIG_PDA_BUMP_OFFSET) };
      let bump_ref = [config_bump];
      let signer_seeds = [
         Seed::from(MM_ACCOUNT_CONFIG_SEED),
         Seed::from(&bump_ref as &[u8]),
      ];
      let signers = [Signer::from(&signer_seeds)];
      Transfer::new(from, to, mm_config_pda, amount).invoke_signed(&signers)?;
   }
   Ok(())
}
