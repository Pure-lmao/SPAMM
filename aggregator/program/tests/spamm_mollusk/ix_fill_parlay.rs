//! `fill_parlay` tests.

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;

use spamm_aggregator::instructions::FillParlayIxData;
use spamm_aggregator::state::MarketId;

use spamm_aggregator::constants::{MAX_PARLAY_LEGS, ODDS_SCALE};

use crate::common::{
   assert_parlay_after_fill, assert_program_err, bet_token_ata, config_pda, event_id_soccer, event_id_soccer_b,
   event_id_soccer_c, event_id_soccer_d, event_id_soccer_e, encumbrance_pda, fill_parlay_instruction,
   fill_parlay_metas, market_soccer_ft_pregame, market_spread_pregame, oracle_body_three_outcome,
   oracle_body_two_outcome, parlay_bet_pda_for, parlay_leg, parlay_table, read_encumbrance,
   record_cu_success, system_owned_empty, uniform_parlay_combined_odds, user, admin, Env,
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
fn fill_parlay_two_legs_success() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet_id = crate::common::BET_ID_PARLAY;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, [0u8; 32]);
   let l1 = parlay_leg(m2, 1, 1, [0u8; 32]);
   let payload = FillParlayIxData {
      bet_id,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   let enc_before = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_parlay_after_fill(
      &env,
      &bet,
      &encumbrance_pda(),
      enc_before,
      5_000_000,
      2,
      uniform_parlay_combined_odds(20_000, 2),
   );
   record_cu_success("fill_parlay/2_leg", &r);
}

#[test]
fn fill_parlay_num_legs_too_low() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet = parlay_bet_pda_for(&user(), 200);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, [0u8; 32]);
   let payload = FillParlayIxData {
      bet_id: 200,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 1,
      legs: parlay_table(&[l0]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_parlay_paused() {
   let (mut env, m1, m2) = two_leg_setup();
   let pause = env.agg_ix(
      1,
      vec![0u8],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   assert!(env.run_ix(pause).program_result.is_ok());
   let bet = parlay_bet_pda_for(&user(), 201);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, [0u8; 32]);
   let l1 = parlay_leg(m2, 1, 1, [0u8; 32]);
   let payload = FillParlayIxData {
      bet_id: 201,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn fill_parlay_wrong_mm_program() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet = parlay_bet_pda_for(&user(), 202);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, [0u8; 32]);
   let l1 = parlay_leg(m2, 1, 1, [0u8; 32]);
   let payload = FillParlayIxData {
      bet_id: 202,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   let mut metas = crate::common::fill_parlay_metas(bet, bat, &[m1, m2]);
   metas[10] = AccountMeta::new_readonly(user(), false);
   let mut buf = vec![4u8];
   let mut w = [0u8; spamm_aggregator::instructions::FILL_PARLAY_IX_DATA_LEN];
   payload.write_wire(&mut w).unwrap();
   buf.extend_from_slice(&w);
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_parlay_amount_zero_rejected() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet = parlay_bet_pda_for(&user(), 210);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, [0u8; 32]);
   let l1 = parlay_leg(m2, 1, 1, [0u8; 32]);
   let payload = FillParlayIxData {
      bet_id: 210,
      amount: 0,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_parlay_num_legs_above_max_rejected() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet = parlay_bet_pda_for(&user(), 211);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, [0u8; 32]);
   let l1 = parlay_leg(m2, 1, 1, [0u8; 32]);
   let payload = FillParlayIxData {
      bet_id: 211,
      amount: 1_000_000,
      min_odds_scaled: 15_000,
      num_legs: (MAX_PARLAY_LEGS + 1) as u8,
      legs: parlay_table(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_parlay_leg_accounts_len_mismatch_rejected() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet = parlay_bet_pda_for(&user(), 212);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, [0u8; 32]);
   let l1 = parlay_leg(m2, 1, 1, [0u8; 32]);
   let payload = FillParlayIxData {
      bet_id: 212,
      amount: 2_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   let metas = fill_parlay_metas(bet, bat, &[m1]);
   let mut buf = vec![4u8];
   let mut w = [0u8; spamm_aggregator::instructions::FILL_PARLAY_IX_DATA_LEN];
   payload.write_wire(&mut w).unwrap();
   buf.extend_from_slice(&w);
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::NotEnoughAccountKeys);
}

#[test]
fn fill_parlay_side_invalid_rejected() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet = parlay_bet_pda_for(&user(), 213);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 3, 1, [0u8; 32]);
   let l1 = parlay_leg(m2, 1, 1, [0u8; 32]);
   let payload = FillParlayIxData {
      bet_id: 213,
      amount: 2_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_parlay_min_odds_at_scale_rejected() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet = parlay_bet_pda_for(&user(), 214);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, [0u8; 32]);
   let l1 = parlay_leg(m2, 1, 1, [0u8; 32]);
   let payload = FillParlayIxData {
      bet_id: 214,
      amount: 2_000_000,
      min_odds_scaled: ODDS_SCALE as u32,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_parlay_duplicate_event_id_rejected() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let m_spread = market_spread_pregame(eid);
   let m_ft = market_soccer_ft_pregame(eid);
   let b2 = oracle_body_two_outcome(20_000, 20_000);
   let b3 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m_spread, b2.as_slice()), (m_ft, b3.as_slice())]);
   let bet = parlay_bet_pda_for(&user(), 215);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m_spread, 0, 1, [0u8; 32]);
   let l1 = parlay_leg(m_ft, 1, 1, [0u8; 32]);
   let payload = FillParlayIxData {
      bet_id: 215,
      amount: 2_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m_spread, m_ft]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

