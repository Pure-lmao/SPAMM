//! `fill_rfq_cashout` Mollusk coverage.

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::{FillBetIxData, FillRfqCashoutIxData};
use spamm_aggregator::state::EventGameState;

use crate::common::{
   assert_ok_record_cu, assert_spamm_err, bet_pda_for, bet_token_ata, cashout_escrow_placeholder,
   cashout_pda_for, credit_liability_free, decode_bet, encumbrance_pda, expected_cashout_payment, event_id_soccer, fill_bet_instruction,
   fill_bet_netting_placeholder, fill_rfq_cashout_instruction, liability_token_ata, market_spread_pregame, mm_collateral_ata,
   mm_program_id, read_encumbrance, read_token_balance, sign_rfq_cashout_quote, system_owned_empty, upsert_cashout_accounts, user, user_collateral_ata, Env,
   RFQ_OFFER_EXPIRY,
};

fn fill_open_bet(env: &mut Env, bet_id: u64, amount: u64) {
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount,
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
         fill_bet_netting_placeholder(),
      ))
      .program_result
      .is_ok());
}

#[test]
fn fill_rfq_cashout_pregame_full_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1601u64;
   let stake = 10_000_000u64;
   fill_open_bet(&mut env, bet_id, stake);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let mid = market_spread_pregame(event_id_soccer());
   let bd = decode_bet(&env, &bet);
   let cashout_id = 9201u64;
   let max_payment = expected_cashout_payment(stake, bd.payout, 20_000);
   let gs = EventGameState::zeroed();
   let sig = sign_rfq_cashout_quote(
      &user(),
      bet_id,
      cashout_id,
      stake,
      max_payment,
      RFQ_OFFER_EXPIRY,
      1,
      &gs,
   );
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let data = FillRfqCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      max_payment,
      offer_expiry: RFQ_OFFER_EXPIRY,
      event_state_sequence: 1,
      event_game_state: gs,
   };
   let r = env.run_ix(fill_rfq_cashout_instruction(
      &data,
      &sig,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_ok_record_cu("fill_rfq_cashout/pregame_full", &r);
}

#[test]
fn fill_rfq_cashout_full_free_liability() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1604u64;
   let stake = 10_000_000u64;
   fill_open_bet(&mut env, bet_id, stake);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let mid = market_spread_pregame(event_id_soccer());
   let bd = decode_bet(&env, &bet);
   let cashout_id = 9204u64;
   let max_payment = expected_cashout_payment(stake, bd.payout, 20_000);
   credit_liability_free(&mut env, max_payment);
   env.patch_spl_token_balance(mm_collateral_ata(), 0);
   let gs = EventGameState::zeroed();
   let sig = sign_rfq_cashout_quote(
      &user(),
      bet_id,
      cashout_id,
      stake,
      max_payment,
      RFQ_OFFER_EXPIRY,
      1,
      &gs,
   );
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_enc = read_encumbrance(&env, &encumbrance_pda());
   let data = FillRfqCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      max_payment,
      offer_expiry: RFQ_OFFER_EXPIRY,
      event_state_sequence: 1,
      event_game_state: gs,
   };
   let r = env.run_ix(fill_rfq_cashout_instruction(
      &data,
      &sig,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_ok_record_cu("fill_rfq_cashout/full_free_liability", &r);
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
fn fill_rfq_cashout_partial_free_liability() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1605u64;
   let stake = 10_000_000u64;
   fill_open_bet(&mut env, bet_id, stake);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let mid = market_spread_pregame(event_id_soccer());
   let bd = decode_bet(&env, &bet);
   let cashout_id = 9205u64;
   let max_payment = expected_cashout_payment(stake, bd.payout, 20_000);
   let amount_from_liability = max_payment / 2;
   let amount_to_send = max_payment - amount_from_liability;
   credit_liability_free(&mut env, amount_from_liability);
   let gs = EventGameState::zeroed();
   let sig = sign_rfq_cashout_quote(
      &user(),
      bet_id,
      cashout_id,
      stake,
      max_payment,
      RFQ_OFFER_EXPIRY,
      1,
      &gs,
   );
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_enc = read_encumbrance(&env, &encumbrance_pda());
   let data = FillRfqCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      max_payment,
      offer_expiry: RFQ_OFFER_EXPIRY,
      event_state_sequence: 1,
      event_game_state: gs,
   };
   let r = env.run_ix(fill_rfq_cashout_instruction(
      &data,
      &sig,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_ok_record_cu("fill_rfq_cashout/partial_free_liability", &r);
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
fn fill_rfq_cashout_slippage_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1602u64;
   fill_open_bet(&mut env, bet_id, 5_000_000);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let mid = market_spread_pregame(event_id_soccer());
   let cashout_id = 9202u64;
   let gs = EventGameState::zeroed();
   let max_payment = 100u64;
   let min_payout = 1_000_000u64;
   let sig = sign_rfq_cashout_quote(
      &user(),
      bet_id,
      cashout_id,
      5_000_000,
      max_payment,
      RFQ_OFFER_EXPIRY,
      1,
      &gs,
   );
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let data = FillRfqCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: 5_000_000,
      min_payout,
      max_payment,
      offer_expiry: RFQ_OFFER_EXPIRY,
      event_state_sequence: 1,
      event_game_state: gs,
   };
   let r = env.run_ix(fill_rfq_cashout_instruction(
      &data,
      &sig,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_spamm_err(&r, SpammError::SlippageExceeded);
}

#[test]
fn fill_rfq_cashout_bad_signature() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1603u64;
   fill_open_bet(&mut env, bet_id, 5_000_000);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let mid = market_spread_pregame(event_id_soccer());
   let cashout_id = 9203u64;
   let gs = EventGameState::zeroed();
   let mut sig = sign_rfq_cashout_quote(
      &user(),
      bet_id,
      cashout_id,
      5_000_000,
      1_000_000,
      RFQ_OFFER_EXPIRY,
      1,
      &gs,
   );
   sig[0] ^= 0xff;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let data = FillRfqCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: 5_000_000,
      min_payout: 1,
      max_payment: 1_000_000,
      offer_expiry: RFQ_OFFER_EXPIRY,
      event_state_sequence: 1,
      event_game_state: gs,
   };
   let r = env.run_ix(fill_rfq_cashout_instruction(
      &data,
      &sig,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_spamm_err(&r, SpammError::InvalidRfqSignature);
}
