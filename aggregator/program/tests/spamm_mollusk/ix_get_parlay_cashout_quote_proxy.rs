//! `get_parlay_cashout_quote_proxy` Mollusk coverage.

use spamm_aggregator::instructions::{FillParlayCashoutIxData, FillParlayIxData};
use spamm_aggregator::state::{EventGameState, MarketId};

use crate::common::{
   bet_token_ata, decode_proxy_cashout_quote_return, event_id_soccer, event_id_soccer_b,
   fill_parlay_instruction, get_parlay_cashout_quote_proxy_instruction, market_soccer_ft_pregame,
   market_spread_pregame, mm_program_id, oracle_body_three_outcome, oracle_body_two_outcome,
   parlay_bet_pda_for, parlay_cashout_snapshots, parlay_leg, parlay_legs_fill, record_cu_success,
   system_owned_empty, user, Env,
};

fn two_leg_setup() -> (Env, MarketId, MarketId) {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   (env, m1, m2)
}

#[test]
fn get_parlay_cashout_quote_proxy_two_leg_success() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet_id = 3401u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let fill = FillParlayIxData {
      bet_id,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   assert!(env
      .run_ix(fill_parlay_instruction(&fill, bet, bat, &[m1, m2]))
      .program_result
      .is_ok());

   let payload = FillParlayCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id: 0,
      amount: 5_000_000,
      min_payout: 1,
      num_legs: 2,
      snapshots: parlay_cashout_snapshots(2, 1),
   };
   let r = env.run_ix(get_parlay_cashout_quote_proxy_instruction(
      &payload,
      bet,
      &[m1, m2],
   ));
   assert!(r.program_result.is_ok(), "{:?}", r);
   let quotes = decode_proxy_cashout_quote_return(&r.return_data);
   assert_eq!(quotes.len(), 1);
   assert_eq!(quotes[0].0, mm_program_id());
   assert!(quotes[0].1 > 0);
   record_cu_success("get_parlay_cashout_quote_proxy/2_leg", &r);
}
