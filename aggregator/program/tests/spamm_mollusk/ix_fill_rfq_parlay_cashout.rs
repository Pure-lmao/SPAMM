//! `fill_rfq_parlay_cashout` Mollusk coverage.

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::{FillParlayIxData, FillRfqParlayCashoutIxData};
use spamm_aggregator::state::{EventGameState, MarketId, CashoutSnapshot};

use crate::common::{
   assert_ok_record_cu, assert_spamm_err, bet_token_ata, cashout_escrow_placeholder,
   cashout_parlay_pda_for, credit_liability_free, decode_parlay_bet, encumbrance_pda, event_id_soccer, event_id_soccer_b,
   expected_cashout_payment, fill_parlay_instruction, fill_rfq_parlay_cashout_instruction, liability_token_ata,
   market_soccer_ft_pregame, market_spread_pregame, mm_collateral_ata, mm_program_id, oracle_body_three_outcome,
   oracle_body_two_outcome, parlay_bet_pda_for, parlay_leg,
   parlay_legs_fill, read_encumbrance, read_token_balance, rfq_parlay_cashout_snapshots, sign_rfq_cashout_parlay_quote,
   system_owned_empty, upsert_cashout_accounts, user, user_collateral_ata, Env, RFQ_OFFER_EXPIRY,
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

fn fill_two_leg(env: &mut Env, m1: MarketId, m2: MarketId, bet_id: u64, amount: u64) {
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id,
      amount,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   assert!(env
      .run_ix(fill_parlay_instruction(&payload, bet, bat, &[m1, m2]))
      .program_result
      .is_ok());
}

#[test]
fn fill_rfq_parlay_cashout_pregame_full_success() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet_id = 1701u64;
   let stake = 5_000_000u64;
   fill_two_leg(&mut env, m1, m2, bet_id, stake);
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let bd = decode_parlay_bet(&env, &bet);
   // Combined odds ≈ 20_000² / ODDS_SCALE for two equal legs.
   let combined = crate::common::uniform_parlay_combined_odds(20_000, 2);
   let max_payment = expected_cashout_payment(stake, bd.payout, combined);
   let cashout_id = 9301u64;
   let snaps = [
      CashoutSnapshot {
         event_state_sequence: 1,
         event_game_state: EventGameState::zeroed(),
      },
      CashoutSnapshot {
         event_state_sequence: 1,
         event_game_state: EventGameState::zeroed(),
      },
   ];
   let sig = sign_rfq_cashout_parlay_quote(
      &user(),
      bet_id,
      cashout_id,
      stake,
      max_payment,
      RFQ_OFFER_EXPIRY,
      2,
      &snaps,
   );
   let co = cashout_parlay_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let data = FillRfqParlayCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      max_payment,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      snapshots: rfq_parlay_cashout_snapshots(2, 1),
   };
   let r = env.run_ix(fill_rfq_parlay_cashout_instruction(
      &data,
      &sig,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &[m1, m2],
   ));
   assert_ok_record_cu("fill_rfq_parlay_cashout/pregame_full", &r);
}

