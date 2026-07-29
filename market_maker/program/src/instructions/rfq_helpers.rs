//! Shared RFQ fill collateral transfer (config PDA signer → liability ATA).

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError,
   hint::{likely, unlikely},
};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::constants::MM_CONFIG_PDA;
use crate::state::FillRfqIxPayload;
use spamm_aggregator::readers::read_u8_unchecked;
use spamm_aggregator::state::MM_ACCOUNT_CONFIG_SEED;
use spamm_aggregator::state::mm_account_config::MM_CONFIG_PDA_BUMP_OFFSET;

#[inline(always)]
pub fn transfer_rfq_collateral(
   mm_config_pda: &AccountView,
   mm_token_account: &AccountView,
   liability_account: &AccountView,
   data: &[u8],
   label: &str,
) -> ProgramResult {
   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      log!("{}: mm config pda invalid", label);
      return Err(ProgramError::InvalidSeeds);
   }

   let ix_data = FillRfqIxPayload::decode(data)?;

   if likely(ix_data.amount_to_send > 0) {
      let config_bump = unsafe { read_u8_unchecked(mm_config_pda.data_ptr(), MM_CONFIG_PDA_BUMP_OFFSET) };
      let bump_ref = [config_bump];
      let signer_seeds = [
         Seed::from(MM_ACCOUNT_CONFIG_SEED),
         Seed::from(&bump_ref as &[u8]),
      ];
      let signers = [Signer::from(&signer_seeds)];

      Transfer::new(
         mm_token_account,
         liability_account,
         mm_config_pda,
         ix_data.amount_to_send,
      )
      .invoke_signed(&signers)?;
   }

   Ok(())
}
