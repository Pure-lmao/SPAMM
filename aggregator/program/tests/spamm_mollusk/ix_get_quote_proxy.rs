//! `get_quote_proxy` Mollusk coverage.

use solana_instruction::AccountMeta;
use solana_pubkey::Pubkey;

use solana_program_error::ProgramError;
use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::FillBetIxData;
use spamm_aggregator::state::EventGameState;

use crate::common::{
   assert_program_err, assert_spamm_err, decode_proxy_quote_return, event_id_soccer, get_quote_proxy_instruction,
   get_quote_proxy_metas, market_spread_pregame, mm_program_id, mm_quote_buffer_pda, record_cu_success,
   system_owned_empty, Env,
};

fn quote_ix_data(market: spamm_aggregator::state::MarketId, min_odds: u32) -> FillBetIxData {
   FillBetIxData {
      bet_id: 0,
      market_id: market,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: min_odds,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   }
}

#[test]
fn get_quote_proxy_one_mm_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let data = quote_ix_data(market, 15_000);
   let r = env.run_ix(get_quote_proxy_instruction(&data, &market));
   assert!(r.program_result.is_ok(), "{:?}", r);
   let quotes = decode_proxy_quote_return(&r.return_data);
   assert_eq!(quotes.len(), 1);
   assert_eq!(quotes[0].0, mm_program_id());
   assert!(quotes[0].1 > 0, "max_amount");
   assert!(quotes[0].2 > 15_000, "odds_scaled");
   record_cu_success("get_quote_proxy/1_mm", &r);
}

#[test]
fn get_quote_proxy_bad_mm_skipped_then_no_quotes() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let data = quote_ix_data(market, 15_000);
   let mut metas = get_quote_proxy_metas(&market);
   let bad = Pubkey::new_unique();
   env.upsert(bad, system_owned_empty());
   // Replace mm_config so verify_mm_config_pda fails and the MM is skipped.
   metas[3] = AccountMeta::new_readonly(bad, false);
   let mut buf = vec![spamm_aggregator::instructions::GET_QUOTE_PROXY_IX_DISCRIMINATOR];
   let mut payload = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut payload).unwrap();
   buf.extend_from_slice(&payload);
   let ix = solana_instruction::Instruction::new_with_bytes(
      crate::common::agg_program_id(),
      &buf,
      metas,
   );
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::NoQuotesAvailable);
}

#[test]
fn get_quote_proxy_duplicate_mm_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let data = quote_ix_data(market, 15_000);
   let mut metas = get_quote_proxy_metas(&market);
   let tail = metas[2..].to_vec();
   metas.extend(tail);
   let mut buf = vec![spamm_aggregator::instructions::GET_QUOTE_PROXY_IX_DISCRIMINATOR];
   let mut payload = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut payload).unwrap();
   buf.extend_from_slice(&payload);
   let ix = solana_instruction::Instruction::new_with_bytes(
      crate::common::agg_program_id(),
      &buf,
      metas,
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn get_quote_proxy_writes_quote_buffer() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let r = env.run_ix(get_quote_proxy_instruction(&quote_ix_data(market, 15_000), &market));
   assert!(r.program_result.is_ok(), "{:?}", r);
   let buf = env.get_account(&mm_quote_buffer_pda()).expect("quote buffer");
   assert_eq!(buf.data[0], spamm_aggregator::state::MM_QUOTE_BUFFER_DISCRIMINATOR);
   assert!(buf.data.len() > 1);
}
