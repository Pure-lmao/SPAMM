//! `grade_bets` tests.

use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;

use spamm_aggregator::instructions::FillBetIxData;

use spamm_aggregator::state::account_bet::BetResult;

use crate::common::{
   admin, assert_ix_ok, assert_ok_record_cu, assert_program_err, bet_pda_for, bet_token_ata, config_pda,
   decode_bet, event_id_soccer, fill_bet_instruction, fill_bet_netting_placeholder, market_spread_pregame,
   system_owned_empty, user, user_collateral_ata, wrong_signer, Env,
};

fn grade_ix(results: &[u8], bets: &[solana_pubkey::Pubkey]) -> Instruction {
   let mut metas = vec![
      AccountMeta::new(admin(), true),
      AccountMeta::new_readonly(config_pda(), false),
   ];
   for b in bets {
      metas.push(AccountMeta::new(*b, false));
   }
   let mut buf = vec![5u8];
   buf.extend_from_slice(results);
   Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas)
}

fn place_simple_bet(env: &mut Env, bet_id: u64) {
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: 4_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_state_hash: [0u8; 32],
   };
   let ix = fill_bet_instruction(&data, bet, bat, &mid, fill_bet_netting_placeholder());
   assert_ix_ok(&env.run_ix(ix), "place_simple_bet");
}

#[test]
fn grade_bets_single_won() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 300);
   let bet = bet_pda_for(&user(), 300);
   let ix = grade_ix(&[1u8], &[bet]);
   let r = env.run_ix(ix);
   assert_ok_record_cu("grade_bets/single_won", &r);
   assert!(matches!(decode_bet(&env, &bet).result, BetResult::Won));
}

#[test]
fn grade_bets_single_lost() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 320);
   let bet = bet_pda_for(&user(), 320);
   let ix = grade_ix(&[2u8], &[bet]);
   let r = env.run_ix(ix);
   assert_ok_record_cu("grade_bets/single_lost", &r);
   assert!(matches!(decode_bet(&env, &bet).result, BetResult::Lost));
}

#[test]
fn grade_bets_single_half_won() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 321);
   let bet = bet_pda_for(&user(), 321);
   let ix = grade_ix(&[3u8], &[bet]);
   let r = env.run_ix(ix);
   assert_ok_record_cu("grade_bets/single_half_won", &r);
   assert!(matches!(decode_bet(&env, &bet).result, BetResult::HalfWon));
}

#[test]
fn grade_bets_single_push() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 322);
   let bet = bet_pda_for(&user(), 322);
   let ix = grade_ix(&[5u8], &[bet]);
   let r = env.run_ix(ix);
   assert_ok_record_cu("grade_bets/single_push", &r);
   assert!(matches!(decode_bet(&env, &bet).result, BetResult::Push));
}

#[test]
fn grade_bets_invalid_result_byte_zero() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 301);
   let bet = bet_pda_for(&user(), 301);
   let ix = grade_ix(&[0u8], &[bet]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn grade_bets_invalid_result_byte_gt_seven() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 306);
   let bet = bet_pda_for(&user(), 306);
   let ix = grade_ix(&[8u8], &[bet]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn grade_bets_len_mismatch() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 302);
   let bet = bet_pda_for(&user(), 302);
   let ix = grade_ix(&[1u8, 2u8], &[bet]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn grade_bets_fewer_results_than_bets() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 307);
   let bet = bet_pda_for(&user(), 307);
   let ix = Instruction::new_with_bytes(crate::common::agg_program_id(), &[5u8], vec![
      AccountMeta::new(admin(), true),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new(bet, false),
   ]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn grade_bets_non_admin() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 303);
   let bet = bet_pda_for(&user(), 303);
   let metas = vec![
      AccountMeta::new(wrong_signer(), true),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new(bet, false),
   ];
   let ix = Instruction::new_with_bytes(crate::common::agg_program_id(), &[5u8, 1u8], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

#[test]
fn grade_bets_batch_two() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 304);
   place_simple_bet(&mut env, 305);
   let b1 = bet_pda_for(&user(), 304);
   let b2 = bet_pda_for(&user(), 305);
   let ix = grade_ix(&[2u8, 3u8], &[b1, b2]);
   let r = env.run_ix(ix);
   assert_ok_record_cu("grade_bets/batch_2", &r);
   assert!(matches!(decode_bet(&env, &b1).result, BetResult::Lost));
   assert!(matches!(decode_bet(&env, &b2).result, BetResult::HalfWon));
}

#[test]
fn grade_bets_batch_eight() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   for id in 330..338u64 {
      place_simple_bet(&mut env, id);
   }
   let bets: Vec<_> = (330..338).map(|id| bet_pda_for(&user(), id)).collect();
   let results = [1u8, 2, 3, 5, 6, 7, 4, 2];
   let ix = grade_ix(&results, &bets);
   let r = env.run_ix(ix);
   assert_ok_record_cu("grade_bets/batch_8", &r);
   for (pk, exp_byte) in bets.iter().zip(results.iter()) {
      assert_eq!(decode_bet(&env, pk).result as u8, *exp_byte);
   }
}

#[test]
fn grade_bets_target_wrong_account_length_config_pda() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 323);
   let ix = grade_ix(&[1u8], &[config_pda()]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn grade_bets_target_wrong_account_length_user_ata() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   place_simple_bet(&mut env, 324);
   let ix = grade_ix(&[1u8], &[user_collateral_ata()]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}
