use anchor_lang::prelude::*;

use crate::SetRfqSigner;

pub fn handler(ctx: Context<SetRfqSigner>) -> Result<()> {
   ctx.accounts.config.rfq_signer = *ctx.accounts.rfq_signer.key;
   Ok(())
}
