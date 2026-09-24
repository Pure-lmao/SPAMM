use anchor_lang::prelude::*;

use crate::InitMarket;
use crate::state::Market;
use crate::wire::MarketIdArg;

pub fn handler(ctx: Context<InitMarket>, _market_id: MarketIdArg) -> Result<()> {
   ctx.accounts.market.set_inner(Market {
      bump: ctx.bumps.market,
   });
   Ok(())
}
