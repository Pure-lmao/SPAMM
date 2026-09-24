//! Pricing hook. The template returns a zero quote after account checks.
//! Replace these functions with a strategy; quote and fill handlers already
//! write the buffer, return the quote, and move collateral.

/// Single-market offer: `(max_amount, odds_scaled)`.
#[inline(always)]
pub fn single_offer() -> (u64, u32) {
   (0, 0)
}

/// Parlay offer: `(max_amount, combined_odds_scaled)`. Per-leg odds stay 0.
#[inline(always)]
pub fn parlay_offer() -> (u64, u32) {
   (0, 0)
}

/// Cashout offer: max payment in betting-token units.
#[inline(always)]
pub fn cashout_payment() -> u64 {
   0
}
