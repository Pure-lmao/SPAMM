use anchor_lang::prelude::*;

use crate::InitProgram;
use crate::state::{Config, QuoteBuffer};
use spamm_aggregator::state::MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR;

pub fn handler(ctx: Context<InitProgram>, admin: Pubkey, rfq_signer: Pubkey) -> Result<()> {
   ctx.accounts.config.set_inner(Config {
      bump: ctx.bumps.config,
      admin,
      rfq_signer,
   });
   ctx.accounts.quote_buffer.set_inner(QuoteBuffer::default());
   ctx.accounts.parlay_buffer.try_borrow_mut_data()?[0] = MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR;
   Ok(())
}
