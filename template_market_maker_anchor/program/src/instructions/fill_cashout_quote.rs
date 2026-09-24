use anchor_lang::prelude::*;

use crate::FillCashoutQuote;
use crate::checks::invoked_via_aggregator;
use crate::errors::TemplateError;
use crate::instructions::token::transfer_from_config;
use crate::wire::WireRest;
use spamm_aggregator::state::{FillCashoutQuoteIxData, FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR};

pub fn handler(ctx: Context<FillCashoutQuote>, rest: WireRest) -> Result<()> {
   invoked_via_aggregator(ctx.accounts.agg_config.as_ref())?;
   let full = rest.with_disc(FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR);
   let ix = FillCashoutQuoteIxData::decode(&full).map_err(|_| ProgramError::InvalidInstructionData)?;
   let quote = &mut ctx.accounts.quote_buffer;
   if quote.is_used != 0 || quote.user != *ctx.accounts.user.key {
      return Err(TemplateError::QuoteMismatch.into());
   }
   if !quote.market_id.same(&ix.market_id)
      || quote.side != ix.side
      || ix.amount_to_send > quote.max_amount
      || quote.sequence != ix.event_state_sequence
      || !quote.game_state.same(&ix.event_game_state)
   {
      return Err(TemplateError::QuoteMismatch.into());
   }
   transfer_from_config(
      ctx.program_id,
      ctx.accounts.config.as_ref(),
      ctx.accounts.source.as_ref(),
      ctx.accounts.payment_dest.as_ref(),
      ctx.accounts.token_program.as_ref(),
      ix.amount_to_send,
   )?;
   quote.is_used = 1;
   Ok(())
}
