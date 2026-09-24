//! `sol_set_return_data` helpers. Quote handlers must not return an error.

use pinocchio_log::log;
use spamm_aggregator::{
   constants::MAX_PARLAY_LEGS,
   state::{
      mm_quote::QUOTE_DATA_LEN, parlay_quote_return_wire_len, GetParlayQuoteReturnWire,
      CASHOUT_QUOTE_RETURN_LEN, PARLAY_QUOTE_RETURN_HEADER_LEN, PARLAY_QUOTE_RETURN_WIRE_LEN,
   },
   QuoteResult,
};

#[cfg(target_os = "solana")]
use pinocchio::syscalls::sol_set_return_data;

#[inline(always)]
pub fn set_single(max_amount: u64, odds_scaled: u32) -> QuoteResult {
   let mut out = [0u8; QUOTE_DATA_LEN];
   out[..8].copy_from_slice(&max_amount.to_le_bytes());
   out[8..12].copy_from_slice(&odds_scaled.to_le_bytes());
   set_return(&out);
   Ok(())
}

#[inline(always)]
pub fn set_cashout(max_payment: u64) -> QuoteResult {
   let out = max_payment.to_le_bytes();
   debug_assert_eq!(out.len(), CASHOUT_QUOTE_RETURN_LEN);
   set_return(&out);
   Ok(())
}

#[inline(always)]
pub fn set_parlay(max_amount: u64, odds_scaled: u32, num_legs: u8, leg_odds: &[u32]) -> QuoteResult {
   let n = num_legs as usize;
   if n > MAX_PARLAY_LEGS || leg_odds.len() < n {
      log!("parlay return: bad num_legs");
      set_return(&[0u8; PARLAY_QUOTE_RETURN_HEADER_LEN]);
      return Ok(());
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
      log!("parlay return: write failed");
      set_return(&[0u8; PARLAY_QUOTE_RETURN_HEADER_LEN]);
      return Ok(());
   }
   set_return(&out[..len]);
   Ok(())
}

#[inline(always)]
fn set_return(out: &[u8]) {
   #[cfg(target_os = "solana")]
   unsafe {
      sol_set_return_data(out.as_ptr(), out.len() as u64);
   }
   #[cfg(not(target_os = "solana"))]
   {
      let _ = out;
   }
}
