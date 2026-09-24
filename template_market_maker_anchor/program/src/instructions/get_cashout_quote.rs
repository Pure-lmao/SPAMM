use anchor_lang::prelude::*;

use crate::GetCashoutQuote;
use crate::checks::{config_ok, event_ok, market_ok, quote_buffer_ok};
use crate::price;
use crate::state::{store_quote, GameStateWire, MarketIdWire, QuoteBuffer};
use crate::wire::WireRest;
use spamm_aggregator::state::{GetCashoutQuoteIxData, GET_CASHOUT_QUOTE_IX_DISCRIMINATOR};

pub fn handler(ctx: Context<GetCashoutQuote>, rest: WireRest) -> Result<u64> {
   let full = rest.with_disc(GET_CASHOUT_QUOTE_IX_DISCRIMINATOR);
   let Ok(ix) = GetCashoutQuoteIxData::decode(&full) else {
      msg!("get_cashout_quote: decode");
      return Ok(0);
   };
   let program_id = ctx.program_id;
   if !config_ok(ctx.accounts.config.as_ref(), program_id)
      || !quote_buffer_ok(ctx.accounts.quote_buffer.as_ref(), program_id)
      || !market_ok(ctx.accounts.market.as_ref(), program_id, &ix.market_id)
      || !event_ok(
         ctx.accounts.event_state.as_ref(),
         program_id,
         &ix.market_id.event_id,
         ix.event_state_sequence,
         &ix.event_game_state,
      )
   {
      msg!("get_cashout_quote: account check");
      return Ok(0);
   }

   let max_payment = price::cashout_payment();
   let quote = QuoteBuffer {
      is_used: 0,
      user: *ctx.accounts.user.key,
      market_id: MarketIdWire::from_market(&ix.market_id),
      side: ix.side,
      max_amount: max_payment,
      odds_scaled: 0,
      game_state: GameStateWire::from_state(&ix.event_game_state),
      sequence: ix.event_state_sequence,
   };
   if !store_quote(ctx.accounts.quote_buffer.as_ref(), &quote) {
      msg!("get_cashout_quote: write");
      return Ok(0);
   }
   Ok(max_payment)
}
