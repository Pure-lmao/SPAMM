//! Account-budget and multi-MM fills (64-account tx cap).

use spamm_aggregator::constants::{MAX_PARLAY_LEGS, MAX_RFQ_PARLAY_LEGS, MIN_BET_AMOUNT};
use spamm_aggregator::helpers::calc_potential_profit;
use spamm_aggregator::instructions::{
   FillBetIxData, FillCashoutIxData, FillParlayIxData, FillRfqParlayIxData, GRADE_BETS_IX_DISCRIMINATOR,
};
use spamm_aggregator::state::account_bet::BetResult;
use spamm_aggregator::state::{EventGameState, MarketId};

use crate::common::{
   admin, agg_program_id, assert_parlay_after_fill, bet_pda_for, bet_token_ata, config_pda, decode_bet,
   encumbrance_pda, event_id_soccer, event_id_soccer_n, fill_bet_instruction, fill_bet_instruction_mms,
   fill_bet_netting_placeholder, fill_parlay_instruction, fill_rfq_parlay_instruction,
   get_cashout_quote_proxy_instruction_for, get_parlay_quote_proxy_instruction_for,
   get_quote_proxy_instruction_for, market_spread_pregame, oracle_body_two_outcome, parlay_bet_pda_for,
   parlay_leg, parlay_legs_fill, read_encumbrance, record_cu_success, rfq_max_leg_markets_odds,
   rfq_parlay_legs_from_markets, sign_rfq_parlay_quote, system_owned_empty, uniform_parlay_combined_odds,
   user, user_collateral_ata, MmKeys, MAX_TX_ACCOUNTS, RFQ_OFFER_EXPIRY, Env,
};

const CU_CEILING: u64 = 1_400_000;

fn grade_ix(results: &[u8], bets: &[solana_pubkey::Pubkey]) -> solana_instruction::Instruction {
   let mut metas = vec![
      solana_instruction::AccountMeta::new(admin(), true),
      solana_instruction::AccountMeta::new_readonly(config_pda(), false),
   ];
   for b in bets {
      metas.push(solana_instruction::AccountMeta::new(*b, false));
   }
   let mut buf = vec![GRADE_BETS_IX_DISCRIMINATOR];
   buf.extend_from_slice(results);
   solana_instruction::Instruction::new_with_bytes(agg_program_id(), &buf, metas)
}

#[test]
fn fill_bet_two_mm_unequal_odds_grade_settle() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let extra = MmKeys::extra(1);
   let body = oracle_body_two_outcome(22_000, 18_000);
   env.bootstrap_extra_mm(&extra, &[(mid, body.as_slice())]);
   let def = MmKeys::default_mm();
   let stake = 150_000_000u64;
   let bet_id = 7101u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: stake,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let ix = fill_bet_instruction_mms(
      &data,
      bet,
      bat,
      &[
         (&def, fill_bet_netting_placeholder()),
         (&extra, fill_bet_netting_placeholder()),
      ],
      &mid,
   );
   assert!(ix.accounts.len() <= MAX_TX_ACCOUNTS, "{}", ix.accounts.len());
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert!(r.compute_units_consumed < CU_CEILING);
   record_cu_success("fill_bet/2_mm", &r);
   let bd = decode_bet(&env, &bet);
   assert_eq!(bd.header.num_fillers, 2);
   assert_eq!(bd.header.amount, stake);
   assert_eq!(
      bd.fillers[0].amount + bd.fillers[1].amount,
      stake
   );
   assert_ne!(bd.fillers[0].odds_scaled, bd.fillers[1].odds_scaled);
   assert!(env.run_ix(grade_ix(&[BetResult::Won as u8], &[bet])).program_result.is_ok());
   let st = env.run_ix(crate::common::settle_bet_instruction_mms(
      user(),
      user_collateral_ata(),
      bet,
      bat,
      bet_id,
      &[
         (&extra, fill_bet_netting_placeholder()),
         (&def, fill_bet_netting_placeholder()),
      ],
   ));
   assert!(st.program_result.is_ok(), "{:?}", st);
}

#[test]
fn fill_bet_min_amount_succeeds() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 7102);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 7102,
      market_id: mid,
      side: 0,
      amount: MIN_BET_AMOUNT,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_bet_instruction(
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_eq!(decode_bet(&env, &bet).header.amount, MIN_BET_AMOUNT);
   let _ = calc_potential_profit(MIN_BET_AMOUNT, 20_000);
}