fn n_leg_env(n: usize) -> (Env, Vec<MarketId>) {
   assert!(n >= 2 && n <= MAX_PARLAY_LEGS);
   let mut env = Env::new();
   let eids = [
      event_id_soccer(),
      event_id_soccer_b(),
      event_id_soccer_c(),
      event_id_soccer_d(),
      event_id_soccer_e(),
   ];
   let mut packed: Vec<(MarketId, [u8; 8])> = Vec::with_capacity(n);
   for e in eids[..n].iter() {
      packed.push((market_spread_pregame(*e), oracle_body_two_outcome(20_000, 20_000)));
   }
   let refs: Vec<(MarketId, &[u8])> = packed.iter().map(|(m, b)| (*m, b.as_slice())).collect();
   let _ = env.bootstrap_mm_with_markets(&refs);
   let mts: Vec<MarketId> = packed.iter().map(|(m, _)| *m).collect();
   (env, mts)
}

#[test]
fn fill_parlay_three_legs_success() {
   let (mut env, mts) = n_leg_env(3);
   let markets = mts.as_slice();
   let bet = parlay_bet_pda_for(&user(), 220);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let legs: Vec<_> = markets
      .iter()
      .enumerate()
      .map(|(i, mid)| parlay_leg(*mid, (i % 2) as u8, 1, [0u8; 32]))
      .collect();
   let payload = FillParlayIxData {
      bet_id: 220,
      amount: 3_000_000,
      min_odds_scaled: 15_000,
      num_legs: 3,
      legs: parlay_table(&legs),
   };
   let enc_before = read_encumbrance(&env, &encumbrance_pda());
   let ix = fill_parlay_instruction(&payload, bet, bat, markets);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_parlay_after_fill(
      &env,
      &bet,
      &encumbrance_pda(),
      enc_before,
      3_000_000,
      3,
      uniform_parlay_combined_odds(20_000, 3),
   );
   record_cu_success("fill_parlay/3_leg", &r);
}

#[test]
fn fill_parlay_four_legs_success() {
   let (mut env, mts) = n_leg_env(4);
   let markets = mts.as_slice();
   let bet = parlay_bet_pda_for(&user(), 222);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let legs: Vec<_> = markets
      .iter()
      .enumerate()
      .map(|(i, mid)| parlay_leg(*mid, (i % 2) as u8, 1, [0u8; 32]))
      .collect();
   let payload = FillParlayIxData {
      bet_id: 222,
      amount: 3_500_000,
      min_odds_scaled: 15_000,
      num_legs: 4,
      legs: parlay_table(&legs),
   };
   let enc_before = read_encumbrance(&env, &encumbrance_pda());
   let ix = fill_parlay_instruction(&payload, bet, bat, markets);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_parlay_after_fill(
      &env,
      &bet,
      &encumbrance_pda(),
      enc_before,
      3_500_000,
      4,
      uniform_parlay_combined_odds(20_000, 4),
   );
   record_cu_success("fill_parlay/4_leg", &r);
}

#[test]
fn fill_parlay_five_legs_success() {
   let (mut env, mts) = n_leg_env(5);
   let markets = mts.as_slice();
   let bet = parlay_bet_pda_for(&user(), 221);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let legs: Vec<_> = markets
      .iter()
      .enumerate()
      .map(|(i, mid)| parlay_leg(*mid, (i % 2) as u8, 1, [0u8; 32]))
      .collect();
   let payload = FillParlayIxData {
      bet_id: 221,
      amount: 2_000_000,
      min_odds_scaled: 15_000,
      num_legs: 5,
      legs: parlay_table(&legs),
   };
   let enc_before = read_encumbrance(&env, &encumbrance_pda());
   let ix = fill_parlay_instruction(&payload, bet, bat, markets);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_parlay_after_fill(
      &env,
      &bet,
      &encumbrance_pda(),
      enc_before,
      2_000_000,
      5,
      uniform_parlay_combined_odds(20_000, 5),
   );
   record_cu_success("fill_parlay/5_leg", &r);
}
