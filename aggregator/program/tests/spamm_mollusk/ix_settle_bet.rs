//! `settle_bet` tests.

use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;

use spamm_aggregator::helpers::calc_potential_profit;
use spamm_aggregator::instructions::{
   AddLineToLiabilityNettingIxData, FillBetIxData, FillParlayIxData, ADD_LINE_TO_LIABILITY_NETTING_IX_LEN,
};
use spamm_aggregator::state::MarketId;
use spamm_aggregator::state::account_bet::BetResult;

use crate::common::{
   admin, agg_program_id, assert_account_closed_or_system_empty, assert_program_err, bet_pda_for, bet_token_ata,
   config_pda, decode_bet, encumbrance_pda, event_id_soccer, event_id_soccer_b, fill_bet_instruction,
   fill_bet_netting_placeholder, fill_parlay_instruction, market_soccer_ft_pregame, market_spread_pregame, mm_admin,
   mm_config_pda, mm_program_id, netting_pda_for_event, oracle_body_three_outcome, oracle_body_two_outcome,
   parlay_bet_pda_for, parlay_leg, parlay_table, read_encumbrance, read_token_balance, record_cu_success,
   settle_bet_instruction, settle_bet_metas, system_owned_empty, user, user_collateral_ata, wrong_signer, Env,
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
   Instruction::new_with_bytes(agg_program_id(), &buf, metas)
}

fn fill_and_grade(env: &mut Env, bet_id: u64, result: u8) {
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
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
      event_state_hash: [0u8; 32],
   };
   assert!(env
      .run_ix(fill_bet_instruction(&data, bet, bat, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());
   let g = grade_ix(&[result], &[bet]);
   assert!(env.run_ix(g).program_result.is_ok());
}

/// Pregame spread `mkt: 4` with netting line + fill (netted encumbrance path).
fn fill_netting_m4_bet_and_grade(env: &mut Env, bet_id: u64, result: u8) {
   let eid = event_id_soccer();
   let mid = MarketId {
      event_id: eid,
      player: 0,
      mkt: 4,
      period: 1,
      is_pregame: true,
   };
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.create_netting_for_soccer_event();
   let add = AddLineToLiabilityNettingIxData {
      event_id: eid,
      period: 1,
      mkt: 4,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let add_ix = env.agg_ix(
      51,
      w.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(netting_pda_for_event(&eid), false),
      ],
   );
   assert!(env.run_ix(add_ix).program_result.is_ok());

   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: 8_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_state_hash: [0u8; 32],
   };
   assert!(env
      .run_ix(fill_bet_instruction(
         &data,
         bet,
         bat,
         &mid,
         netting_pda_for_event(&eid),
      ))
      .program_result
      .is_ok());
   let g = grade_ix(&[result], &[bet]);
   assert!(env.run_ix(g).program_result.is_ok());
}

#[test]
fn settle_bet_won_success() {
   let mut env = Env::new();
   fill_and_grade(&mut env, 400, BetResult::Won as u8);
   let bet = bet_pda_for(&user(), 400);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let ix = settle_bet_instruction(bet, bat);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   let profit = calc_potential_profit(bd.filler_0.amount, bd.filler_0.odds_scaled).unwrap();
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount).saturating_add(profit)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - bd.filler_0.encumbrance_delta
   );
   record_cu_success("settle_bet/won", &r);
}

#[test]
fn settle_bet_lost_success() {
   let mut env = Env::new();
   fill_and_grade(&mut env, 404, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), 404);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat));
   assert!(r.program_result.is_ok());
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(read_token_balance(&env, &user_collateral_ata()), pre_u);
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - bd.filler_0.encumbrance_delta
   );
   record_cu_success("settle_bet/lost", &r);
}

#[test]
fn settle_bet_half_won_success() {
   let mut env = Env::new();
   fill_and_grade(&mut env, 410, BetResult::HalfWon as u8);
   let bet = bet_pda_for(&user(), 410);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   let half = bd.amount / 2;
   let profit_half = calc_potential_profit(half, bd.filler_0.odds_scaled).unwrap();
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount).saturating_add(profit_half)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - bd.filler_0.encumbrance_delta
   );
   record_cu_success("settle_bet/half_won", &r);
}