#[test]
fn fill_parlay_max_legs_safe_odds() {
   let mut env = Env::new();
   let mut packed: Vec<(MarketId, [u8; 8])> = Vec::new();
   for i in 0..MAX_PARLAY_LEGS {
      let eid = event_id_soccer_n(2_000 + i as u64);
      packed.push((market_spread_pregame(eid), oracle_body_two_outcome(11_000, 11_000)));
   }
   let refs: Vec<(MarketId, &[u8])> = packed.iter().map(|(m, b)| (*m, b.as_slice())).collect();
   env.bootstrap_mm_with_markets(&refs);
   let markets: Vec<MarketId> = packed.iter().map(|(m, _)| *m).collect();
   let bet = parlay_bet_pda_for(&user(), 7103);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let legs: Vec<_> = markets
      .iter()
      .enumerate()
      .map(|(i, mid)| parlay_leg(*mid, (i % 2) as u8, 1, EventGameState::zeroed()))
      .collect();
   let payload = FillParlayIxData {
      bet_id: 7103,
      amount: 2_000_000,
      min_odds_scaled: 10_001,
      num_legs: MAX_PARLAY_LEGS as u8,
      legs: parlay_legs_fill(&legs),
   };
   let ix = fill_parlay_instruction(&payload, bet, bat, &markets);
   assert!(ix.accounts.len() <= MAX_TX_ACCOUNTS, "{}", ix.accounts.len());
   let enc = read_encumbrance(&env, &encumbrance_pda());
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert!(r.compute_units_consumed < CU_CEILING);
   record_cu_success("fill_parlay/20_leg", &r);
   assert_parlay_after_fill(
      &env,
      &bet,
      &encumbrance_pda(),
      enc,
      2_000_000,
      MAX_PARLAY_LEGS as u8,
      uniform_parlay_combined_odds(11_000, MAX_PARLAY_LEGS),
   );
}

#[test]
fn fill_rfq_parlay_forty_legs_safe_odds() {
   let mut env = Env::new();
   let markets_bodies = rfq_max_leg_markets_odds(MAX_RFQ_PARLAY_LEGS, 11_000);
   let refs: Vec<_> = markets_bodies.iter().map(|(m, b)| (*m, b.as_slice())).collect();
   env.bootstrap_mm_with_markets(&refs);
   let markets: Vec<_> = markets_bodies.iter().map(|(m, _)| *m).collect();
   let table = rfq_parlay_legs_from_markets(&markets, 11_000);
   let combined = uniform_parlay_combined_odds(11_000, MAX_RFQ_PARLAY_LEGS);
   let bet_id = 7104u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      MAX_RFQ_PARLAY_LEGS as u8,
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
      amount: 10_000_000,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: MAX_RFQ_PARLAY_LEGS as u8,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
   assert!(ix.accounts.len() <= MAX_TX_ACCOUNTS, "{}", ix.accounts.len());
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert!(r.compute_units_consumed < CU_CEILING);
   record_cu_success("fill_rfq_parlay/40_leg", &r);
}

#[test]
fn get_quote_proxy_twelve_mm_fits_sixty_four() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let body = oracle_body_two_outcome(20_000, 20_000);
   let mut mms = vec![MmKeys::default_mm()];
   for slot in 1..=11u8 {
      let k = MmKeys::extra(slot);
      env.bootstrap_extra_mm(&k, &[(mid, body.as_slice())]);
      mms.push(k);
   }
   let data = FillBetIxData {
      bet_id: 0,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let ix = get_quote_proxy_instruction_for(&data, &mid, &mms);
   assert_eq!(ix.accounts.len(), 2 + 5 * 12);
   assert!(ix.accounts.len() <= MAX_TX_ACCOUNTS);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_eq!(crate::common::decode_proxy_quote_return(&r.return_data).len(), 12);
}

#[test]
fn get_quote_proxy_thirteen_mm_cannot_submit() {
   let n = 13usize;
   assert!(2 + 5 * n > MAX_TX_ACCOUNTS);
}

#[test]
fn get_cashout_quote_proxy_twelve_mm_account_count() {
   let n = 12usize;
   assert!(3 + 5 * n <= MAX_TX_ACCOUNTS);
   assert!(3 + 5 * 13 > MAX_TX_ACCOUNTS);
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let body = oracle_body_two_outcome(20_000, 20_000);
   let mut mms = vec![MmKeys::default_mm()];
   for slot in 1..=11u8 {
      let k = MmKeys::extra(slot);
      env.bootstrap_extra_mm(&k, &[(mid, body.as_slice())]);
      mms.push(k);
   }
   let bet_id = 7105u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let fill = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(&fill, bet, bat, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id: 0,
      amount: 10_000_000,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let ix = get_cashout_quote_proxy_instruction_for(&data, bet, &mid, &mms);
   assert!(ix.accounts.len() <= MAX_TX_ACCOUNTS);
   assert!(env.run_ix(ix).program_result.is_ok());
}

#[test]
fn get_parlay_quote_proxy_two_leg_eight_mm_fits() {
   let l = 2usize;
   let n = 8usize;
   assert!(2 + (3 + 2 * l) * n <= MAX_TX_ACCOUNTS);
   assert!(2 + (3 + 2 * l) * 9 > MAX_TX_ACCOUNTS);
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_spread_pregame(event_id_soccer_n(9));
   let b1 = oracle_body_two_outcome(11_000, 11_000);
   let b2 = oracle_body_two_outcome(11_000, 11_000);
   env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   let mut mms = vec![MmKeys::default_mm()];
   for slot in 1..=7u8 {
      let k = MmKeys::extra(slot);
      env.bootstrap_extra_mm(&k, &[(m1, b1.as_slice()), (m2, b2.as_slice())]);
      mms.push(k);
   }
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id: 0,
      amount: 2_000_000,
      min_odds_scaled: 10_001,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   let ix = get_parlay_quote_proxy_instruction_for(&payload, &[m1, m2], &mms);
   assert!(ix.accounts.len() <= MAX_TX_ACCOUNTS);
   assert!(env.run_ix(ix).program_result.is_ok());
}
