//! End-to-end sequences (CU ledger keys use the instruction being measured: `settle_bet/…`, `fill_bet/…`).

use solana_instruction::AccountMeta;

use spamm_aggregator::helpers::calc_potential_profit;
use spamm_aggregator::instructions::{FillBetIxData, FillParlayIxData};
use spamm_aggregator::state::{EventGameState, MarketId};
use spamm_aggregator::state::account_bet::BetResult;

use crate::common::{
   admin, agg_program_id, assert_account_closed_or_system_empty, assert_bet_after_fill, assert_ok_record_cu,
   assert_parlay_after_fill, bet_pda_for, bet_token_ata, config_pda, decode_bet, decode_parlay_bet,
   encumbrance_pda, event_id_basketball, event_id_soccer, event_id_soccer_b, fill_bet_instruction,
   fill_bet_netting_placeholder, fill_parlay_instruction, liability_token_ata, market_ml_pregame,
   market_soccer_ft_pregame, market_spread_pregame, netting_pda_for_event, oracle_body_three_outcome,
   oracle_body_two_outcome, parlay_bet_pda_for, parlay_leg, parlay_table, read_encumbrance,
   read_netting_soccer_header_and_lines, read_token_balance, settle_bet_instruction, settle_parlay_instruction,
   grade_parlay_instruction, grade_parlay_leg_mask,
   system_owned_empty, uniform_parlay_combined_odds, user, user_collateral_ata, Env, LIABILITY_9_USDC,
   ODDS_1_9_SCALED, STAKE_10_USDC,
};

fn grade_ix(results: &[u8], bets: &[solana_pubkey::Pubkey]) -> solana_instruction::Instruction {
   let mut metas = vec![
      AccountMeta::new(admin(), true),
      AccountMeta::new_readonly(config_pda(), false),
   ];
   for b in bets {
      metas.push(AccountMeta::new(*b, false));
   }
   let mut buf = vec![5u8];
   buf.extend_from_slice(results);
   solana_instruction::Instruction::new_with_bytes(agg_program_id(), &buf, metas)
}

#[test]
fn scenario_single_leg_fill_grade_settle_won() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 900);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 900,
      market_id: mid,
      side: 0,
      amount: 6_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let fill = env.run_ix(fill_bet_instruction(
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert!(fill.program_result.is_ok());
   assert_bet_after_fill(&env, &bet, 6_000_000, 0);
   let gr = env.run_ix(grade_ix(&[BetResult::Won as u8], &[bet]));
   assert!(gr.program_result.is_ok());

   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let st = env.run_ix(settle_bet_instruction(bet, bat));
   assert_ok_record_cu("settle_bet/e2e_single_leg_won", &st);
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
}

#[test]
fn scenario_netting_create_add_fill_m4() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let mid = spamm_aggregator::state::MarketId {
      event_id: eid,
      player: 0,
      mkt: 4,
      period: 1,
      is_pregame: true,
      operator: crate::common::fixtures::market_operator(),
   };
   let body = crate::common::oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.create_netting_for_soccer_event();
   use spamm_aggregator::instructions::{AddLineToLiabilityNettingIxData, ADD_LINE_TO_LIABILITY_NETTING_IX_LEN};
   let add = AddLineToLiabilityNettingIxData {
      event_id: eid,
      period: 1,
      mkt: 4,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix = env.agg_ix(
      51,
      w.to_vec(),
      vec![
         AccountMeta::new(crate::common::mm_admin(), true),
         AccountMeta::new_readonly(crate::common::mm_program_id(), false),
         AccountMeta::new_readonly(crate::common::mm_config_pda(), false),
         AccountMeta::new(crate::common::netting_pda_for_event(&eid), false),
      ],
   );
   assert!(env.run_ix(ix).program_result.is_ok());

   let bet = bet_pda_for(&user(), 901);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let enc_pre = read_encumbrance(&env, &encumbrance_pda());
   let data = FillBetIxData {
      bet_id: 901,
      market_id: mid,
      side: 0,
      amount: 2_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_bet_instruction(
      &data,
      bet,
      bat,
      &mid,
      netting_pda_for_event(&eid),
   ));
   assert_ok_record_cu("fill_bet/e2e_netting_m4", &r);
   assert_bet_after_fill(&env, &bet, 2_000_000, 0);
   let np = netting_pda_for_event(&eid);
   let (_, lines) = read_netting_soccer_header_and_lines(&env, &np);
   assert_eq!(lines.len(), 1);
   assert_eq!(lines[0].0, 1u8);
   assert_eq!(lines[0].1, 4u16);
   let b = decode_bet(&env, &bet);
   assert!(b.filler_0.is_potentially_netted);
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc_pre + b.filler_0.encumbrance_delta);
}

