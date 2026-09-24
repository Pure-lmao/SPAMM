use anchor_lang::prelude::*;

use crate::FillBetRfq;
use crate::checks::invoked_via_aggregator;
use crate::instructions::token::transfer_from_config;
use crate::wire::WireRest;
use spamm_aggregator::state::{FillRfqIxData, FILL_BET_RFQ_IX_DISCRIMINATOR};

pub fn handler(ctx: Context<FillBetRfq>, rest: WireRest) -> Result<()> {
   invoked_via_aggregator(ctx.accounts.agg_config.as_ref())?;
   let full = rest.with_disc(FILL_BET_RFQ_IX_DISCRIMINATOR);
   let ix = FillRfqIxData::decode(&full).map_err(|_| ProgramError::InvalidInstructionData)?;
   if ix.instruction_discriminator != FILL_BET_RFQ_IX_DISCRIMINATOR {
      return Err(ProgramError::InvalidInstructionData.into());
   }
   transfer_from_config(
      ctx.program_id,
      ctx.accounts.config.as_ref(),
      ctx.accounts.source.as_ref(),
      ctx.accounts.liability.as_ref(),
      ctx.accounts.token_program.as_ref(),
      ix.amount_to_send,
   )
   .map_err(Into::into)
}
