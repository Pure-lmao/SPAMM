//! Config-PDA-signed SPL transfer.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::checks::config_ok;
use spamm_aggregator::state::{mm_account_config::MM_CONFIG_PDA_BUMP_OFFSET, MM_ACCOUNT_CONFIG_SEED};

pub fn transfer_from_config<'info>(
   program_id: &Pubkey,
   config: &AccountInfo<'info>,
   from: &AccountInfo<'info>,
   to: &AccountInfo<'info>,
   token_program: &AccountInfo<'info>,
   amount: u64,
) -> Result<()> {
   if !config_ok(config, program_id) {
      return Err(ProgramError::InvalidSeeds.into());
   }
   if amount == 0 {
      return Ok(());
   }
   let bump = config.try_borrow_data()?[MM_CONFIG_PDA_BUMP_OFFSET];
   let signer_seeds: &[&[u8]] = &[MM_ACCOUNT_CONFIG_SEED, core::slice::from_ref(&bump)];
   token::transfer(
      CpiContext::new_with_signer(
         token_program.clone(),
         Transfer {
            from: from.clone(),
            to: to.clone(),
            authority: config.clone(),
         },
         &[signer_seeds],
      ),
      amount,
   )?;
   Ok(())
}
