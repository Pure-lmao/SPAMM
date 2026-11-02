use spamm_aggregator::constants::MAX_PARLAY_LEGS;

/// Parlay quote. `leg_odds[i]` is the scaled odds for live leg `i`.
///
/// Copy `leg_odds` onto each quoted leg and into the return data. The aggregator
/// checks that the product of the non-zero legs matches `odds_scaled` (`ODDS_SCALE`
/// = 1.0; divide by it once per extra leg). A `0` entry is a same-event companion
/// and is left out of that product. Only the first `num_legs` slots are live.
pub struct Offer {
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub leg_odds: [u32; MAX_PARLAY_LEGS],
}

#[inline(always)]
pub fn offer(num_legs: usize) -> Offer {
   let _ = num_legs;
   Offer {
      max_amount: 0,
      odds_scaled: 0,
      leg_odds: [0; MAX_PARLAY_LEGS],
   }
}
