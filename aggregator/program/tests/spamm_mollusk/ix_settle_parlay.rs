//! `settle_parlay` tests.

use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;

use spamm_aggregator::instructions::FillBetIxData;
use spamm_aggregator::instructions::FillParlayIxData;

use spamm_aggregator::parlay_helpers::compute_modified_parlay_settlement;
use spamm_aggregator::state::EventGameState;
use spamm_aggregator::state::ParlayBetAccountData;
use spamm_aggregator::state::account_bet::BetResult;

use crate::common::{
   admin, agg_program_id, assert_account_closed_or_system_empty, assert_program_err, bet_pda_for, bet_token_ata,
   config_pda, decode_parlay_bet, encumbrance_pda, event_id_soccer, event_id_soccer_b, fill_bet_instruction,
   fill_bet_netting_placeholder, fill_parlay_instruction, grade_parlay_instruction, grade_parlay_leg_mask,
   market_soccer_ft_pregame, market_spread_pregame,
   oracle_body_three_outcome, oracle_body_two_outcome, parlay_bet_pda_for, parlay_leg, parlay_table,
   read_encumbrance, read_token_balance, record_cu_success, settle_parlay_instruction, settle_parlay_metas, system_owned_empty, user, user_collateral_ata, wrong_signer, Env,
};

/// Two-leg parlay @ 2.0 per leg (MM oracle `20_000` scaled), $4 stake.
const MODIFIED_WIN_STAKE: u64 = 4_000_000;
/// Push + Won: void leg at 1.0, winner at 2.0 → `4_000_000 * 20_000 / 10_000`.
const EXPECTED_PAYOUT_VOID_LEG_WON: u64 = 8_000_000;
/// HalfWon + Won: half refunded + half at 2.0² → `2_000_000 + 2_000_000 * 40_000 / 10_000`.
const EXPECTED_PAYOUT_HALF_WON: u64 = 10_000_000;
/// HalfLost + Won: half forfeited, remainder at 2.0 → `2_000_000 * 20_000 / 10_000`.
const EXPECTED_PAYOUT_HALF_LOST: u64 = 4_000_000;

fn expected_modified_win_payout(pd: &ParlayBetAccountData) -> u64 {
   let (ret, lost) = compute_modified_parlay_settlement(
      pd.amount,
      pd.num_legs as usize,
      &pd.legs,
   )
   .expect("compute_modified_parlay_settlement");
   assert!(!lost, "modified-win fixture should not be a full loss");
   ret
}

fn assert_settle_modified_win_payout(
   env: &mut Env,
   bet_id: u64,
   leg_grades: &[u8],
   expected_payout: u64,
   cu_label: &str,
) {
   fill_parlay_and_grade(env, bet_id, leg_grades);
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(env, &bet);
   assert!(matches!(pd.result, BetResult::ModifiedWin));
   assert_eq!(pd.legs.leg_0.odds_scaled, 20_000, "fixture leg0 odds");
   assert_eq!(pd.legs.leg_1.odds_scaled, 20_000, "fixture leg1 odds");
   assert_eq!(
      expected_modified_win_payout(&pd),
      expected_payout,
      "on-chain settlement math mismatch"
   );
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(env, &user_collateral_ata());
   let pre_e = read_encumbrance(env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(env, &bet);
   assert_account_closed_or_system_empty(env, &bat);
   assert_eq!(
      read_token_balance(env, &user_collateral_ata()),
      pre_u.saturating_add(expected_payout)
   );
   assert_eq!(
      read_encumbrance(env, &encumbrance_pda()),
      pre_e - profit as i64
   );
   record_cu_success(cu_label, &r);
}

fn fill_parlay_and_grade(env: &mut Env, bet_id: u64, leg_grades: &[u8]) {
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id,
      amount: MODIFIED_WIN_STAKE,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   assert!(env.run_ix(ix).program_result.is_ok());
   let mask = grade_parlay_leg_mask(leg_grades);
   let g = grade_parlay_instruction(&[&mask], &[bet], admin());
   assert!(env.run_ix(g).program_result.is_ok());
}

fn fill_parlay_won_path(env: &mut Env, bet_id: u64) {
   fill_parlay_and_grade(env, bet_id, &[BetResult::Won as u8, BetResult::Won as u8]);
}

#[test]
fn settle_parlay_won() {
   let mut env = Env::new();
   fill_parlay_won_path(&mut env, 500);
   let bet = parlay_bet_pda_for(&user(), 500);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(pd.payout)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - profit as i64
   );
   record_cu_success("settle_parlay/won", &r);
}

#[test]
fn settle_parlay_lost_success() {
   let mut env = Env::new();
   fill_parlay_and_grade(&mut env, 510, &[BetResult::Lost as u8, BetResult::Lost as u8]);
   let bet = parlay_bet_pda_for(&user(), 510);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(read_token_balance(&env, &user_collateral_ata()), pre_u);
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - profit as i64
   );
   record_cu_success("settle_parlay/lost", &r);
}

