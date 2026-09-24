use anchor_lang::prelude::*;

use crate::Withdraw;
use crate::errors::TemplateError;
use crate::instructions::token::transfer_from_config;

pub fn handler(ctx: Context<Withdraw>) -> Result<()> {
   let balance = ctx.accounts.source.amount;
   require!(balance > 0, TemplateError::EmptyVault);
   transfer_from_config(
      ctx.program_id,
      ctx.accounts.config.as_ref(),
      ctx.accounts.source.as_ref(),
      ctx.accounts.destination.as_ref(),
      ctx.accounts.token_program.as_ref(),
      balance,
   )
}
