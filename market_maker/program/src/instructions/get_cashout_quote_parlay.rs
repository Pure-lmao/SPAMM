//! MM `get_cashout_quote_parlay` (disc 142): soft-fail ticket-level cashout quote.
//!
//! Accounts **(4 + 2×L)** — match aggregator CPI order:
//! 0. `user`
//! 1. `clock_sysvar`
//! 2. `mm_config_pda`
//! 3. `mm_parlay_quote_buffer`
//! 4..4+2L−1: alternating `mm_market_data_pda`, `event_state_pda` per leg
//!
//! Instruction `data`: [`GetCashoutQuoteParlayIxHeaderPayload`] then [`ParlayLegSel`] × L.
//! Return data: 8-byte LE `max_payment` (0 = no quote).

use pinocchio::{AccountView, Address, address::address_eq, hint::unlikely};

use crate::{
   constants::{MM_CONFIG_PDA, PARLAY_QUOTE_BUFFER_PDA},
   instructions::quote_helpers::{
      assign_same_event_companion_odds, product_parlay_odds,
      read_parlay_leg_market_odds, set_cashout_return, validate_parlay_same_event_odds,
      validate_quote_leg_context,
   },
   state::{GetCashoutQuoteParlayIxHeaderPayload, GET_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN},
};
use spamm_aggregator::{
   QuoteResult,
   constants::{MAX_PARLAY_LEGS, ODDS_SCALE},
   state::{
      decode_parlay_leg_sels_into, empty_parlay_leg_quoted_buf, empty_parlay_leg_sel_buf,
      MMParlayQuoteBuffer, MM_PARLAY_QUOTE_BUFFER_LEN,
   },
};

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> QuoteResult {
   let [
      user,
      _clock,
      mm_config_pda,
      mm_parlay_quote_buffer,
      leg_accounts @ ..,
   ] = accounts else {
      set_cashout_return(0)?;
      return Ok(());
   };

   let (amount, payout, min_payout, n) = {
      if data.len() < GET_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN {
         set_cashout_return(0)?;
         return Ok(());
      }
      let header = match GetCashoutQuoteParlayIxHeaderPayload::decode(
         &data[..GET_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN],
      ) {
         Ok(h) => h,
         Err(_) => {
            set_cashout_return(0)?;
            return Ok(());
         }
      };
      (
         header.amount,
         header.payout,
         header.min_payout,
         header.num_legs as usize,
      )
   };
   if unlikely(n < 2 || n > MAX_PARLAY_LEGS || leg_accounts.len() != 2 * n) {
      set_cashout_return(0)?;
      return Ok(());
   }
   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      set_cashout_return(0)?;
      return Ok(());
   }
   if unlikely(!address_eq(mm_parlay_quote_buffer.address(), &PARLAY_QUOTE_BUFFER_PDA)) {
      set_cashout_return(0)?;
      return Ok(());
   }

   let mut sels = empty_parlay_leg_sel_buf::<MAX_PARLAY_LEGS>();
   if decode_parlay_leg_sels_into(&data[GET_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN..], n, &mut sels).is_err() {
      set_cashout_return(0)?;
      return Ok(());
   }

   let mut quoted = empty_parlay_leg_quoted_buf::<MAX_PARLAY_LEGS>();
   let mut market_odds = [0u32; MAX_PARLAY_LEGS];
   for i in 0..n {
      let md = &leg_accounts[2 * i];
      let es = &leg_accounts[2 * i + 1];
      let leg = &sels[i];
      if unlikely(validate_quote_leg_context(&leg.market_id, leg.side, leg.event_state_sequence).is_err()) {
         set_cashout_return(0)?;
         return Ok(());
      }
      market_odds[i] = match read_parlay_leg_market_odds(program_id, md, es, leg) {
         Ok(o) => o,
         _ => {
            set_cashout_return(0)?;
            return Ok(());
         }
      };
   }

   if unlikely(assign_same_event_companion_odds(n, &sels[..n], &market_odds, &mut quoted[..n]).is_err()) {
      set_cashout_return(0)?;
      return Ok(());
   }
   if unlikely(validate_parlay_same_event_odds(n, &quoted[..n]).is_err()) {
      set_cashout_return(0)?;
      return Ok(());
   }

   let combined = match product_parlay_odds(n, &quoted[..n]) {
      Ok(o) if o > ODDS_SCALE as u32 => o,
      _ => {
         set_cashout_return(0)?;
         return Ok(());
      }
   };
   let fair = ((amount as u128)
      .saturating_mul(ODDS_SCALE)
      .checked_div(combined as u128).unwrap_or(0)) as u64;
   let cap = payout.saturating_sub(1);
   let mut max_payment = core::cmp::min(fair, cap);
   if max_payment < min_payout {
      max_payment = 0;
   }
   if max_payment == 0 {
      set_cashout_return(0)?;
      return Ok(());
   }

   match mm_parlay_quote_buffer.try_borrow_mut() {
      Ok(mut buf) if buf.len() == MM_PARLAY_QUOTE_BUFFER_LEN => {
         if MMParlayQuoteBuffer::write_fresh_quote(
            &mut buf,
            *user.address(),
            n as u8,
            max_payment,
            combined,
            &quoted[..n],
         )
         .is_err()
         {
            set_cashout_return(0)?;
            return Ok(());
         }
      }
      _ => {
         set_cashout_return(0)?;
         return Ok(());
      }
   }

   set_cashout_return(max_payment)?;
   Ok(())
}
