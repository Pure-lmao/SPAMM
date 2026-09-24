use pinocchio::{account::AccountView, hint::unlikely, Address};
use pinocchio_log::log;

use crate::{
   checks::{config_ok, event_ok, market_ok, quote_buffer_ok},
   instructions::returns::set_single,
   price,
};
use spamm_aggregator::{
   helpers::verify_clock_sysvar,
   state::{
      MMQuoteBuffer, MM_QUOTE_BUFFER_DISCRIMINATOR, MM_QUOTE_BUFFER_LEN, GetQuoteIxData,
   },
   QuoteResult,
};

pub fn process(
   program_id: &Address,
   accounts: &mut [AccountView],
   full_data: &[u8],
) -> QuoteResult {
   let Ok(ix) = GetQuoteIxData::decode(full_data) else {
      log!("get_quote: decode");
      return set_single(0, 0);
   };
   let [
      user,         // copied into the quote buffer
      clock,        // `verify_clock_sysvar`
      market,       // `market_ok`
      event_state,  // `event_ok`
      config,       // `config_ok`
      quote_buffer, // `quote_buffer_ok`
   ] = accounts else {
      log!("get_quote: accounts");
      return set_single(0, 0);
   };
   if unlikely(
      verify_clock_sysvar(clock).is_err()
         || !config_ok(config, program_id)
         || !quote_buffer_ok(quote_buffer, program_id)
         || !market_ok(market, program_id, &ix.market_id)
         || !event_ok(
            event_state,
            program_id,
            &ix.market_id.event_id,
            ix.event_state_sequence,
            &ix.event_game_state,
         ),
   ) {
      log!("get_quote: account check");
      return set_single(0, 0);
   }

   let (max_amount, odds_scaled) = price::single_offer();
   let quote = MMQuoteBuffer {
      discriminator: MM_QUOTE_BUFFER_DISCRIMINATOR,
      is_used: 0,
      user_address: *user.address(),
      market_id: ix.market_id,
      side: ix.side,
      max_amount,
      odds_scaled,
      event_game_state: ix.event_game_state,
      event_state_sequence: ix.event_state_sequence,
   };
   let mut buf = match quote_buffer.try_borrow_mut() {
      Ok(b) if b.len() == MM_QUOTE_BUFFER_LEN => b,
      _ => {
         log!("get_quote: buffer");
         return set_single(0, 0);
      }
   };
   if quote.write_wire(&mut buf).is_err() {
      log!("get_quote: write");
      return set_single(0, 0);
   }
   drop(buf);
   set_single(max_amount, odds_scaled)
}
