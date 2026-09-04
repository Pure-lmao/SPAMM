//! `settle_freebet_parlay` coverage.

use spamm_aggregator::instructions::FillParlayIxData;
use spamm_aggregator::state::account_bet::BetResult;
use spamm_aggregator::state::{EventGameState, MarketId};

use crate::common::{
   admin, assert_ok_record_cu, bet_token_ata, bootstrap_issued_freebet, decode_freebet, decode_issuer,
   event_id_soccer, event_id_soccer_b, freebet_fill_parlay_instruction, grade_parlay_instruction,
   grade_parlay_leg_mask, liability_token_ata, market_soccer_ft_pregame, market_spread_pregame,
   mm_collateral_ata, oracle_body_three_outcome, oracle_body_two_outcome, parlay_bet_pda_for, parlay_leg,
   parlay_legs_fill, read_token_balance, settle_freebet_parlay_instruction, system_owned_empty, user, Env,
   FREEBET_ID_BASIC,
};

const STAKE: u64 = 5_000_000;

#[test]
fn settle_freebet_parlay_account_layout_has_clock_at_13() {
   let bet = parlay_bet_pda_for(&user(), 1);
   let metas = settle_freebet_parlay_instruction(bet, bet_token_ata(&bet), 1, FREEBET_ID_BASIC).accounts;
   assert_eq!(metas.len(), 18);
   assert_eq!(metas[13].pubkey, crate::common::clock_sysvar_pubkey());
}

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
fn settle_freebet_parlay_won_consumes() {
   let (mut env, m1, m2) = two_leg_setup();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 200_000, 2, &[], &[]);
   let bet_id = 911u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id,
      amount: STAKE,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   assert!(env
      .run_ix(freebet_fill_parlay_instruction(
         FREEBET_ID_BASIC,
         &payload,
         bet,
         bat,
         &[m1, m2],
      ))
      .program_result
      .is_ok());
   let mask = grade_parlay_leg_mask(&[BetResult::Won as u8, BetResult::Won as u8]);
   assert!(env
      .run_ix(grade_parlay_instruction(&mask, bet, admin()))
      .program_result
      .is_ok());
   let r = env.run_ix(settle_freebet_parlay_instruction(bet, bat, bet_id, FREEBET_ID_BASIC));
   assert_ok_record_cu("settle_freebet_parlay/won", &r);
   assert_eq!(decode_issuer(&env).open_count, 0);
}

fn fill_grade_freebet_parlay(env: &mut Env, m1: MarketId, m2: MarketId, bet_id: u64, grades: &[u8]) {
   bootstrap_issued_freebet(env, FREEBET_ID_BASIC, STAKE, 10_000, 200_000, 2, &[], &[]);
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id,
      amount: STAKE,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   assert!(env
      .run_ix(freebet_fill_parlay_instruction(
         FREEBET_ID_BASIC,
         &payload,
         bet,
         bat,
         &[m1, m2],
      ))
      .program_result
      .is_ok());
   let mask = grade_parlay_leg_mask(grades);
   assert!(env
      .run_ix(grade_parlay_instruction(&mask, bet, admin()))
      .program_result
      .is_ok());
}

#[test]
fn settle_freebet_parlay_lost_consumes() {
   let (mut env, m1, m2) = two_leg_setup();
   fill_grade_freebet_parlay(
      &mut env,
      m1,
      m2,
      889,
      &[BetResult::Lost as u8, BetResult::Lost as u8],
   );
   let bet = parlay_bet_pda_for(&user(), 889);
   let bat = bet_token_ata(&bet);
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_l = read_token_balance(&env, &liability_token_ata());
   let r = env.run_ix(settle_freebet_parlay_instruction(bet, bat, 889, FREEBET_ID_BASIC));
   assert_ok_record_cu("settle_freebet_parlay/lost", &r);
   assert_eq!(decode_issuer(&env).open_count, 0);
   assert_eq!(read_token_balance(&env, &mm_collateral_ata()), pre_mm);
   assert!(read_token_balance(&env, &liability_token_ata()) >= pre_l);
}

#[test]
fn settle_freebet_parlay_cancelled_reinstates() {
   let (mut env, m1, m2) = two_leg_setup();
   fill_grade_freebet_parlay(
      &mut env,
      m1,
      m2,
      890,
      &[BetResult::Cancelled as u8, BetResult::Push as u8],
   );
   let bet = parlay_bet_pda_for(&user(), 890);
   let bat = bet_token_ata(&bet);
   let r = env.run_ix(settle_freebet_parlay_instruction(bet, bat, 890, FREEBET_ID_BASIC));
   assert_ok_record_cu("settle_freebet_parlay/cancelled_reinstates", &r);
   assert_eq!(decode_issuer(&env).open_count, 1);
   assert!(matches!(
      decode_freebet(&env, FREEBET_ID_BASIC).state,
      spamm_aggregator::state::FreebetState::Available
   ));
}
