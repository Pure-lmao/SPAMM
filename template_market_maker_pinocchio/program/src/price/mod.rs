//! Pricing hooks. Each route returns a zero quote until you replace it.
//! Quote and fill handlers already write the buffer, set return data, and move collateral.

pub mod cashout_parlay;
pub mod cashout_single;
pub mod parlay;
pub mod single;
