//! `freebet_fill_bet` coverage.

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::FillBetIxData;
use spamm_aggregator::state::{EventGameState, FreebetState};

use crate::common::{
   admin, assert_ok_record_cu, assert_spamm_err, bet_pda_for, bet_token_ata, bootstrap_issued_freebet,
   decode_bet, decode_freebet, event_id_soccer, fill_bet_netting_placeholder, fill_cashout_instruction,
   freebet_fill_bet_instruction, market_spread_pregame, mm_program_id, read_token_balance,
   system_owned_empty, user, user_collateral_ata, cashout_escrow_placeholder, cashout_pda_for,
   upsert_cashout_accounts, Env, FREEBET_ID_BASIC,
};

const STAKE: u64 = 10_000_000;

fn fill_data(bet_id: u64, amount: u64) -> (FillBetIxData, spamm_aggregator::state::MarketId) {
   let mid = market_spread_pregame(event_id_soccer());
   (
      FillBetIxData {
         bet_id,
         market_id: mid,
         side: 0,
         amount,
         min_odds_scaled: 15_000,
         event_state_sequence: 1,
         event_game_state: EventGameState::zeroed(),
      },
      mid,
   )
}

#[test]
fn freebet_fill_bet_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 50_000, 1, &[], &[]);
   let bet_id = 501u64;
   let (data, mid) = fill_data(bet_id, STAKE);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let pre_user = read_token_balance(&env, &user_collateral_ata());
   let pre_iss = read_token_balance(&env, &crate::common::issuer_ata());
   let r = env.run_ix(freebet_fill_bet_instruction(
      FREEBET_ID_BASIC,
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert_ok_record_cu("freebet_fill_bet/success", &r);
   let bd = decode_bet(&env, &bet);
   assert_eq!(bd.freebet_id, FREEBET_ID_BASIC);
   assert_eq!(bd.amount, STAKE);
   assert_eq!(decode_freebet(&env, FREEBET_ID_BASIC).state, FreebetState::Used);
   assert_eq!(read_token_balance(&env, &user_collateral_ata()), pre_user);
   assert_eq!(read_token_balance(&env, &crate::common::issuer_ata()), pre_iss - STAKE);
}

#[test]
fn freebet_fill_bet_amount_mismatch() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 50_000, 1, &[], &[]);
   let (data, mid) = fill_data(502, STAKE / 2);
   let bet = bet_pda_for(&user(), 502);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let r = env.run_ix(freebet_fill_bet_instruction(
      FREEBET_ID_BASIC,
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert_spamm_err(&r, SpammError::FreebetAmountMismatch);
}

#[test]
fn freebet_fill_bet_expired() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 50_000, 1, &[], &[]);
   env.set_clock_unix_timestamp(2_000_000);
   let (data, mid) = fill_data(503, STAKE);
   let bet = bet_pda_for(&user(), 503);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let r = env.run_ix(freebet_fill_bet_instruction(
      FREEBET_ID_BASIC,
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert_spamm_err(&r, SpammError::FreebetExpired);
}

#[test]
fn freebet_fill_bet_mm_whitelist_skip() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let other = solana_pubkey::Pubkey::new_from_array([0x11; 32]);
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 50_000, 1, &[other], &[]);
   let (data, mid) = fill_data(504, STAKE);
   let bet = bet_pda_for(&user(), 504);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let r = env.run_ix(freebet_fill_bet_instruction(
      FREEBET_ID_BASIC,
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert_spamm_err(&r, SpammError::NoQuotesAvailable);
}

#[test]
fn freebet_fill_bet_operator_whitelist_reject() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let other = solana_pubkey::Pubkey::new_from_array([0x22; 32]);
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 50_000, 1, &[], &[other]);
   let (data, mid) = fill_data(506, STAKE);
   let bet = bet_pda_for(&user(), 506);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let r = env.run_ix(freebet_fill_bet_instruction(
      FREEBET_ID_BASIC,
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert_spamm_err(&r, SpammError::FreebetOperatorNotAllowed);
}

#[test]
fn freebet_fill_bet_operator_whitelist_ok() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_issued_freebet(
      &mut env,
      FREEBET_ID_BASIC,
      STAKE,
      10_000,
      50_000,
      1,
      &[],
      &[admin()],
   );
   let (data, mid) = fill_data(507, STAKE);
   let bet = bet_pda_for(&user(), 507);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let r = env.run_ix(freebet_fill_bet_instruction(
      FREEBET_ID_BASIC,
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert_ok_record_cu("freebet_fill_bet/operator_ok", &r);
   assert_eq!(decode_freebet(&env, FREEBET_ID_BASIC).state, FreebetState::Used);
}

#[test]
fn freebet_fill_bet_cashout_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 50_000, 1, &[], &[]);
   let bet_id = 505u64;
   let (data, mid) = fill_data(bet_id, STAKE);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let r = env.run_ix(freebet_fill_bet_instruction(
      FREEBET_ID_BASIC,
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert!(r.program_result.is_ok(), "{:?}", r);
   let cashout_id = 9101u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let co_ata = bet_token_ata(&co);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let cdata = spamm_aggregator::instructions::FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: STAKE,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_cashout_instruction(
      &cdata,
      bet,
      bat,
      co,
      co_ata,
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_spamm_err(&r, SpammError::InvalidFreebet);
}