/// Two-outcome ML (`period` 0, `mkt` 0) at 1.9 / 1.9: opposing $10 stakes net to one $9 liability deposit.
#[test]
fn scenario_ml_p0_m0_opposing_stakes_net_liability_deposit() {
   let mut env = Env::new();
   let eid = event_id_basketball();
   let mid = market_ml_pregame(eid);
   let body = oracle_body_two_outcome(ODDS_1_9_SCALED, ODDS_1_9_SCALED);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.create_netting_for_event(&eid);
   let np = netting_pda_for_event(&eid);

   let liab0 = read_token_balance(&env, &liability_token_ata());
   assert_eq!(liab0, 0, "liability ATA starts empty after register_mm");

   let bet0 = bet_pda_for(&user(), 920);
   let bat0 = bet_token_ata(&bet0);
   env.upsert(bet0, system_owned_empty());
   env.upsert(bat0, system_owned_empty());
   let fill0 = FillBetIxData {
      bet_id: 920,
      market_id: mid,
      side: 0,
      amount: STAKE_10_USDC,
      min_odds_scaled: ODDS_1_9_SCALED,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r0 = env.run_ix(fill_bet_instruction(&fill0, bet0, bat0, &mid, np));
   assert_ok_record_cu("fill_bet/e2e_ml_p0_m0_net_side0", &r0);
   assert_bet_after_fill(&env, &bet0, STAKE_10_USDC, 0);
   let b0 = decode_bet(&env, &bet0);
   assert!(b0.filler_0.is_potentially_netted);
   assert_eq!(b0.filler_0.encumbrance_delta, LIABILITY_9_USDC as i64);
   assert_eq!(read_token_balance(&env, &liability_token_ata()), LIABILITY_9_USDC);
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), LIABILITY_9_USDC as i64);

   let bet1 = bet_pda_for(&user(), 921);
   let bat1 = bet_token_ata(&bet1);
   env.upsert(bet1, system_owned_empty());
   env.upsert(bat1, system_owned_empty());
   let fill1 = FillBetIxData {
      bet_id: 921,
      market_id: mid,
      side: 1,
      amount: STAKE_10_USDC,
      min_odds_scaled: ODDS_1_9_SCALED,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r1 = env.run_ix(fill_bet_instruction(&fill1, bet1, bat1, &mid, np));
   assert_ok_record_cu("fill_bet/e2e_ml_p0_m0_net_side1", &r1);
   assert_bet_after_fill(&env, &bet1, STAKE_10_USDC, 1);
   let b1 = decode_bet(&env, &bet1);
   assert!(b1.filler_0.is_potentially_netted);
   assert_eq!(b1.filler_0.encumbrance_delta, -(LIABILITY_9_USDC as i64));
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      LIABILITY_9_USDC,
      "second fill must not pull another $9 from MM collateral"
   );
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), 0, "opposing fills net encumbrance to zero");

   let profit = calc_potential_profit(STAKE_10_USDC, ODDS_1_9_SCALED).unwrap() as i64;
   let (ft, lines) = read_netting_soccer_header_and_lines(&env, &np);
   assert!(lines.is_empty(), "ML p0/m0 uses header slots, not line table");
   assert_eq!(ft[0], profit - STAKE_10_USDC as i64);
   assert_eq!(ft[1], profit - STAKE_10_USDC as i64);
   assert_eq!(ft[2], 0);
}

/// Soccer `mkt` 0 is not a netting market — even with a netting PDA, each fill posts full margin ($9).
#[test]
fn scenario_soccer_mkt0_no_netting_double_liability_deposit() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let mid = MarketId {
      event_id: eid,
      player: 0,
      mkt: 0,
      period: 0,
      is_pregame: true,
      operator: crate::common::fixtures::market_operator(),
   };
   let body = oracle_body_two_outcome(ODDS_1_9_SCALED, ODDS_1_9_SCALED);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.create_netting_for_event(&eid);
   let np = netting_pda_for_event(&eid);

   for (bet_id, side) in [(930u64, 0u8), (931, 1u8)] {
      let bet = bet_pda_for(&user(), bet_id);
      let bat = bet_token_ata(&bet);
      env.upsert(bet, system_owned_empty());
      env.upsert(bat, system_owned_empty());
      let data = FillBetIxData {
         bet_id,
         market_id: mid,
         side,
         amount: STAKE_10_USDC,
         min_odds_scaled: ODDS_1_9_SCALED,
         event_state_sequence: 1,
         event_game_state: EventGameState::zeroed(),
      };
      assert!(env.run_ix(fill_bet_instruction(&data, bet, bat, &mid, np)).program_result.is_ok());
      let b = decode_bet(&env, &bet);
      assert!(!b.filler_0.is_potentially_netted);
   }
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      LIABILITY_9_USDC * 2,
      "soccer mkt 0 does not participate in calculate_netting"
   );
}

#[test]
fn scenario_parlay_fill_grade_settle_won() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);

   let bet_id = 902u64;
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
   let enc_before = read_encumbrance(&env, &encumbrance_pda());
   let fill = env.run_ix(fill_parlay_instruction(&payload, bet, bat, &[m1, m2]));
   assert!(fill.program_result.is_ok(), "{:?}", fill);
   assert_parlay_after_fill(
      &env,
      &bet,
      &encumbrance_pda(),
      enc_before,
      4_000_000,
      2,
      uniform_parlay_combined_odds(20_000, 2),
   );

   let gr = env.run_ix(grade_parlay_instruction(
      &[&grade_parlay_leg_mask(&[BetResult::Won as u8, BetResult::Won as u8])],
      &[bet],
      admin(),
   ));
   assert!(gr.program_result.is_ok());

   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let st = env.run_ix(settle_parlay_instruction(bet, bat));
   assert_ok_record_cu("settle_parlay/e2e_won", &st);
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
}
