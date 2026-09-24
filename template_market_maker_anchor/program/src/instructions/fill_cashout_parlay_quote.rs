use anchor_lang::prelude::*;

use crate::FillCashoutParlayQuote;
use crate::addr::pk_eq_addr;
use crate::checks::invoked_via_aggregator;
use crate::errors::TemplateError;
use crate::instructions::token::transfer_from_config;
use crate::wire::WireRest;
use spamm_aggregator::{
   constants::MAX_PARLAY_LEGS,
   state::{
      FillCashoutParlayQuoteIxData, MMParlayQuoteBuffer, FILL_CASHOUT_PARLAY_QUOTE_IX_DISCRIMINATOR,
   },
};

pub fn handler(ctx: Context<FillCashoutParlayQuote>, rest: WireRest) -> Result<()> {
   invoked_via_aggregator(ctx.accounts.agg_config.as_ref())?;
   let full = rest.with_disc(FILL_CASHOUT_PARLAY_QUOTE_IX_DISCRIMINATOR);
   let ix = FillCashoutParlayQuoteIxData::decode(&full).map_err(|_| ProgramError::InvalidInstructionData)?;
   let quote = {
      let buf = ctx.accounts.parlay_buffer.try_borrow_data()?;
      MMParlayQuoteBuffer::decode(buf.as_ref()).map_err(|_| ProgramError::InvalidAccountData)?
   };
   let n = quote.num_legs as usize;
   if quote.is_used != 0
      || !pk_eq_addr(ctx.accounts.user.key, &quote.user_address)
      || n < 2
      || n > MAX_PARLAY_LEGS
      || ix.amount_to_send > quote.max_amount
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
   ctx.accounts.parlay_buffer.try_borrow_mut_data()?[MMParlayQuoteBuffer::IS_USED_OFFSET] = 1;
   Ok(())
}
