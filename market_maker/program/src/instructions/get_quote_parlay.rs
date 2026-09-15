//! CPI entry for parlay quotes: per-leg event state + market data, same-event odds folded
//! into one representative leg per event, combined scaled odds (product with `ODDS_SCALE`
//! normalization), writes [`MMParlayQuoteBuffer`], return data includes per-leg odds.
//!
//! Accounts **(4 + 2×L)** — must match aggregator CPI order:
//! 0. `user`
//! 1. `clock_sysvar`
//! 2. `mm_config_pda`
//! 3. `mm_parlay_quote_buffer` — PDA [`crate::constants::MM_PARLAY_QUOTE_BUFFER_SEED`]
//! 4..4+2L−1: alternating `mm_market_data_pda`, `event_state_pda` per leg
//!
//! Instruction `data`: header + trailing [`ParlayLegSel`] × L (after the MM router
//! discriminator). Legs are decoded per-slot straight into the quoted-leg buffer —
//! no staging array — to keep the BPF stack frame within the 4 KiB limit.

use pinocchio::{error::ProgramError, AccountView, Address, address::address_eq, hint::unlikely};
use pinocchio_log::log;
use zeropod::ZeroPodFixed;

use crate::{
   constants::{MAX_QUOTE_STAKE_UNITS, MM_CONFIG_PDA, PARLAY_QUOTE_BUFFER_PDA},
   instructions::quote_helpers::{
      fold_same_event_odds, product_parlay_odds, read_parlay_leg_market_odds,
      validate_quote_leg_context,
   },
   state::{GetQuoteParlayIxHeader, GET_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN},
};
use spamm_aggregator::{
   QuoteResult,
   constants::{MAX_PARLAY_LEGS, ODDS_SCALE},
   state::{
      parlay_quote_return_wire_len, Sport, PARLAY_LEG_SEL_LEN, PARLAY_QUOTE_RETURN_WIRE_LEN,
      mm_parlay_quote::{MMParlayQuoteBuffer, ParlayLegQuoted, ParlayLegSel, MM_PARLAY_QUOTE_BUFFER_LEN},
      mm_quote::GetParlayQuoteReturnWire,
   },
};

pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> QuoteResult {
   let [
      user,
      _clock_sysvar,
      mm_config_pda,
      mm_parlay_quote_buffer,
      leg_accounts @ ..,
   ] = accounts else {
      log!("get_quote_parlay: accounts mismatch");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   };
   let header = match GetQuoteParlayIxHeader::decode(data) {
      Ok(h) => h,
      Err(_) => {
         log!("get_quote_parlay: decode failed");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
   };
   log!(
      "get_quote_parlay: decoded num_legs {} amount {} min_odds_scaled {}",
      header.num_legs,
      header.amount,
      header.odds_scaled
   );
   let n = header.num_legs as usize;
   if unlikely(n < 2 || n > MAX_PARLAY_LEGS) {
      log!("get_quote_parlay: num_legs must be 2..=MAX_PARLAY_LEGS");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   if unlikely(leg_accounts.len() != 2 * n) {
      log!("get_quote_parlay: leg accounts mismatch");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   // Exact wire: header + n live legs (mirrors the previous trailing-leg decode check).
   let legs_wire_len = n * PARLAY_LEG_SEL_LEN;
   if unlikely(data.len() != GET_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN + legs_wire_len) {
      log!("get_quote_parlay: ix payload len mismatch got {}", data.len());
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   if unlikely(!address_eq(mm_config_pda.address(), &MM_CONFIG_PDA)) {
      log!("get_quote_parlay: mm config pda invalid");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   if unlikely(!address_eq(mm_parlay_quote_buffer.address(), &PARLAY_QUOTE_BUFFER_PDA)) {
      log!("get_quote_parlay: parlay quote buffer invalid");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   let mut legs_out = [ParlayLegQuoted::placeholder(); MAX_PARLAY_LEGS];

   for (i, leg_pair) in leg_accounts.chunks_exact(2).enumerate() {
      let md = &leg_pair[0];
      let es = &leg_pair[1];
      // Decode leg `i` directly from the instruction body (single slot, no staging buffer).
      let off = GET_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN + i * PARLAY_LEG_SEL_LEN;
      let slot = &data[off..off + PARLAY_LEG_SEL_LEN];
      let leg = match <ParlayLegSel as ZeroPodFixed>::from_bytes(slot)
         .map_err(|_| ProgramError::InvalidInstructionData)
         .and_then(|zc| ParlayLegSel::from_zc(zc).ok_or(ProgramError::InvalidInstructionData))
      {
         Ok(l) => l,
         Err(_) => {
            log!("get_quote_parlay: leg index out of bounds");
            set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
            return Ok(());
         }
      };
      if unlikely(validate_quote_leg_context(&leg.market_id, leg.side, leg.event_state_sequence).is_err()) {
         log!("get_quote_parlay: invalid leg context");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
      let sport = leg.market_id.event_id.sport;
      if unlikely(!matches!(
         sport,
         Sport::Soccer
            | Sport::IceHockey
            | Sport::AmericanFootball
            | Sport::Basketball
            | Sport::Baseball
            | Sport::Tennis
            | Sport::Cs2
            | Sport::Dota
            | Sport::Lol
            | Sport::Valorant
      )) {
         log!("get_quote_parlay: invalid sport");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }

      let odds = match read_parlay_leg_market_odds(program_id, md, es, &leg) {
         Ok(o) => o,
         Err(_) => {
            log!("get_quote_parlay: leg market odds failed");
            set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
            return Ok(());
         }
      };
      legs_out[i] = leg.with_odds(odds);
   }

   // Multiply same-event leg odds into one representative leg per event (companions → 0).
   if unlikely(fold_same_event_odds(n, &mut legs_out).is_err()) {
      log!("get_quote_parlay: fold_same_event_odds failed");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   let odds_scaled = match product_parlay_odds(n, &legs_out[..n]) {
      Ok(v) => v,
      Err(_) => {
         log!("get_quote_parlay: arithmetic overflow");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
   };

   if unlikely(odds_scaled <= ODDS_SCALE as u32) {
      log!("get_quote_parlay: combined odds below ODDS_SCALE (1.0): {}", odds_scaled);
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   if unlikely(odds_scaled < header.odds_scaled) {
      log!("get_quote_parlay: combined odds below caller min hint");
      set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
      return Ok(());
   }

   let max_amount = core::cmp::min(header.amount, MAX_QUOTE_STAKE_UNITS);
   let leg_odds_arr = {
      let mut out = [0u32; MAX_PARLAY_LEGS];
      for i in 0..n {
         out[i] = legs_out.get(i).map(|l| l.odds_scaled).unwrap_or(0);
      }
      out
   };

   log!(
      "get_quote_parlay: max_amount: {}, odds_scaled: {} (min_odds_scaled {})",
      max_amount,
      odds_scaled,
      header.odds_scaled
   );

   match mm_parlay_quote_buffer.try_borrow_mut() {
      Ok(mut buf) if buf.len() == MM_PARLAY_QUOTE_BUFFER_LEN => {
         if unlikely(
            MMParlayQuoteBuffer::write_fresh_quote(
               &mut buf,
               *user.address(),
               header.num_legs,
               max_amount,
               odds_scaled,
               &legs_out[..n],
            )
            .is_err(),
         ) {
            log!("get_quote_parlay: quote write failed");
            set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
            return Ok(());
         }
      }
      _ => {
         log!("get_quote_parlay: quote buffer borrow failed or len mismatch");
         set_get_parlay_quote_return_data(0, 0, 0, [0; MAX_PARLAY_LEGS])?;
         return Ok(());
      }
   }

   set_get_parlay_quote_return_data(max_amount, odds_scaled, header.num_legs, leg_odds_arr)?;
   Ok(())
}

#[inline(never)]
fn set_get_parlay_quote_return_data(
   max_amount: u64,
   odds_scaled: u32,
   num_legs: u8,
   leg_odds: [u32; MAX_PARLAY_LEGS],
) -> QuoteResult {
   let ret = GetParlayQuoteReturnWire {
      max_amount,
      odds_scaled,
      num_legs,
      leg_odds,
   };
   let n = num_legs as usize;
   let wire_len = parlay_quote_return_wire_len(n);
   let mut out = [0u8; PARLAY_QUOTE_RETURN_WIRE_LEN];
   if ret.write_wire(&mut out[..wire_len]).is_err() {
      log!("get_quote_parlay: return wire write failed");
      return Ok(());
   }
   #[cfg(any(target_os = "solana", target_arch = "bpf"))]
   unsafe {
      pinocchio::syscalls::sol_set_return_data(out.as_ptr(), wire_len as u64);
   }
   #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
   {
      let _ = out;
   }
   Ok(())
}