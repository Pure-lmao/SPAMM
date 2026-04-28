use zeropod::{ZeroPod, ZeroPodFixed};

/// On-chain: `u64` sequence, then a body of `N` little-endian `u32` odds. `get_quote` uses `N = 2`
/// (binary) or for Soccer with `mkt` in `{1,2,3,5,6,7}`, `N = 3` (1X2 or double chance); see
/// `get_quote` for `side` rules.
#[derive(Copy, Clone, ZeroPod)]
pub struct MmOracleQuoteHead {
   pub discriminator: u8,
   pub sequence: u64,
   pub odds_scaled_0: u32,
   pub odds_scaled_1: u32,
}

const _: () = assert!(<MmOracleQuoteHead as ZeroPodFixed>::SIZE == 17);

/// Return payload for `sol_set_return_data` (aggregator `parse_quote_data` expects 12 bytes LE).
#[derive(Copy, Clone, ZeroPod)]
pub struct GetQuoteReturnWire {
   pub max_amount: u64,
   pub odds_scaled: u32,
}

const _: () = assert!(<GetQuoteReturnWire as ZeroPodFixed>::SIZE == 12);

impl GetQuoteReturnWire {
   #[inline(always)]
   pub fn to_zc(self) -> GetQuoteReturnWireZc {
      GetQuoteReturnWireZc {
         max_amount: self.max_amount.into(),
         odds_scaled: self.odds_scaled.into(),
      }
   }
}
