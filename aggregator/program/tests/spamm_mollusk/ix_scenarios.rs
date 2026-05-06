//! End-to-end sequences (CU ledger keys use the instruction being measured: `settle_bet/…`, `fill_bet/…`).

use solana_instruction::AccountMeta;

use spamm_aggregator::helpers::calc_potential_profit;
use spamm_aggregator::instructions::{FillBetIxData, FillParlayIxData};
use spamm_aggregator::state::account_bet::BetResult;

use crate::common::{
   admin, agg_program_id, assert_account_closed_or_system_empty, assert_bet_after_fill, assert_ok_record_cu,
   assert_parlay_after_fill, bet_pda_for, bet_token_ata, config_pda, decode_bet, decode_parlay_bet,
   encumbrance_pda, event_id_soccer, event_id_soccer_b, fill_bet_instruction, fill_bet_netting_placeholder,
   fill_parlay_instruction, market_soccer_ft_pregame, market_spread_pregame, netting_pda_for_event,
   oracle_body_three_outcome, oracle_body_two_outcome, parlay_bet_pda_for, parlay_leg, parlay_table,
   read_encumbrance, read_netting_soccer_header_and_lines, read_token_balance, settle_bet_instruction,
   settle_parlay_instruction, system_owned_empty, uniform_parlay_combined_odds, user, user_collateral_ata, Env,
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
      event_state_hash: [0u8; 32],
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
      event_state_hash: [0u8; 32],
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
   assert_eq!(lines[0].1, 4u32);
   let b = decode_bet(&env, &bet);
   assert!(b.filler_0.is_potentially_netted);
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc_pre + b.filler_0.encumbrance_delta);
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
   let l0 = parlay_leg(m1, 0, 1, [0u8; 32]);
   let l1 = parlay_leg(m2, 1, 1, [0u8; 32]);
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

   let gr = env.run_ix(grade_ix(&[BetResult::Won as u8], &[bet]));
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
