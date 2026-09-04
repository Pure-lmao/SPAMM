//! `settle_bet` tests.

use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::helpers::calc_potential_profit;
use spamm_aggregator::instructions::{
   AddLineToLiabilityNettingIxData, FillBetIxData, FillParlayIxData, ADD_LINE_TO_LIABILITY_NETTING_IX_LEN,
   GRADE_BETS_IX_DISCRIMINATOR, SETTLE_BET_IX_DISCRIMINATOR,
};
use spamm_aggregator::state::{EventGameState, MarketId};
use spamm_aggregator::state::account_bet::BetResult;

use crate::common::{
   admin, agg_program_id, assert_account_closed_or_system_empty, assert_program_err, assert_spamm_err,
   bet_pda_for, bet_token_ata, config_pda, decode_bet, encumbrance_pda, event_id_soccer, event_id_soccer_b,
   fill_bet_instruction, fill_bet_netting_placeholder, fill_parlay_instruction, liability_token_ata,
   add_line_account_metas, market_soccer_ft_pregame,
   market_spread_pregame, mm_admin, mm_config_pda, mm_program_id, netting_pda_for_event,
   oracle_body_three_outcome, oracle_body_two_outcome, parlay_bet_pda_for, parlay_leg, parlay_legs_fill,
   read_encumbrance, read_netting_soccer_header_and_lines, read_token_balance, record_cu_success, settle_bet_instruction,
   settle_bet_instruction_with_netting, settle_bet_metas,
   system_owned_empty, user, user_collateral_ata, wrong_signer, Env,
};

fn filler_profit_i64(bd: &crate::common::DecodedBet) -> i64 {
   calc_potential_profit(bd.fillers[0].amount, bd.fillers[0].odds_scaled).unwrap() as i64
}

fn grade_ix(results: &[u8], bets: &[solana_pubkey::Pubkey]) -> Instruction {
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
      event_game_state: EventGameState::zeroed(),
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
      operator: crate::common::fixtures::market_operator(),
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
      41,
      w.to_vec(),
      add_line_account_metas(netting_pda_for_event(&eid)),
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
      event_game_state: EventGameState::zeroed(),
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
   let bet_id = 400u64;
   fill_and_grade(&mut env, bet_id, BetResult::Won as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let ix = settle_bet_instruction(bet, bat, bet_id);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   let profit = calc_potential_profit(bd.fillers[0].amount, bd.fillers[0].odds_scaled).unwrap();
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount).saturating_add(profit)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - filler_profit_i64(&bd)
   );
   record_cu_success("settle_bet/won", &r);
}

#[test]
fn settle_bet_lost_success() {
   let mut env = Env::new();
   let bet_id = 404u64;
   fill_and_grade(&mut env, bet_id, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let pre_l = read_token_balance(&env, &liability_token_ata());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_ok());
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(read_token_balance(&env, &user_collateral_ata()), pre_u);
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      pre_l.saturating_add(bd.amount),
      "lost stake always goes to the liability ATA"
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - filler_profit_i64(&bd)
   );
   record_cu_success("settle_bet/lost", &r);
}

#[test]
fn settle_bet_half_won_success() {
   let mut env = Env::new();
   let bet_id = 410u64;
   fill_and_grade(&mut env, bet_id, BetResult::HalfWon as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   let half = bd.amount / 2;
   let profit_half = calc_potential_profit(half, bd.fillers[0].odds_scaled).unwrap();
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount).saturating_add(profit_half)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - filler_profit_i64(&bd)
   );
   record_cu_success("settle_bet/half_won", &r);
}

#[test]
fn settle_bet_half_lost_success() {
   let mut env = Env::new();
   let bet_id = 411u64;
   fill_and_grade(&mut env, bet_id, BetResult::HalfLost as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount / 2)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - filler_profit_i64(&bd)
   );
   record_cu_success("settle_bet/half_lost", &r);
}

#[test]
fn settle_bet_push_success() {
   let mut env = Env::new();
   let bet_id = 412u64;
   fill_and_grade(&mut env, bet_id, BetResult::Push as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - filler_profit_i64(&bd)
   );
   record_cu_success("settle_bet/push", &r);
}

#[test]
fn settle_bet_cancelled_success() {
   let mut env = Env::new();
   let bet_id = 413u64;
   fill_and_grade(&mut env, bet_id, BetResult::Cancelled as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - filler_profit_i64(&bd)
   );
   record_cu_success("settle_bet/cancelled", &r);
}

#[test]
fn settle_bet_rolled_back_success() {
   let mut env = Env::new();
   let bet_id = 414u64;
   fill_and_grade(&mut env, bet_id, BetResult::RolledBack as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - filler_profit_i64(&bd)
   );
   record_cu_success("settle_bet/rolled_back", &r);
}

