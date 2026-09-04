//! `settle_parlay` tests.

use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::{
   FillBetIxData, FillParlayIxData, FillRfqParlayIxData, GRADE_BETS_IX_DISCRIMINATOR,
   SETTLE_PARLAY_IX_DISCRIMINATOR,
};

use spamm_aggregator::constants::MAX_RFQ_PARLAY_LEGS;
use spamm_aggregator::parlay_helpers::compute_modified_parlay_settlement;
use spamm_aggregator::state::EventGameState;
use spamm_aggregator::state::ParlayLegSettleView;
use spamm_aggregator::state::account_bet::BetResult;
use crate::common::{
   admin, agg_program_id, assert_account_closed_or_system_empty, assert_program_err, assert_spamm_err,
   bet_pda_for, bet_token_ata, config_pda, decode_parlay_bet, DecodedParlayBet, encumbrance_pda, event_id_soccer,
   event_id_soccer_b, fill_bet_instruction, fill_bet_netting_placeholder, fill_parlay_instruction,
   fill_rfq_parlay_instruction, grade_parlay_instruction, grade_parlay_leg_mask, liability_token_ata,
   market_soccer_ft_pregame, market_spread_pregame, mm_collateral_ata, oracle_body_three_outcome,
   oracle_body_two_outcome, parlay_bet_pda_for, parlay_leg, parlay_legs_fill, parlay_legs_rfq,
   read_encumbrance, read_token_balance, record_cu_success, rfq_max_leg_markets,
   rfq_parlay_legs_from_markets, settle_parlay_instruction, settle_parlay_metas,
   sign_rfq_parlay_quote, system_owned_empty, uniform_parlay_combined_odds, user, user_collateral_ata,
   wrong_signer, Env, RFQ_OFFER_EXPIRY,
};

/// Two-leg parlay @ 2.0 per leg (MM oracle `20_000` scaled), $4 stake.
const MODIFIED_WIN_STAKE: u64 = 4_000_000;
/// Push + Won: void leg at 1.0, winner at 2.0 → `4_000_000 * 20_000 / 10_000`.
const EXPECTED_PAYOUT_VOID_LEG_WON: u64 = 8_000_000;
/// HalfWon + Won: two-path ½×(odds+1) then ×odds → `4_000_000 * 1.5 * 2`.
const EXPECTED_PAYOUT_HALF_WON: u64 = 12_000_000;
/// HalfLost + Won: half forfeited, remainder at 2.0 → `2_000_000 * 20_000 / 10_000`.
const EXPECTED_PAYOUT_HALF_LOST: u64 = 4_000_000;

fn expected_modified_win_payout(pd: &DecodedParlayBet) -> u64 {
   let n = pd.num_legs as usize;
   let mut views = [ParlayLegSettleView {
      event_id: pd.legs[0].market_id.event_id,
      odds_scaled: 0,
      result: BetResult::Pending,
   }; MAX_RFQ_PARLAY_LEGS];
   for i in 0..n {
      views[i] = ParlayLegSettleView {
         event_id: pd.legs[i].market_id.event_id,
         odds_scaled: pd.legs[i].odds_scaled,
         result: pd.legs[i].result,
      };
   }
   let (ret, lost) = compute_modified_parlay_settlement(pd.amount, n, &views[..n])
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
   assert_eq!(pd.legs[0].odds_scaled, 20_000, "fixture leg0 odds");
   assert_eq!(pd.legs[1].odds_scaled, 20_000, "fixture leg1 odds");
   assert_eq!(
      expected_modified_win_payout(&pd),
      expected_payout,
      "on-chain settlement math mismatch"
   );
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(env, &user_collateral_ata());
   let pre_e = read_encumbrance(env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
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
      legs: parlay_legs_fill(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   assert!(env.run_ix(ix).program_result.is_ok());
   let mask = grade_parlay_leg_mask(leg_grades);
   let g = grade_parlay_instruction(&mask, bet, admin());
   assert!(env.run_ix(g).program_result.is_ok());
}

fn fill_parlay_won_path(env: &mut Env, bet_id: u64) {
   fill_parlay_and_grade(env, bet_id, &[BetResult::Won as u8, BetResult::Won as u8]);
}

#[test]
fn settle_parlay_won() {
   let mut env = Env::new();
   fill_parlay_won_path(&mut env, 500);
   let bet_id = 500u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
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
   let bet_id = 510u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_l = read_token_balance(&env, &liability_token_ata());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(read_token_balance(&env, &user_collateral_ata()), pre_u);
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - profit as i64
   );
   assert_eq!(read_token_balance(&env, &mm_collateral_ata()), pre_mm);
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      pre_l.saturating_add(pd.amount)
   );
   record_cu_success("settle_parlay/lost", &r);
}

