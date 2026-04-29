use zeropod::{ZeroPod, ZeroPodFixed};

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