#[test]
fn settle_bet_live_rolled_back_unwinds_netting() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let mut mid_live = market_spread_pregame(eid);
   mid_live.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid_live, body.as_slice())]);
   env.create_netting_for_soccer_event();
   env.patch_event_state_sequence(&eid, 2);
   let np = netting_pda_for_event(&eid);
   let bet_id = 415u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id,
      market_id: mid_live,
      side: 0,
      amount: 3_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(
      env.run_ix(fill_bet_instruction(&data, bet, bat, &mid_live, np))
         .program_result
         .is_ok()
   );
   assert!(env.run_ix(grade_ix(&[BetResult::RolledBack as u8], &[bet])).program_result.is_ok());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   assert!(bd.fillers[0].is_potentially_netted);
   let r = env.run_ix(settle_bet_instruction_with_netting(bet, bat, bet_id, np));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - filler_profit_i64(&bd)
   );
   let (_ft, lines) = read_netting_soccer_header_and_lines(&env, &np);
   assert_eq!(lines, vec![(1u8, 400u16, 0, 0)]);
   record_cu_success("settle_bet/live_rolled_back_netting", &r);
}

#[test]
fn settle_bet_lost_netting_m4_success() {
   let mut env = Env::new();
   fill_netting_m4_bet_and_grade(&mut env, 420, BetResult::Lost as u8);
   let bet_id = 420u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let pre_l = read_token_balance(&env, &liability_token_ata());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction_with_netting(
      bet,
      bat,
      bet_id,
      netting_pda_for_event(&event_id_soccer()),
   ));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(read_token_balance(&env, &user_collateral_ata()), pre_u);
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      pre_l.saturating_add(bd.amount)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - filler_profit_i64(&bd)
   );
   record_cu_success("settle_bet/lost_netting_m4", &r);
}

#[test]
fn settle_bet_half_lost_netting_m4_success() {
   let mut env = Env::new();
   fill_netting_m4_bet_and_grade(&mut env, 421, BetResult::HalfLost as u8);
   let bet_id = 421u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_bet_instruction_with_netting(
      bet,
      bat,
      bet_id,
      netting_pda_for_event(&event_id_soccer()),
   ));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u.saturating_add(bd.amount / 2)
   );
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - filler_profit_i64(&bd)
   );
   record_cu_success("settle_bet/half_lost_netting_m4", &r);
}

#[test]
fn settle_bet_pending_fails() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet_id = 401u64;
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
   let r = env.run_ix(settle_bet_instruction(bet, bat, bet_id));
   assert_spamm_err(&r, SpammError::BetNotGraded);
}

#[test]
fn settle_bet_wrong_feepayer() {
   let mut env = Env::new();
   let bet_id = 402u64;
   fill_and_grade(&mut env, bet_id, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_bet_metas(bet, bat, bet_id);
   metas[3] = AccountMeta::new(wrong_signer(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[SETTLE_BET_IX_DISCRIMINATOR], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn settle_bet_wrong_user_account_fails() {
   let mut env = Env::new();
   let bet_id = 430u64;
   fill_and_grade(&mut env, bet_id, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_bet_metas(bet, bat, bet_id);
   metas[4] = AccountMeta::new_readonly(wrong_signer(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[SETTLE_BET_IX_DISCRIMINATOR], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn settle_bet_filler_mm_address_mismatch_fails() {
   let mut env = Env::new();
   let bet_id = 431u64;
   fill_and_grade(&mut env, bet_id, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let mut metas = settle_bet_metas(bet, bat, bet_id);
   metas[11] = AccountMeta::new_readonly(wrong_signer(), false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[SETTLE_BET_IX_DISCRIMINATOR], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn settle_bet_dummy_mm_config_fails() {
   let mut env = Env::new();
   let bet_id = 433u64;
   fill_and_grade(&mut env, bet_id, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let dummy_config = Pubkey::new_from_array([0xAB; 32]);
   let attacker_ata = Pubkey::new_from_array([0xAC; 32]);
   env.upsert(dummy_config, system_owned_empty());
   env.upsert(attacker_ata, system_owned_empty());
   let mut metas = settle_bet_metas(bet, bat, bet_id);
   metas[12] = AccountMeta::new_readonly(dummy_config, false);
   metas[15] = AccountMeta::new(attacker_ata, false);
   let ix = Instruction::new_with_bytes(agg_program_id(), &[SETTLE_BET_IX_DISCRIMINATOR], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn settle_bet_parlay_account_rejected() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   let bet_id = 432u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id,
      amount: 3_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   assert!(env
      .run_ix(fill_parlay_instruction(&payload, bet, bat, &[m1, m2]))
      .program_result
      .is_ok());
   let g = grade_ix(&[BetResult::Won as u8], &[bet]);
   assert_program_err(&env.run_ix(g), ProgramError::InvalidInstructionData);
   let r = env.run_ix(settle_bet_instruction(bet, bat, bet_id));
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn settle_bet_second_call_fails() {
   let mut env = Env::new();
   let bet_id = 403u64;
   fill_and_grade(&mut env, bet_id, BetResult::Lost as u8);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   assert!(env.run_ix(settle_bet_instruction(bet, bat, bet_id)).program_result.is_ok());
   let r2 = env.run_ix(settle_bet_instruction(bet, bat, bet_id));
   assert_program_err(&r2, ProgramError::InvalidAccountOwner);
}

#[test]
fn settle_bet_netted_rejects_system_placeholder() {
   let mut env = Env::new();
   fill_netting_m4_bet_and_grade(&mut env, 891, BetResult::Lost as u8);
   let bet_id = 891u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   assert!(decode_bet(&env, &bet).fillers[0].is_potentially_netted);
   let r = env.run_ix(settle_bet_instruction(bet, bat, bet_id));
   assert!(r.program_result.is_err(), "netted filler needs real netting PDA");
}