#[test]
fn settle_parlay_push_success() {
   let mut env = Env::new();
   fill_parlay_and_grade(&mut env, 511, &[BetResult::Push as u8, BetResult::Push as u8]);
   let bet_id = 511u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
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
   let bet_id = 512u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
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
   let bet_id = 513u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
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
fn settle_parlay_all_half_lost_sequential_refund() {
   let mut env = Env::new();
   let bet_id = 517u64;
   fill_parlay_and_grade(
      &mut env,
      bet_id,
      &[BetResult::HalfLost as u8, BetResult::HalfLost as u8],
   );
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   assert!(matches!(pd.result, BetResult::ModifiedWin));
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(MODIFIED_WIN_STAKE / 4)
   );
   record_cu_success("settle_parlay/all_half_lost_refund", &r);
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
   let bet_id = 501u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id,
      amount: 4_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   assert!(env.run_ix(ix).program_result.is_ok());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
   assert_spamm_err(&r, SpammError::BetNotGraded);
}

#[test]
fn settle_parlay_mm_address_mismatch() {
   let mut env = Env::new();
   fill_parlay_won_path(&mut env, 502);
   let bet_id = 502u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_parlay_metas(bet, bat, bet_id);
   metas[9] = AccountMeta::new_readonly(user(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[SETTLE_PARLAY_IX_DISCRIMINATOR], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_parlay_dummy_mm_config_fails() {
   let mut env = Env::new();
   fill_parlay_and_grade(&mut env, 522, &[BetResult::Lost as u8, BetResult::Lost as u8]);
   let bet_id = 522u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let dummy_config = solana_pubkey::Pubkey::new_from_array([0xAB; 32]);
   env.upsert(dummy_config, system_owned_empty());
   let mut metas = settle_parlay_metas(bet, bat, bet_id);
   metas[10] = AccountMeta::new_readonly(dummy_config, false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[SETTLE_PARLAY_IX_DISCRIMINATOR], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_parlay_wrong_user_account_fails() {
   let mut env = Env::new();
   fill_parlay_won_path(&mut env, 520);
   let bet_id = 520u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_parlay_metas(bet, bat, bet_id);
   metas[4] = AccountMeta::new_readonly(wrong_signer(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[SETTLE_PARLAY_IX_DISCRIMINATOR], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_parlay_wrong_feepayer_fails() {
   let mut env = Env::new();
   fill_parlay_won_path(&mut env, 521);
   let bet_id = 521u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_parlay_metas(bet, bat, bet_id);
   metas[3] = AccountMeta::new(wrong_signer(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[SETTLE_PARLAY_IX_DISCRIMINATOR], metas);
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
   let mut buf = vec![GRADE_BETS_IX_DISCRIMINATOR];
   buf.extend_from_slice(results);
   Instruction::new_with_bytes(agg_program_id(), &buf, metas)
}

#[test]
fn settle_parlay_regular_bet_account_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet_id = 530u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id,
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
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn settle_parlay_second_call_fails() {
   let mut env = Env::new();
   fill_parlay_won_path(&mut env, 540);
   let bet_id = 540u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   assert!(env.run_ix(settle_parlay_instruction(bet, bat, bet_id)).program_result.is_ok());
   let r2 = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
   assert_program_err(&r2, ProgramError::InvalidAccountOwner);
}

#[test]
fn settle_parlay_cancelled_refunds_stake() {
   let mut env = Env::new();
   fill_parlay_and_grade(
      &mut env,
      550,
      &[BetResult::Cancelled as u8, BetResult::Push as u8],
   );
   let bet_id = 550u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   assert!(matches!(pd.result, BetResult::Cancelled));
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_l = read_token_balance(&env, &liability_token_ata());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
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
   assert_eq!(read_token_balance(&env, &mm_collateral_ata()), pre_mm);
   assert_eq!(read_token_balance(&env, &liability_token_ata()), pre_l);
   record_cu_success("settle_parlay/cancelled_refunds_stake", &r);
}

#[test]
fn settle_parlay_modified_win_mm_receives_unconsumed_profit() {
   let mut env = Env::new();
   // Push + Won → user gets 8M of 4M stake @ 2.0² potential; remaining profit to MM.
   fill_parlay_and_grade(
      &mut env,
      551,
      &[BetResult::Push as u8, BetResult::Won as u8],
   );
   let bet_id = 551u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let user_return = EXPECTED_PAYOUT_VOID_LEG_WON;
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_l = read_token_balance(&env, &liability_token_ata());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(user_return)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - profit as i64
   );
   assert_eq!(read_token_balance(&env, &mm_collateral_ata()), pre_mm);
   let profit_from_liability = user_return.saturating_sub(pd.amount.min(user_return));
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      pre_l.saturating_sub(profit_from_liability)
   );
   record_cu_success("settle_parlay/modified_win_liability_leftover", &r);
}

#[test]
fn settle_parlay_from_rfq_fill() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   let leg_odds = 20_000u32;
   let gs = EventGameState::zeroed();
   let l0 = parlay_leg(m1, 0, 1, gs).with_odds(leg_odds);
   let l1 = parlay_leg(m2, 1, 1, gs).with_odds(leg_odds);
   let table = parlay_legs_rfq(&[l0, l1]);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 552u64;
   let amount = 4_000_000u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table[..2],
      50_000_000,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillRfqParlayIxData {
      bet_id,
      amount,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   assert!(env
      .run_ix(fill_rfq_parlay_instruction(&data, &sig, bet, bat))
      .program_result
      .is_ok());
   let mask = grade_parlay_leg_mask(&[BetResult::Won as u8, BetResult::Won as u8]);
   assert!(env
      .run_ix(grade_parlay_instruction(&mask, bet, admin()))
      .program_result
      .is_ok());
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(pd.payout)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - profit as i64
   );
   record_cu_success("settle_parlay/from_rfq", &r);
}

#[test]
fn settle_parlay_max_rfq_legs() {
   let mut env = Env::new();
   let markets_bodies = rfq_max_leg_markets(MAX_RFQ_PARLAY_LEGS);
   let refs: Vec<_> = markets_bodies.iter().map(|(m, b)| (*m, b.as_slice())).collect();
   env.bootstrap_mm_with_markets(&refs);
   let markets: Vec<_> = markets_bodies.iter().map(|(m, _)| *m).collect();
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs_from_markets(&markets, leg_odds);
   let n = MAX_RFQ_PARLAY_LEGS as u8;
   let combined = uniform_parlay_combined_odds(leg_odds, MAX_RFQ_PARLAY_LEGS);
   let bet_id = 553u64;
   let amount = 4_000_000u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      n,
      &table[..MAX_RFQ_PARLAY_LEGS],
      50_000_000,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillRfqParlayIxData {
      bet_id,
      amount,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: n,
      legs: table,
   };
   assert!(env
      .run_ix(fill_rfq_parlay_instruction(&data, &sig, bet, bat))
      .program_result
      .is_ok());
   let grades = vec![BetResult::Won as u8; MAX_RFQ_PARLAY_LEGS];
   let mask = grade_parlay_leg_mask(&grades);
   assert!(env
      .run_ix(grade_parlay_instruction(&mask, bet, admin()))
      .program_result
      .is_ok());
   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - profit as i64
   );
   record_cu_success("settle_parlay/max_rfq_legs", &r);
}
