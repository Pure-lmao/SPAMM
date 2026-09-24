use anchor_lang::prelude::*;

use crate::CloseMarket;
use crate::wire::MarketIdArg;

pub fn handler(_ctx: Context<CloseMarket>, _market_id: MarketIdArg) -> Result<()> {
   Ok(())
}
