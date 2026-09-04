use zeropod::ZeroPod;

/// Return payload for `sol_set_return_data` (aggregator `QuoteData::read_max_amount_and_odds` expects packed `u64` + `u32` LE).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct GetQuoteReturnWire {
   pub max_amount: u64,
   pub odds_scaled: u32,
}

impl GetQuoteReturnWire {
   #[inline(always)]
   pub fn to_zc(self) -> GetQuoteReturnWireZc {
      GetQuoteReturnWireZc {
         max_amount: self.max_amount.into(),
         odds_scaled: self.odds_scaled.into(),
      }
   }
}
