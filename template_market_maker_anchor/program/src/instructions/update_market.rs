use anchor_lang::prelude::*;

use crate::UpdateMarket;
use crate::wire::MarketIdArg;

pub fn handler(_ctx: Context<UpdateMarket>, _market_id: MarketIdArg) -> Result<()> {
   Ok(())
}