#[test]
fn settle_bet_half_lost_success() {
   let mut env = Env::new();
   fill_and_grade(&mut env, 411, BetResult::HalfLost as u8);
   let bet = bet_pda_for(&user(), 411);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount / 2)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - bd.filler_0.encumbrance_delta
   );
   record_cu_success("settle_bet/half_lost", &r);
}

#[test]
fn settle_bet_push_success() {
   let mut env = Env::new();
   fill_and_grade(&mut env, 412, BetResult::Push as u8);
   let bet = bet_pda_for(&user(), 412);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - bd.filler_0.encumbrance_delta
   );
   record_cu_success("settle_bet/push", &r);
}

#[test]
fn settle_bet_cancelled_success() {
   let mut env = Env::new();
   fill_and_grade(&mut env, 413, BetResult::Cancelled as u8);
   let bet = bet_pda_for(&user(), 413);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - bd.filler_0.encumbrance_delta
   );
   record_cu_success("settle_bet/cancelled", &r);
}

#[test]
fn settle_bet_rolled_back_success() {
   let mut env = Env::new();
   fill_and_grade(&mut env, 414, BetResult::RolledBack as u8);
   let bet = bet_pda_for(&user(), 414);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - bd.filler_0.encumbrance_delta
   );
   record_cu_success("settle_bet/rolled_back", &r);
}

#[test]
fn settle_bet_lost_netting_m4_success() {
   let mut env = Env::new();
   fill_netting_m4_bet_and_grade(&mut env, 420, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), 420);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(read_token_balance(&env, &user_collateral_ata()), pre_u);
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - bd.filler_0.encumbrance_delta
   );
   record_cu_success("settle_bet/lost_netting_m4", &r);
}

#[test]
fn settle_bet_half_lost_netting_m4_success() {
   let mut env = Env::new();
   fill_netting_m4_bet_and_grade(&mut env, 421, BetResult::HalfLost as u8);
   let bet = bet_pda_for(&user(), 421);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount / 2)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - bd.filler_0.encumbrance_delta
   );
   record_cu_success("settle_bet/half_lost_netting_m4", &r);
}

#[test]
fn settle_bet_pending_fails() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 401);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 401,
      market_id: mid,
      side: 0,
      amount: 3_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_state_hash: [0u8; 32],
   };
   assert!(env
      .run_ix(fill_bet_instruction(&data, bet, bat, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());
   let r = env.run_ix(settle_bet_instruction(bet, bat));
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_bet_wrong_feepayer() {
   let mut env = Env::new();
   fill_and_grade(&mut env, 402, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), 402);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_bet_metas(bet, bat);
   metas[3] = AccountMeta::new(wrong_signer(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[6u8], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_bet_wrong_user_account_fails() {
   let mut env = Env::new();
   fill_and_grade(&mut env, 430, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), 430);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_bet_metas(bet, bat);
   metas[4] = AccountMeta::new_readonly(wrong_signer(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[6u8], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_bet_filler_mm_address_mismatch_fails() {
   let mut env = Env::new();
   fill_and_grade(&mut env, 431, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), 431);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_bet_metas(bet, bat);
   metas[9] = AccountMeta::new_readonly(wrong_signer(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[6u8], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_bet_parlay_account_rejected() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   let bet = parlay_bet_pda_for(&user(), 432);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, [0u8; 32]);
   let l1 = parlay_leg(m2, 1, 1, [0u8; 32]);
   let payload = FillParlayIxData {
      bet_id: 432,
      amount: 3_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_table(&[l0, l1]),
   };
   assert!(env
      .run_ix(fill_parlay_instruction(&payload, bet, bat, &[m1, m2]))
      .program_result
      .is_ok());
   let g = grade_ix(&[BetResult::Won as u8], &[bet]);
   assert!(env.run_ix(g).program_result.is_ok());
   let r = env.run_ix(settle_bet_instruction(bet, bat));
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn settle_bet_second_call_fails() {
   let mut env = Env::new();
   fill_and_grade(&mut env, 403, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), 403);
   let bat = bet_token_ata(&bet);
   assert!(env.run_ix(settle_bet_instruction(bet, bat)).program_result.is_ok());
   let r2 = env.run_ix(settle_bet_instruction(bet, bat));
   assert_program_err(&r2, ProgramError::InvalidInstructionData);
}
