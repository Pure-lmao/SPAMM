use pinocchio::{account::AccountView, hint::unlikely, Address};
use pinocchio_log::log;
use zeropod::ZeroPodFixed;

use crate::{
   checks::{config_ok, event_ok, market_ok, parlay_buffer_ok},
   instructions::returns::set_cashout,
   price,
};
use spamm_aggregator::{
   constants::MAX_PARLAY_LEGS,
   helpers::verify_clock_sysvar,
   state::{
      GetCashoutQuoteParlayIxHeader, MMParlayQuoteBuffer, ParlayLegQuoted, ParlayLegSel,
      GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR, GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN,
      MM_PARLAY_QUOTE_BUFFER_LEN, PARLAY_LEG_SEL_LEN,
   },
   QuoteResult,
};

pub fn process(
   program_id: &Address,
   accounts: &mut [AccountView],
   full_data: &[u8],
) -> QuoteResult {
   let [
      user,              // copied into the parlay quote buffer
      clock,             // `verify_clock_sysvar`
      config,            // `config_ok`
      parlay_buffer,     // `parlay_buffer_ok`
      leg_accounts @ .., // per leg: `market_ok`, `event_ok`
   ] = accounts else {
      log!("get_cashout_quote_parlay: accounts");
      return set_cashout(0);
   };
   if unlikely(full_data.len() < GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN) {
      return set_cashout(0);
   }
   let Ok(header) = <GetCashoutQuoteParlayIxHeader as ZeroPodFixed>::from_bytes(
      &full_data[..GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN],
   ) else {
      return set_cashout(0);
   };
   if unlikely(header.instruction_discriminator != GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR) {
      return set_cashout(0);
   }
   let num_legs = header.num_legs;
   let n = num_legs as usize;
   if unlikely(n < 2 || n > MAX_PARLAY_LEGS || leg_accounts.len() != 2 * n) {
      log!("get_cashout_quote_parlay: legs");
      return set_cashout(0);
   }
   if unlikely(full_data.len() != GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN + n * PARLAY_LEG_SEL_LEN) {
      return set_cashout(0);
   }
   if unlikely(
      verify_clock_sysvar(clock).is_err()
         || !config_ok(config, program_id)
         || !parlay_buffer_ok(parlay_buffer, program_id),
   ) {
      log!("get_cashout_quote_parlay: account check");
      return set_cashout(0);
   }

   let mut legs = [ParlayLegQuoted::placeholder(); MAX_PARLAY_LEGS];
   for i in 0..n {
      let off = GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN + i * PARLAY_LEG_SEL_LEN;
      let Ok(zc) = <ParlayLegSel as ZeroPodFixed>::from_bytes(&full_data[off..off + PARLAY_LEG_SEL_LEN]) else {
         return set_cashout(0);
      };
      let Some(leg) = ParlayLegSel::from_zc(zc) else {
         return set_cashout(0);
      };
      if unlikely(
         !market_ok(&leg_accounts[i * 2], program_id, &leg.market_id)
            || !event_ok(
               &leg_accounts[i * 2 + 1],
               program_id,
               &leg.market_id.event_id,
               leg.event_state_sequence,
               &leg.event_game_state,
            ),
      ) {
         log!("get_cashout_quote_parlay: leg accounts");
         return set_cashout(0);
      }
      legs[i] = leg.with_odds(0);
   }

   let max_payment = price::cashout_payment();
   let mut buf = match parlay_buffer.try_borrow_mut() {
      Ok(b) if b.len() == MM_PARLAY_QUOTE_BUFFER_LEN => b,
      _ => return set_cashout(0),
   };
   if MMParlayQuoteBuffer::write_fresh_quote(
      &mut buf,
      *user.address(),
      num_legs,
      max_payment,
      0,
      &legs[..n],
   )
   .is_err()
   {
      return set_cashout(0);
   }
   set_cashout(max_payment)
}
