//! Adversarial MM: below-min parlay quotes and short liability transfers.

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::{FillBetIxData, FillParlayIxData, FillRfqBetIxData};
use spamm_aggregator::state::EventGameState;

use crate::common::{
   assert_spamm_err, bet_pda_for, bet_token_ata, event_id_soccer, event_id_soccer_b, fill_bet_instruction_mms,
   fill_bet_netting_placeholder, fill_parlay_instruction_for, fill_rfq_bet_instruction_for,
   market_soccer_ft_pregame, market_spread_pregame, oracle_body_three_outcome, oracle_body_two_outcome,
   parlay_bet_pda_for, parlay_leg, parlay_legs_fill, sign_rfq_bet_quote_for_mm, system_owned_empty, user,
   user_collateral_ata, MmKeys, Env, RFQ_OFFER_EXPIRY,
};

#[test]
fn fill_parlay_slippage_from_adversarial_quote() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   env.bootstrap_adversarial_mm(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   let keys = MmKeys::adversarial();
   let bet = parlay_bet_pda_for(&user(), 9001);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let payload = FillParlayIxData {
      bet_id: 9001,
      amount: 5_000_000,
      min_odds_scaled: 16_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[
         parlay_leg(m1, 0, 1, EventGameState::zeroed()),
         parlay_leg(m2, 1, 1, EventGameState::zeroed()),
      ]),
   };
   let snap = env.snapshot_accounts(&[user_collateral_ata(), keys.collateral_ata()]);
   let r = env.run_ix(fill_parlay_instruction_for(keys, &payload, bet, bat, &[m1, m2]));
   assert_spamm_err(&r, SpammError::SlippageExceeded);
   env.assert_accounts_unchanged(&snap);
}

#[test]
fn fill_parlay_short_transfer_insufficient_liquidity() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   env.bootstrap_adversarial_mm(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   let keys = MmKeys::adversarial();
   let bet = parlay_bet_pda_for(&user(), 9002);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let payload = FillParlayIxData {
      bet_id: 9002,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[
         parlay_leg(m1, 0, 1, EventGameState::zeroed()),
         parlay_leg(m2, 1, 1, EventGameState::zeroed()),
      ]),
   };
   let snap = env.snapshot_accounts(&[user_collateral_ata(), keys.collateral_ata()]);
   let r = env.run_ix(fill_parlay_instruction_for(keys, &payload, bet, bat, &[m1, m2]));
   assert_spamm_err(&r, SpammError::InsufficientMmLiquidity);
   env.assert_accounts_unchanged(&snap);
}

#[test]
fn fill_rfq_bet_short_transfer_insufficient_liquidity() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.bootstrap_adversarial_mm(&[(mid, body.as_slice())]);
   let keys = MmKeys::adversarial();
   let bet_id = 9003u64;
   let sig = sign_rfq_bet_quote_for_mm(
      &user(),
      &keys.program_id,
      bet_id,
      &mid,
      &EventGameState::zeroed(),
      1,
      0,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillRfqBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      odds_scaled: 20_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
      max_stake: 50_000_000,
      offer_expiry: RFQ_OFFER_EXPIRY,
   };
   let snap = env.snapshot_accounts(&[user_collateral_ata()]);
   let r = env.run_ix(fill_rfq_bet_instruction_for(
      &keys,
      &data,
      &sig,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert_spamm_err(&r, SpammError::InsufficientMmLiquidity);
   env.assert_accounts_unchanged(&snap);
}

#[test]
fn fill_bet_short_transfer_skips_maker() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.bootstrap_adversarial_mm(&[(mid, body.as_slice())]);
   let keys = MmKeys::adversarial();
   let bet = bet_pda_for(&user(), 9004);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 9004,
      market_id: mid,
      side: 0,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let snap = env.snapshot_accounts(&[user_collateral_ata()]);
   let r = env.run_ix(fill_bet_instruction_mms(
      &data,
      bet,
      bat,
      &[(&keys, fill_bet_netting_placeholder())],
      &mid,
   ));
   assert_spamm_err(&r, SpammError::NoQuotesAvailable);
   env.assert_accounts_unchanged(&snap);
}
