//! `get_parlay_quote_proxy` Mollusk coverage.

use solana_instruction::AccountMeta;
use solana_pubkey::Pubkey;

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::FillParlayIxData;
use spamm_aggregator::state::EventGameState;

use crate::common::{
   assert_spamm_err, decode_proxy_parlay_quote_return, event_id_soccer, event_id_soccer_b,
   get_parlay_quote_proxy_instruction, get_parlay_quote_proxy_metas, market_soccer_ft_pregame,
   market_spread_pregame, mm_program_id, oracle_body_three_outcome, oracle_body_two_outcome,
   parlay_leg, parlay_legs_fill, record_cu_success, system_owned_empty, uniform_parlay_combined_odds,
   Env,
};

fn two_leg_env() -> (crate::common::Env, spamm_aggregator::state::MarketId, spamm_aggregator::state::MarketId) {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   (env, m1, m2)
}

#[test]
fn get_parlay_quote_proxy_two_legs_success() {
   let (mut env, m1, m2) = two_leg_env();
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id: 0,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   let r = env.run_ix(get_parlay_quote_proxy_instruction(&payload, &[m1, m2]));
   assert!(r.program_result.is_ok(), "{:?}", r);
   let quotes = decode_proxy_parlay_quote_return(&r.return_data);
   assert_eq!(quotes.len(), 1);
   assert_eq!(quotes[0].0, mm_program_id());
   assert!(quotes[0].1 > 0);
   assert_eq!(quotes[0].2, uniform_parlay_combined_odds(20_000, 2));
   assert_eq!(quotes[0].3, vec![20_000, 20_000]);
   record_cu_success("get_parlay_quote_proxy/2_leg", &r);
}

#[test]
fn get_parlay_quote_proxy_no_quotes() {
   let (mut env, m1, m2) = two_leg_env();
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id: 0,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   let mut metas = get_parlay_quote_proxy_metas(&[m1, m2]);
   let bad = Pubkey::new_unique();
   env.upsert(bad, system_owned_empty());
   metas[3] = AccountMeta::new_readonly(bad, false); // mm_config
   let n = payload.num_legs as usize;
   let wire_len = FillParlayIxData::wire_len(n);
   let mut wire = vec![0u8; wire_len];
   payload.write_wire(&mut wire).unwrap();
   let mut buf = vec![spamm_aggregator::instructions::GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR];
   buf.extend_from_slice(&wire);
   let ix = solana_instruction::Instruction::new_with_bytes(
      crate::common::agg_program_id(),
      &buf,
      metas,
   );
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::NoQuotesAvailable);
}