#[test]
fn settle_parlay_push_success() {
   let mut env = Env::new();
   fill_parlay_and_grade(&mut env, 511, &[BetResult::Push as u8, BetResult::Push as u8]);
   let bet = parlay_bet_pda_for(&user(), 511);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(pd.amount)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - profit as i64
   );
   record_cu_success("settle_parlay/push", &r);
}

#[test]
fn settle_parlay_cancelled_success() {
   let mut env = Env::new();
   fill_parlay_and_grade(&mut env, 512, &[BetResult::Cancelled as u8, BetResult::Cancelled as u8]);
   let bet = parlay_bet_pda_for(&user(), 512);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(pd.amount)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - profit as i64
   );
   record_cu_success("settle_parlay/cancelled", &r);
}

#[test]
fn settle_parlay_rolled_back_success() {
   let mut env = Env::new();
   fill_parlay_and_grade(&mut env, 513, &[BetResult::RolledBack as u8, BetResult::RolledBack as u8]);
   let bet = parlay_bet_pda_for(&user(), 513);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(pd.amount)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - profit as i64
   );
   record_cu_success("settle_parlay/rolled_back", &r);
}

#[test]
fn settle_parlay_void_leg_modified_win_payout() {
   let mut env = Env::new();
   assert_settle_modified_win_payout(
      &mut env,
      516,
      &[BetResult::Push as u8, BetResult::Won as u8],
      EXPECTED_PAYOUT_VOID_LEG_WON,
      "settle_parlay/void_leg_modified_payout",
   );
}

#[test]
fn settle_parlay_half_won_modified_win_payout() {
   let mut env = Env::new();
   assert_settle_modified_win_payout(
      &mut env,
      514,
      &[BetResult::HalfWon as u8, BetResult::Won as u8],
      EXPECTED_PAYOUT_HALF_WON,
      "settle_parlay/half_won_modified_payout",
   );
}

#[test]
fn settle_parlay_half_lost_modified_win_payout() {
   let mut env = Env::new();
   assert_settle_modified_win_payout(
      &mut env,
      515,
      &[BetResult::HalfLost as u8, BetResult::Won as u8],
      EXPECTED_PAYOUT_HALF_LOST,
      "settle_parlay/half_lost_modified_payout",
   );
}

#[test]
fn settle_parlay_pending_fails() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   let bet = parlay_bet_pda_for(&user(), 501);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id: 501,
      amount: 4_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   assert!(env.run_ix(ix).program_result.is_ok());
   let r = env.run_ix(settle_parlay_instruction(bet, bat));
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_parlay_mm_address_mismatch() {
   let mut env = Env::new();
   fill_parlay_won_path(&mut env, 502);
   let bet = parlay_bet_pda_for(&user(), 502);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_parlay_metas(bet, bat);
   metas[9] = AccountMeta::new_readonly(user(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[7u8], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_parlay_wrong_user_account_fails() {
   let mut env = Env::new();
   fill_parlay_won_path(&mut env, 520);
   let bet = parlay_bet_pda_for(&user(), 520);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_parlay_metas(bet, bat);
   metas[4] = AccountMeta::new_readonly(wrong_signer(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[7u8], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_parlay_wrong_feepayer_fails() {
   let mut env = Env::new();
   fill_parlay_won_path(&mut env, 521);
   let bet = parlay_bet_pda_for(&user(), 521);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_parlay_metas(bet, bat);
   metas[3] = AccountMeta::new(wrong_signer(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[7u8], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

fn grade_bets_ix(results: &[u8], bets: &[solana_pubkey::Pubkey]) -> Instruction {
   let mut metas = vec![
      AccountMeta::new(admin(), true),
      AccountMeta::new_readonly(config_pda(), false),
   ];
   for b in bets {
      metas.push(AccountMeta::new(*b, false));
   }
   let mut buf = vec![5u8];
   buf.extend_from_slice(results);
   Instruction::new_with_bytes(agg_program_id(), &buf, metas)
}

#[test]
fn settle_parlay_regular_bet_account_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 530);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 530,
      market_id: mid,
      side: 0,
      amount: 3_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(&data, bet, bat, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());
   let g = grade_bets_ix(&[BetResult::Won as u8], &[bet]);
   assert!(env.run_ix(g).program_result.is_ok());
   let r = env.run_ix(settle_parlay_instruction(bet, bat));
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_parlay_second_call_fails() {
   let mut env = Env::new();
   fill_parlay_won_path(&mut env, 540);
   let bet = parlay_bet_pda_for(&user(), 540);
   let bat = bet_token_ata(&bet);
   assert!(env.run_ix(settle_parlay_instruction(bet, bat)).program_result.is_ok());
   let r2 = env.run_ix(settle_parlay_instruction(bet, bat));
   assert_program_err(&r2, ProgramError::InvalidInstructionData);
}
