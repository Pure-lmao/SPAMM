use anchor_lang::prelude::*;
use zeropod::ZeroPodFixed;

use crate::GetQuoteParlay;
use crate::addr::to_pinocchio;
use crate::checks::{config_ok, event_ok, market_ok, parlay_buffer_ok};
use crate::instructions::returns::set_parlay;
use crate::price;
use crate::wire::WireRest;
use spamm_aggregator::{
   constants::MAX_PARLAY_LEGS,
   state::{
      mm_parlay_quote::GetQuoteParlayIxHeader, MMParlayQuoteBuffer, ParlayLegQuoted, ParlayLegSel,
      GET_QUOTE_PARLAY_IX_DISCRIMINATOR, GET_QUOTE_PARLAY_IX_HEADER_LEN, MM_PARLAY_QUOTE_BUFFER_LEN,
      PARLAY_LEG_SEL_LEN,
   },
};

pub fn handler(ctx: Context<GetQuoteParlay>, rest: WireRest) -> Result<()> {
   let full = rest.with_disc(GET_QUOTE_PARLAY_IX_DISCRIMINATOR);
   let program_id = ctx.program_id;
   let leg_accounts = ctx.remaining_accounts;
   if full.len() < GET_QUOTE_PARLAY_IX_HEADER_LEN {
      set_parlay(0, 0, 0, &[]);
      return Ok(());
   }
   let Ok(header_zc) = <GetQuoteParlayIxHeader as ZeroPodFixed>::from_bytes(
      &full[..GET_QUOTE_PARLAY_IX_HEADER_LEN],
   ) else {
      set_parlay(0, 0, 0, &[]);
      return Ok(());
   };
   if header_zc.instruction_discriminator != GET_QUOTE_PARLAY_IX_DISCRIMINATOR {
      set_parlay(0, 0, 0, &[]);
      return Ok(());
   }
   let num_legs = header_zc.num_legs;
   let n = num_legs as usize;
   if n < 2 || n > MAX_PARLAY_LEGS || leg_accounts.len() != 2 * n {
      msg!("get_quote_parlay: legs");
      set_parlay(0, 0, 0, &[]);
      return Ok(());
   }
   if full.len() != GET_QUOTE_PARLAY_IX_HEADER_LEN + n * PARLAY_LEG_SEL_LEN {
      set_parlay(0, 0, 0, &[]);
      return Ok(());
   }
   if !config_ok(ctx.accounts.config.as_ref(), program_id)
      || !parlay_buffer_ok(ctx.accounts.parlay_buffer.as_ref(), program_id)
   {
      msg!("get_quote_parlay: account check");
      set_parlay(0, 0, 0, &[]);
      return Ok(());
   }

   let mut legs = [ParlayLegQuoted::placeholder(); MAX_PARLAY_LEGS];
   for i in 0..n {
      let off = GET_QUOTE_PARLAY_IX_HEADER_LEN + i * PARLAY_LEG_SEL_LEN;
      let slot = &full[off..off + PARLAY_LEG_SEL_LEN];
      let Ok(zc) = <ParlayLegSel as ZeroPodFixed>::from_bytes(slot) else {
         set_parlay(0, 0, 0, &[]);
         return Ok(());
      };
      let Some(leg) = ParlayLegSel::from_zc(zc) else {
         set_parlay(0, 0, 0, &[]);
         return Ok(());
      };
      let market = &leg_accounts[i * 2];
      let event_state = &leg_accounts[i * 2 + 1];
      if !market_ok(market, program_id, &leg.market_id)
         || !event_ok(
            event_state,
            program_id,
            &leg.market_id.event_id,
            leg.event_state_sequence,
            &leg.event_game_state,
         )
      {
         msg!("get_quote_parlay: leg accounts");
         set_parlay(0, 0, 0, &[]);
         return Ok(());
      }
      legs[i] = leg.with_odds(0);
   }

   let (max_amount, odds_scaled) = price::parlay_offer();
   let mut buf = match ctx.accounts.parlay_buffer.try_borrow_mut_data() {
      Ok(b) if b.len() == MM_PARLAY_QUOTE_BUFFER_LEN => b,
      _ => {
         set_parlay(0, 0, 0, &[]);
         return Ok(());
      }
   };
   if MMParlayQuoteBuffer::write_fresh_quote(
      &mut buf,
      to_pinocchio(ctx.accounts.user.key),
      num_legs,
      max_amount,
      odds_scaled,
      &legs[..n],
   )
   .is_err()
   {
      set_parlay(0, 0, 0, &[]);
      return Ok(());
   }
   drop(buf);
   set_parlay(max_amount, odds_scaled, num_legs, &[0u32; MAX_PARLAY_LEGS]);
   Ok(())
}
