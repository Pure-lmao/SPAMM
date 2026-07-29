//! `grade_parlay` tests.

use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;

use spamm_aggregator::instructions::FillParlayIxData;
use spamm_aggregator::state::EventGameState;
use spamm_aggregator::state::account_bet::{BetResult, GRADE_PARLAY_LEG_SKIP};

use crate::common::{
   admin, assert_ok_record_cu, assert_program_err, bet_token_ata, config_pda, decode_parlay_bet, event_id_soccer,
   event_id_soccer_b, fill_parlay_instruction, grade_parlay_instruction, grade_parlay_leg_mask,
   market_soccer_ft_pregame, market_spread_pregame, oracle_body_three_outcome, oracle_body_two_outcome,
   parlay_bet_pda_for, parlay_leg, parlay_table, system_owned_empty, user, wrong_signer, Env,
};

fn two_leg_parlay(env: &mut Env, bet_id: u64) -> (solana_pubkey::Pubkey, spamm_aggregator::state::MarketId, spamm_aggregator::state::MarketId) {
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
      amount: 4_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &[m1, m2]);
   assert!(env.run_ix(ix).program_result.is_ok());
   (bet, m1, m2)
}

#[test]
fn grade_parlay_two_legs_won() {
   let mut env = Env::new();
   let (bet, _, _) = two_leg_parlay(&mut env, 600);
   let mask = grade_parlay_leg_mask(&[BetResult::Won as u8, BetResult::Won as u8]);
   let r = env.run_ix(grade_parlay_instruction(&[&mask], &[bet], admin()));
   assert_ok_record_cu("grade_parlay/two_legs_won", &r);
   let p = decode_parlay_bet(&env, &bet);
   assert!(matches!(p.result, BetResult::Won));
   assert!(matches!(p.legs.leg_0.result, BetResult::Won));
   assert!(matches!(p.legs.leg_1.result, BetResult::Won));
}

#[test]
fn grade_parlay_one_leg_lost_ticket_lost() {
   let mut env = Env::new();
   let (bet, _, _) = two_leg_parlay(&mut env, 601);
   let mask = grade_parlay_leg_mask(&[BetResult::Lost as u8, GRADE_PARLAY_LEG_SKIP]);
   let r = env.run_ix(grade_parlay_instruction(&[&mask], &[bet], admin()));
   assert_ok_record_cu("grade_parlay/one_leg_lost", &r);
   assert!(matches!(decode_parlay_bet(&env, &bet).result, BetResult::Lost));
}

#[test]
fn grade_parlay_void_leg_modified_win() {
   let mut env = Env::new();
   let (bet, _, _) = two_leg_parlay(&mut env, 602);
   let mask = grade_parlay_leg_mask(&[BetResult::Push as u8, BetResult::Won as u8]);
   let r = env.run_ix(grade_parlay_instruction(&[&mask], &[bet], admin()));
   assert_ok_record_cu("grade_parlay/void_modified_win", &r);
   assert!(matches!(decode_parlay_bet(&env, &bet).result, BetResult::ModifiedWin));
}

#[test]
fn grade_parlay_incremental_pending_then_won() {
   let mut env = Env::new();
   let (bet, _, _) = two_leg_parlay(&mut env, 603);
   let m1 = grade_parlay_leg_mask(&[BetResult::Won as u8, GRADE_PARLAY_LEG_SKIP]);
   let r1 = env.run_ix(grade_parlay_instruction(&[&m1], &[bet], admin()));
   assert_ok_record_cu("grade_parlay/incremental_leg0", &r1);
   assert!(matches!(decode_parlay_bet(&env, &bet).result, BetResult::Pending));
   let m2 = grade_parlay_leg_mask(&[GRADE_PARLAY_LEG_SKIP, BetResult::Won as u8]);
   let r2 = env.run_ix(grade_parlay_instruction(&[&m2], &[bet], admin()));
   assert_ok_record_cu("grade_parlay/incremental_leg1", &r2);
   assert!(matches!(decode_parlay_bet(&env, &bet).result, BetResult::Won));
}

#[test]
fn grade_parlay_operator_auth() {
   let mut env = Env::new();
   let (bet, _, _) = two_leg_parlay(&mut env, 604);
   let mask = grade_parlay_leg_mask(&[BetResult::Won as u8, BetResult::Won as u8]);
   // `market_operator()` uses `admin()` bytes — operator may grade.
   let r = env.run_ix(grade_parlay_instruction(&[&mask], &[bet], admin()));
   assert_ok_record_cu("grade_parlay/operator_auth", &r);
}

#[test]
fn grade_parlay_wrong_signer() {
   let mut env = Env::new();
   let (bet, _, _) = two_leg_parlay(&mut env, 605);
   let mask = grade_parlay_leg_mask(&[BetResult::Won as u8, BetResult::Won as u8]);
   let r = env.run_ix(grade_parlay_instruction(&[&mask], &[bet], wrong_signer()));
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

#[test]
fn grade_parlay_rejects_grade_bets_on_parlay_account() {
   let mut env = Env::new();
   let (bet, _, _) = two_leg_parlay(&mut env, 606);
   let ix = Instruction::new_with_bytes(
      crate::common::agg_program_id(),
      &[5u8, BetResult::Won as u8],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new(bet, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn grade_parlay_invalid_byte_past_num_legs() {
   let mut env = Env::new();
   let (bet, _, _) = two_leg_parlay(&mut env, 607);
   let mask = grade_parlay_leg_mask(&[BetResult::Won as u8, BetResult::Won as u8, BetResult::Won as u8]);
   let r = env.run_ix(grade_parlay_instruction(&[&mask], &[bet], admin()));
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}
