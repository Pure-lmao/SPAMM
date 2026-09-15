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
//! Legs are decoded per-slot straight into the quoted-leg buffer — no staging array — to
//! keep the BPF stack frame within the 4 KiB limit.
//! Return data: 8-byte LE `max_payment` (0 = no quote).

use pinocchio::{error::ProgramError, AccountView, Address, address::address_eq, hint::unlikely};
use zeropod::ZeroPodFixed;

use crate::{
   constants::{MM_CONFIG_PDA, PARLAY_QUOTE_BUFFER_PDA},
   instructions::quote_helpers::{
      fold_same_event_odds, product_parlay_odds, read_parlay_leg_market_odds, set_cashout_return,
      validate_quote_leg_context,
   },
   state::{GetCashoutQuoteParlayIxHeaderPayload, GET_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN},
};
use spamm_aggregator::{
   QuoteResult,
   constants::{MAX_PARLAY_LEGS, ODDS_SCALE},
   state::{
      empty_parlay_leg_quoted_buf, PARLAY_LEG_SEL_LEN,
      mm_parlay_quote::{ParlayLegSel, MMParlayQuoteBuffer, MM_PARLAY_QUOTE_BUFFER_LEN},
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

   if unlikely(data.len() < GET_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN) {
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
   let (payout, min_payout) = (header.payout, header.min_payout);
   let n = header.num_legs as usize;

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
   if unlikely(data.len() < GET_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN + n * PARLAY_LEG_SEL_LEN) {
      set_cashout_return(0)?;
      return Ok(());
   }

   let mut quoted = empty_parlay_leg_quoted_buf::<MAX_PARLAY_LEGS>();
   for i in 0..n {
      let md = &leg_accounts[2 * i];
      let es = &leg_accounts[2 * i + 1];
      // Decode leg `i` directly from the instruction body (single slot, no staging buffer).
      let off = GET_CASHOUT_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN + i * PARLAY_LEG_SEL_LEN;
      let leg = match <ParlayLegSel as ZeroPodFixed>::from_bytes(&data[off..off + PARLAY_LEG_SEL_LEN])
         .map_err(|_| ProgramError::InvalidInstructionData)
         .and_then(|zc| ParlayLegSel::from_zc(zc).ok_or(ProgramError::InvalidInstructionData))
      {
         Ok(l) => l,
         Err(_) => {
            set_cashout_return(0)?;
            return Ok(());
         }
      };
      if unlikely(validate_quote_leg_context(&leg.market_id, leg.side, leg.event_state_sequence).is_err()) {
         set_cashout_return(0)?;
         return Ok(());
      }
      let odds = match read_parlay_leg_market_odds(program_id, md, es, &leg) {
         Ok(o) => o,
         _ => {
            set_cashout_return(0)?;
            return Ok(());
         }
      };
      quoted[i] = leg.with_odds(odds);
   }

   // Multiply same-event leg odds into one representative leg per event (companions → 0).
   if unlikely(fold_same_event_odds(n, &mut quoted).is_err()) {
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
   // Fair value of the cashed slice: its face payout at the fill odds (`payout` =
   // proportional payout removed from the ticket) re-priced at the live combined odds.
   // Unchanged odds => the stake slice back; shortened odds => profit; drifted => loss.
   let fair = ((payout as u128)
      .checked_mul(ODDS_SCALE)
      .and_then(|x| x.checked_div(combined as u128))
      .unwrap_or(0)) as u64;
   // `min_payout` is a floor on payment: soft-fail with 0 rather than quote below it.
   // The aggregator enforces the same floor via `accept_cashout_payment`.
   if fair == 0 || fair < min_payout {
      set_cashout_return(0)?;
      return Ok(());
   }

   match mm_parlay_quote_buffer.try_borrow_mut() {
      Ok(mut buf) if buf.len() == MM_PARLAY_QUOTE_BUFFER_LEN => {
         if MMParlayQuoteBuffer::write_fresh_quote(
            &mut buf,
            *user.address(),
            n as u8,
            fair,
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

   set_cashout_return(fair)?;
   Ok(())
}