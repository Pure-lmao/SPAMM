//! Quote-proxy instruction builders and return-data decode helpers.

use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use spamm_aggregator::instructions::{
   FillBetIxData, FillParlayIxData, FILL_BET_IX_DATA_LEN, GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR,
   GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR, GET_QUOTE_PROXY_IX_DISCRIMINATOR,
};
use spamm_aggregator::constants::{ADDRESS_LEN, U32_LEN, U64_LEN};
use spamm_aggregator::state::{
   mm_quote::{
      proxy_market_mm_entry_wire_len, proxy_parlay_quote_data_len, PROXY_QUOTE_DATA_LEN,
   },
   MarketId, ParlayLegQuoted, PROXY_PARLAY_QUOTE_HEADER_LEN,
};

use super::fixtures::*;

pub fn get_quote_proxy_metas(market: &MarketId) -> Vec<AccountMeta> {
   let eid = market.event_id;
   vec![
      AccountMeta::new_readonly(user(), false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new_readonly(event_state_pda(&eid), false),
      AccountMeta::new_readonly(market_data_pda(market), false),
      AccountMeta::new(mm_quote_buffer_pda(), false),
   ]
}

pub fn get_quote_proxy_instruction(data: &FillBetIxData, market: &MarketId) -> Instruction {
   let mut buf = vec![GET_QUOTE_PROXY_IX_DISCRIMINATOR];
   let mut payload = [0u8; FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut payload).expect("fill bet wire");
   buf.extend_from_slice(&payload);
   Instruction::new_with_bytes(agg_program_id(), &buf, get_quote_proxy_metas(market))
}

pub fn get_parlay_quote_proxy_metas(markets: &[MarketId]) -> Vec<AccountMeta> {
   let mut m = vec![
      AccountMeta::new_readonly(user(), false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new(mm_parlay_quote_buffer_pda(), false),
   ];
   for mid in markets {
      m.push(AccountMeta::new_readonly(market_data_pda(mid), false));
      m.push(AccountMeta::new_readonly(event_state_pda(&mid.event_id), false));
   }
   m
}

pub fn get_parlay_quote_proxy_instruction(
   payload: &FillParlayIxData,
   markets: &[MarketId],
) -> Instruction {
   let n = payload.num_legs as usize;
   let wire_len = FillParlayIxData::wire_len(n);
   let mut wire = vec![0u8; wire_len];
   payload.write_wire(&mut wire).expect("parlay wire");
   let mut buf = vec![GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR];
   buf.extend_from_slice(&wire);
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      get_parlay_quote_proxy_metas(markets),
   )
}

pub fn get_market_quotes_proxy_instruction(data: &FillBetIxData, market: &MarketId) -> Instruction {
   let mut buf = vec![GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR];
   let mut payload = [0u8; FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut payload).expect("fill bet wire");
   buf.extend_from_slice(&payload);
   // Same account layout as get_quote_proxy.
   Instruction::new_with_bytes(agg_program_id(), &buf, get_quote_proxy_metas(market))
}

/// Decode packed `get_quote_proxy` return data (`ProxyQuoteData` entries).
pub fn decode_proxy_quote_return(data: &[u8]) -> Vec<(Pubkey, u64, u32)> {
   assert!(
      data.len() % PROXY_QUOTE_DATA_LEN == 0,
      "proxy quote return len {} not multiple of {}",
      data.len(),
      PROXY_QUOTE_DATA_LEN
   );
   let mut out = Vec::new();
   for chunk in data.chunks_exact(PROXY_QUOTE_DATA_LEN) {
      let mm = Pubkey::new_from_array(chunk[0..ADDRESS_LEN].try_into().unwrap());
      let max_amount = u64::from_le_bytes(chunk[ADDRESS_LEN..ADDRESS_LEN + U64_LEN].try_into().unwrap());
      let odds_scaled = u32::from_le_bytes(
         chunk[ADDRESS_LEN + U64_LEN..ADDRESS_LEN + U64_LEN + U32_LEN]
            .try_into()
            .unwrap(),
      );
      out.push((mm, max_amount, odds_scaled));
   }
   out
}

/// Decode one variable-length `get_parlay_quote_proxy` entry; returns `(mm, max, odds, leg_odds)`.
pub fn decode_proxy_parlay_quote_return(
   data: &[u8],
) -> Vec<(Pubkey, u64, u32, Vec<u32>)> {
   let mut out = Vec::new();
   let mut off = 0usize;
   while off < data.len() {
      assert!(
         data.len() - off >= PROXY_PARLAY_QUOTE_HEADER_LEN,
         "truncated parlay proxy return at off={off} len={}",
         data.len()
      );
      let mm = Pubkey::new_from_array(data[off..off + ADDRESS_LEN].try_into().unwrap());
      let max_amount = u64::from_le_bytes(
         data[off + ADDRESS_LEN..off + ADDRESS_LEN + U64_LEN]
            .try_into()
            .unwrap(),
      );
      let odds_scaled = u32::from_le_bytes(
         data[off + ADDRESS_LEN + U64_LEN..off + ADDRESS_LEN + U64_LEN + U32_LEN]
            .try_into()
            .unwrap(),
      );
      let num_legs = data[off + ADDRESS_LEN + U64_LEN + U32_LEN] as usize;
      let entry_len = proxy_parlay_quote_data_len(num_legs);
      assert!(
         off + entry_len <= data.len(),
         "parlay proxy entry overruns return data"
      );
      let mut leg_odds = Vec::with_capacity(num_legs);
      for i in 0..num_legs {
         let lo = off + PROXY_PARLAY_QUOTE_HEADER_LEN + i * U32_LEN;
         leg_odds.push(u32::from_le_bytes(data[lo..lo + U32_LEN].try_into().unwrap()));
      }
      out.push((mm, max_amount, odds_scaled, leg_odds));
      off += entry_len;
   }
   out
}

/// Decode `get_market_quotes_proxy` return for a known `num_sides`.
pub fn decode_market_quotes_proxy_return(data: &[u8], num_sides: u8) -> Vec<(Pubkey, Vec<u32>)> {
   let entry = proxy_market_mm_entry_wire_len(num_sides);
   assert!(
      data.len() % entry == 0,
      "market quotes return len {} not multiple of entry {}",
      data.len(),
      entry
   );
   let mut out = Vec::new();
   for chunk in data.chunks_exact(entry) {
      let mm = Pubkey::new_from_array(chunk[0..ADDRESS_LEN].try_into().unwrap());
      let mut sides = Vec::with_capacity(num_sides as usize);
      for i in 0..num_sides as usize {
         let lo = ADDRESS_LEN + i * U32_LEN;
         sides.push(u32::from_le_bytes(chunk[lo..lo + U32_LEN].try_into().unwrap()));
      }
      out.push((mm, sides));
   }
   out
}

/// Distinct soccer event ids for RFQ max-leg fixtures (`event` = `1000 + i`).
pub fn event_id_soccer_n(i: u16) -> spamm_aggregator::state::EventId {
   spamm_aggregator::state::EventId {
      event: 1000u64 + i as u64,
      league: 39,
      sport: spamm_aggregator::state::Sport::Soccer,
   }
}

/// Build N distinct two-outcome spread markets + three-outcome FT markets alternating.
pub fn rfq_max_leg_markets(n: usize) -> Vec<(MarketId, Vec<u8>)> {
   assert!(n >= 2 && n <= 10);
   let mut out = Vec::with_capacity(n);
   for i in 0..n {
      let eid = event_id_soccer_n(i as u16);
      if i % 2 == 0 {
         let m = market_spread_pregame(eid);
         let body = oracle_body_two_outcome(20_000, 20_000).to_vec();
         out.push((m, body));
      } else {
         let m = market_soccer_ft_pregame(eid);
         let body = oracle_body_three_outcome(20_000, 20_000, 20_000).to_vec();
         out.push((m, body));
      }
   }
   out
}

pub fn rfq_parlay_legs_from_markets(
   markets: &[MarketId],
   leg_odds: u32,
) -> [ParlayLegQuoted; spamm_aggregator::constants::MAX_RFQ_PARLAY_LEGS] {
   let gs = spamm_aggregator::state::EventGameState::zeroed();
   let mut live = Vec::with_capacity(markets.len());
   for (i, m) in markets.iter().enumerate() {
      let side = if i % 2 == 0 { 0u8 } else { 1u8 };
      live.push(super::fill::parlay_leg(*m, side, 1, gs).with_odds(leg_odds));
   }
   super::fill::parlay_legs_rfq(&live)
}
