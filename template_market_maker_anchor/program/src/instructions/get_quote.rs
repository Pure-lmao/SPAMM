use anchor_lang::prelude::*;

use crate::GetQuote;
use crate::checks::{config_ok, event_ok, market_ok, quote_buffer_ok};
use crate::price;
use crate::state::{store_quote, GameStateWire, MarketIdWire, QuoteBuffer, SingleQuote};
use crate::wire::WireRest;
use spamm_aggregator::state::{GetQuoteIxData, GET_QUOTE_IX_DISCRIMINATOR};

pub fn handler(ctx: Context<GetQuote>, rest: WireRest) -> Result<SingleQuote> {
   let full = rest.with_disc(GET_QUOTE_IX_DISCRIMINATOR);
   let Ok(ix) = GetQuoteIxData::decode(&full) else {
      msg!("get_quote: decode");
      return Ok(SingleQuote::ZERO);
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
      msg!("get_quote: account check");
      return Ok(SingleQuote::ZERO);
   }

   let (max_amount, odds_scaled) = price::single_offer();
   let quote = QuoteBuffer {
      is_used: 0,
      user: *ctx.accounts.user.key,
      market_id: MarketIdWire::from_market(&ix.market_id),
      side: ix.side,
      max_amount,
      odds_scaled,
      game_state: GameStateWire::from_state(&ix.event_game_state),
      sequence: ix.event_state_sequence,
   };
   if !store_quote(ctx.accounts.quote_buffer.as_ref(), &quote) {
      msg!("get_quote: write");
      return Ok(SingleQuote::ZERO);
   }
   Ok(SingleQuote {
      max_amount,
      odds_scaled,
   })
}
