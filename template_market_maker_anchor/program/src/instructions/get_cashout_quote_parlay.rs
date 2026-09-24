use anchor_lang::prelude::*;
use zeropod::ZeroPodFixed;

use crate::GetCashoutQuoteParlay;
use crate::addr::to_pinocchio;
use crate::checks::{config_ok, event_ok, market_ok, parlay_buffer_ok};
use crate::price;
use crate::wire::WireRest;
use spamm_aggregator::{
   constants::MAX_PARLAY_LEGS,
   state::{
      GetCashoutQuoteParlayIxHeader, MMParlayQuoteBuffer, ParlayLegQuoted, ParlayLegSel,
      GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR, GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN,
      MM_PARLAY_QUOTE_BUFFER_LEN, PARLAY_LEG_SEL_LEN,
   },
};

pub fn handler(ctx: Context<GetCashoutQuoteParlay>, rest: WireRest) -> Result<u64> {
   let full = rest.with_disc(GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR);
   let program_id = ctx.program_id;
   let leg_accounts = ctx.remaining_accounts;
   if full.len() < GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN {
      return Ok(0);
   }
   let Ok(header) = <GetCashoutQuoteParlayIxHeader as ZeroPodFixed>::from_bytes(
      &full[..GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN],
   ) else {
      return Ok(0);
   };
   if header.instruction_discriminator != GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR {
      return Ok(0);
   }
   let num_legs = header.num_legs;
   let n = num_legs as usize;
   if n < 2 || n > MAX_PARLAY_LEGS || leg_accounts.len() != 2 * n {
      return Ok(0);
   }
   if full.len() != GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN + n * PARLAY_LEG_SEL_LEN {
      return Ok(0);
   }
   if !config_ok(ctx.accounts.config.as_ref(), program_id)
      || !parlay_buffer_ok(ctx.accounts.parlay_buffer.as_ref(), program_id)
   {
      return Ok(0);
   }

   let mut legs = [ParlayLegQuoted::placeholder(); MAX_PARLAY_LEGS];
   for i in 0..n {
      let off = GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN + i * PARLAY_LEG_SEL_LEN;
      let Ok(zc) = <ParlayLegSel as ZeroPodFixed>::from_bytes(&full[off..off + PARLAY_LEG_SEL_LEN]) else {
         return Ok(0);
      };
      let Some(leg) = ParlayLegSel::from_zc(zc) else {
         return Ok(0);
      };
      if !market_ok(&leg_accounts[i * 2], program_id, &leg.market_id)
         || !event_ok(
            &leg_accounts[i * 2 + 1],
            program_id,
            &leg.market_id.event_id,
            leg.event_state_sequence,
            &leg.event_game_state,
         )
      {
         return Ok(0);
      }
      legs[i] = leg.with_odds(0);
   }

   let max_payment = price::cashout_payment();
   let mut buf = match ctx.accounts.parlay_buffer.try_borrow_mut_data() {
      Ok(b) if b.len() == MM_PARLAY_QUOTE_BUFFER_LEN => b,
      _ => {
         return Ok(0);
      }
   };
   if MMParlayQuoteBuffer::write_fresh_quote(
      &mut buf,
      to_pinocchio(ctx.accounts.user.key),
      num_legs,
      max_payment,
      0,
      &legs[..n],
   )
   .is_err()
   {
      return Ok(0);
   }
   Ok(max_payment)
}