#[test]
fn fill_rfq_parlay_cashout_full_free_liability() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet_id = 1703u64;
   let stake = 5_000_000u64;
   fill_two_leg(&mut env, m1, m2, bet_id, stake);
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let bd = decode_parlay_bet(&env, &bet);
   let combined = crate::common::uniform_parlay_combined_odds(20_000, 2);
   let max_payment = expected_cashout_payment(stake, bd.payout, combined);
   credit_liability_free(&mut env, max_payment);
   env.patch_spl_token_balance(mm_collateral_ata(), 0);
   let cashout_id = 9303u64;
   let snaps = [
      CashoutSnapshot {
         event_state_sequence: 1,
         event_game_state: EventGameState::zeroed(),
      },
      CashoutSnapshot {
         event_state_sequence: 1,
         event_game_state: EventGameState::zeroed(),
      },
   ];
   let sig = sign_rfq_cashout_parlay_quote(
      &user(),
      bet_id,
      cashout_id,
      stake,
      max_payment,
      RFQ_OFFER_EXPIRY,
      2,
      &snaps,
   );
   let co = cashout_parlay_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_enc = read_encumbrance(&env, &encumbrance_pda());
   let data = FillRfqParlayCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      max_payment,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      snapshots: rfq_parlay_cashout_snapshots(2, 1),
   };
   let r = env.run_ix(fill_rfq_parlay_cashout_instruction(
      &data,
      &sig,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &[m1, m2],
   ));
   assert_ok_record_cu("fill_rfq_parlay_cashout/full_free_liability", &r);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u + max_payment
   );
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      pre_liab - max_payment
   );
   assert_eq!(read_token_balance(&env, &mm_collateral_ata()), pre_mm);
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), pre_enc);
}

#[test]
fn fill_rfq_parlay_cashout_partial_free_liability() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet_id = 1704u64;
   let stake = 5_000_000u64;
   fill_two_leg(&mut env, m1, m2, bet_id, stake);
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let bd = decode_parlay_bet(&env, &bet);
   let combined = crate::common::uniform_parlay_combined_odds(20_000, 2);
   let max_payment = expected_cashout_payment(stake, bd.payout, combined);
   let amount_from_liability = max_payment / 2;
   let amount_to_send = max_payment - amount_from_liability;
   credit_liability_free(&mut env, amount_from_liability);
   let cashout_id = 9304u64;
   let snaps = [
      CashoutSnapshot {
         event_state_sequence: 1,
         event_game_state: EventGameState::zeroed(),
      },
      CashoutSnapshot {
         event_state_sequence: 1,
         event_game_state: EventGameState::zeroed(),
      },
   ];
   let sig = sign_rfq_cashout_parlay_quote(
      &user(),
      bet_id,
      cashout_id,
      stake,
      max_payment,
      RFQ_OFFER_EXPIRY,
      2,
      &snaps,
   );
   let co = cashout_parlay_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_enc = read_encumbrance(&env, &encumbrance_pda());
   let data = FillRfqParlayCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      max_payment,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      snapshots: rfq_parlay_cashout_snapshots(2, 1),
   };
   let r = env.run_ix(fill_rfq_parlay_cashout_instruction(
      &data,
      &sig,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &[m1, m2],
   ));
   assert_ok_record_cu("fill_rfq_parlay_cashout/partial_free_liability", &r);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u + max_payment
   );
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      pre_liab - amount_from_liability
   );
   assert_eq!(
      read_token_balance(&env, &mm_collateral_ata()),
      pre_mm - amount_to_send
   );
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), pre_enc);
}

#[test]
fn fill_rfq_parlay_cashout_slippage() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet_id = 1702u64;
   fill_two_leg(&mut env, m1, m2, bet_id, 5_000_000);
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let cashout_id = 9302u64;
   let snaps = [
      CashoutSnapshot {
         event_state_sequence: 1,
         event_game_state: EventGameState::zeroed(),
      },
      CashoutSnapshot {
         event_state_sequence: 1,
         event_game_state: EventGameState::zeroed(),
      },
   ];
   let sig = sign_rfq_cashout_parlay_quote(
      &user(),
      bet_id,
      cashout_id,
      5_000_000,
      100,
      RFQ_OFFER_EXPIRY,
      2,
      &snaps,
   );
   let co = cashout_parlay_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let data = FillRfqParlayCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: 5_000_000,
      min_payout: 1_000_000,
      max_payment: 100,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      snapshots: rfq_parlay_cashout_snapshots(2, 1),
   };
   let r = env.run_ix(fill_rfq_parlay_cashout_instruction(
      &data,
      &sig,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &[m1, m2],
   ));
   assert_spamm_err(&r, SpammError::SlippageExceeded);
}
