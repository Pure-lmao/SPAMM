//! `get_market_quotes_proxy` Mollusk coverage.

use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::{
   FillBetIxData, FILL_BET_IX_DATA_LEN, GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR,
};
use spamm_aggregator::state::mm_quote::max_proxy_mms_for_market_quotes;
use spamm_aggregator::state::{EventGameState, MarketId};

use crate::common::{
   agg_program_id, assert_program_err, assert_spamm_err, decode_market_quotes_proxy_return,
   event_id_soccer, get_market_quotes_proxy_instruction, get_quote_proxy_metas,
   market_spread_pregame, mm_program_id, record_cu_success, system_owned_empty, Env,
};

fn quote_ix_data(market: MarketId) -> FillBetIxData {
   FillBetIxData {
      bet_id: 0,
      market_id: market,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   }
}

#[test]
fn get_market_quotes_proxy_spread_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let data = quote_ix_data(market);
   let r = env.run_ix(get_market_quotes_proxy_instruction(&data, &market));
   assert!(r.program_result.is_ok(), "{:?}", r);
   let num_sides = market.num_sides().unwrap();
   let rows = decode_market_quotes_proxy_return(&r.return_data, num_sides);
   assert_eq!(rows.len(), 1);
   assert_eq!(rows[0].0, mm_program_id());
   assert_eq!(rows[0].1.len(), num_sides as usize);
   assert!(rows[0].1.iter().all(|&o| o > 0));
   record_cu_success("get_market_quotes_proxy/spread", &r);
}

#[test]
fn get_market_quotes_proxy_no_quotes() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let data = quote_ix_data(market);
   let mut metas = get_quote_proxy_metas(&market);
   let bad = Pubkey::new_unique();
   env.upsert(bad, system_owned_empty());
   metas[3] = AccountMeta::new_readonly(bad, false);
   let mut buf = vec![GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR];
   let mut payload = [0u8; FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut payload).unwrap();
   buf.extend_from_slice(&payload);
   let ix = Instruction::new_with_bytes(agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::NoQuotesAvailable);
}

#[test]
fn get_market_quotes_proxy_too_many_mms_for_sides() {
   // mkt 7 → 9 sides → max_proxy_mms_for_market_quotes(9) = 15 (< MAX_NUMBER_OF_MMS_PROXY).
   let mut env = Env::new();
   let mut market = market_spread_pregame(event_id_soccer());
   market.mkt = 7;
   // Bootstrap still uses a normal 2-side market for MM init; we only need account metas duplicated.
   env.bootstrap_default_mm_spread();
   let data = quote_ix_data(market);
   let base = get_quote_proxy_metas(&market_spread_pregame(event_id_soccer()));
   let per_mm = &base[2..];
   let max_ok = max_proxy_mms_for_market_quotes(9);
   let mut metas = vec![base[0].clone(), base[1].clone()];
   for _ in 0..(max_ok + 1) {
      metas.extend_from_slice(per_mm);
   }
   let mut buf = vec![GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR];
   let mut payload = [0u8; FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut payload).unwrap();
   buf.extend_from_slice(&payload);
   let ix = Instruction::new_with_bytes(agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, solana_program_error::ProgramError::NotEnoughAccountKeys);
}
