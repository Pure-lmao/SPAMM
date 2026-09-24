//! Parlay quote return. A Borsh `Vec` would prefix a length; the aggregator reads a raw tail.
//! Single-market and cashout quotes return `SingleQuote` / `u64` and Anchor writes that return data.

use anchor_lang::solana_program::{msg, program::set_return_data};
use spamm_aggregator::{
   constants::MAX_PARLAY_LEGS,
   state::{
      parlay_quote_return_wire_len, GetParlayQuoteReturnWire, PARLAY_QUOTE_RETURN_HEADER_LEN,
      PARLAY_QUOTE_RETURN_WIRE_LEN,
   },
};

#[inline(always)]
pub fn set_parlay(max_amount: u64, odds_scaled: u32, num_legs: u8, leg_odds: &[u32]) {
   let n = num_legs as usize;
   if n > MAX_PARLAY_LEGS || leg_odds.len() < n {
      msg!("parlay return: bad num_legs");
      set_return_data(&[0u8; PARLAY_QUOTE_RETURN_HEADER_LEN]);
      return;
   }
   let mut odds = [0u32; MAX_PARLAY_LEGS];
   odds[..n].copy_from_slice(&leg_odds[..n]);
   let wire = GetParlayQuoteReturnWire {
      max_amount,
      odds_scaled,
      num_legs,
      leg_odds: odds,
   };
   let len = parlay_quote_return_wire_len(n);
   let mut out = [0u8; PARLAY_QUOTE_RETURN_WIRE_LEN];
   if wire.write_wire(&mut out[..len]).is_err() {
      msg!("parlay return: write failed");
      set_return_data(&[0u8; PARLAY_QUOTE_RETURN_HEADER_LEN]);
      return;
   }
   set_return_data(&out[..len]);
}
