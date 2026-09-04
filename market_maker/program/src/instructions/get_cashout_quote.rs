//! MM `get_cashout_quote` (disc 140): soft-fail quote of cash C for a ticket slice.
//!
//! Accounts (6) — match aggregator CPI:
//! 0. `user`
//! 1. `clock_sysvar`
//! 2. `mm_market_data_pda`
//! 3. `event_state_pda`
//! 4. `mm_config_pda`
//! 5. `mm_quote_buffer`
//!
//! Return data: 8-byte LE `max_payment` (0 = no quote).
//! Quote buffer `odds_scaled` is 0 — cashout fill matcher does not check odds.

use pinocchio::{AccountView, Address, address::address_eq, hint::unlikely};

use crate::{
   constants::{MM_CONFIG_PDA, QUOTE_BUFFER_PDA},
   instructions::quote_helpers::{odds_from_market_data_body, set_cashout_return, validate_quote_leg_context},
   mm_helpers::{mm_market_data_pda_ok, verify_event_state},
   state::GetCashoutQuoteIxPayload,
};
use spamm_aggregator::{
   QuoteResult,
   constants::ODDS_SCALE,
   state::{
      MMQuoteBuffer, MM_QUOTE_BUFFER_LEN,
      mm_quote::MM_QUOTE_BUFFER_DISCRIMINATOR,
   },
};

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> QuoteResult {
   let [
      user,
      _clock,
      mm_market_data_pda,
      event_state_pda,
      mm_config_pda,
      mm_quote_buffer,
   ] = accounts else {
      set_cashout_return(0)?;
      return Ok(());
   };

   let parsed = match GetCashoutQuoteIxPayload::decode(data) {
      Ok(p) => p,
      _ => {
         set_cashout_return(0)?;
         return Ok(());
      }
   };

   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      set_cashout_return(0)?;
      return Ok(());
   }
   if unlikely(!address_eq(mm_quote_buffer.address(), &QUOTE_BUFFER_PDA)) {
      set_cashout_return(0)?;
      return Ok(());
   }
   if unlikely(validate_quote_leg_context(
      &parsed.market_id,
      parsed.side,
      parsed.event_state_sequence,
   ).is_err()) {
      set_cashout_return(0)?;
      return Ok(());
   }
   if unlikely(!verify_event_state(
      event_state_pda,
      program_id,
      &parsed.market_id.event_id,
      &parsed.event_game_state,
      parsed.event_state_sequence,
   )) {
      set_cashout_return(0)?;
      return Ok(());
   }
   if unlikely(!mm_market_data_pda_ok(mm_market_data_pda, program_id, &parsed.market_id)) {
      set_cashout_return(0)?;
      return Ok(());
   }

   let market_data = match mm_market_data_pda.try_borrow() {
      Ok(d) if d.len() >= 6 => d,
      _ => {
         set_cashout_return(0)?;
         return Ok(());
      }
   };
   let body = &market_data[6..];
   let current_odds = match odds_from_market_data_body(&parsed.market_id, body, parsed.side) {
      Ok(o) if o > ODDS_SCALE as u32 => o,
      _ => {
         set_cashout_return(0)?;
         return Ok(());
      }
   };

   // Fair cash ≈ stake * ODDS_SCALE / current_odds (implied stake at live odds).
   // Cap at P'-1 so MM keeps at least 1 unit of edge vs remaining payout.
   let fair = ((parsed.amount as u128)
      .checked_mul(ODDS_SCALE).and_then(|x| 
         x.checked_div(current_odds as u128))
      .unwrap_or(0)) as u64;
   let cap = parsed.payout.saturating_sub(1);
   let mut max_payment = core::cmp::min(fair, cap);
   if max_payment < parsed.min_payout {
      max_payment = 0;
   }
   if max_payment == 0 {
      set_cashout_return(0)?;
      return Ok(());
   }

   // Cashout fill matcher ignores odds; live odds are only used above for fair payment.
   let quote = MMQuoteBuffer {
      discriminator: MM_QUOTE_BUFFER_DISCRIMINATOR,
      is_used: 0,
      user_address: *user.address(),
      market_id: parsed.market_id,
      side: parsed.side,
      max_amount: max_payment,
      odds_scaled: 0,
      event_game_state: parsed.event_game_state,
      event_state_sequence: parsed.event_state_sequence,
   };
   if let Ok(mut buf) = mm_quote_buffer.try_borrow_mut() {
      if buf.len() == MM_QUOTE_BUFFER_LEN {
         if quote.write_wire(&mut buf).is_err() {
            set_cashout_return(0)?;
            return Ok(());
         }
      } else {
         set_cashout_return(0)?;
         return Ok(());
      }
   } else {
      set_cashout_return(0)?;
      return Ok(());
   }

   set_cashout_return(max_payment)?;
   Ok(())
}
