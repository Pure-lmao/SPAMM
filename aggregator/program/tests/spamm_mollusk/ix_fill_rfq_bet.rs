//! `fill_rfq_bet` coverage (success + representative failures).

use solana_instruction::AccountMeta;

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::helpers::calc_potential_profit;
use spamm_aggregator::instructions::FillRfqBetIxData;
use spamm_aggregator::state::EventGameState;

use crate::common::{
   admin, assert_bet_after_fill, assert_ok_record_cu, assert_spamm_err, bet_pda_for, bet_token_ata,
   config_pda, encumbrance_pda, event_id_soccer, fill_bet_netting_placeholder, fill_rfq_bet_instruction,
   market_spread_pregame, read_encumbrance, read_token_balance, sign_rfq_bet_quote,
   sign_rfq_bet_quote_other_mm, sign_rfq_bet_quote_wrong_domain, system_owned_empty, user,
   user_collateral_ata, RFQ_OFFER_EXPIRY, Env,
};

fn run_fill_rfq_bet(
   env: &mut Env,
   bet_id: u64,
   amount: u64,
   max_stake: u64,
   odds_scaled: u32,
   offer_expiry: u32,
   signature: [u8; 64],
   mm_netting: solana_pubkey::Pubkey,
) -> mollusk_svm::result::InstructionResult {
   let market = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   if env.get_account(&bet).is_none() {
      env.upsert(bet, system_owned_empty());
   }
   if env.get_account(&bat).is_none() {
      env.upsert(bat, system_owned_empty());
   }
   let gs = EventGameState::zeroed();
   let data = FillRfqBetIxData {
      bet_id,
      market_id: market,
      side: 0,
      amount,
      event_state_sequence: 1,
      event_game_state: gs,
      max_stake,
      odds_scaled,
      offer_expiry,
   };
   let ix = fill_rfq_bet_instruction(&data, &signature, bet, bat, &market, mm_netting);
   env.run_ix(ix)
}

#[test]
fn fill_rfq_bet_one_mm_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let amount = 10_000_000u64;
   let max_stake = 50_000_000u64;
   let odds_scaled = 20_000u32;
   let gs = EventGameState::zeroed();
   let sig = sign_rfq_bet_quote(
      &user(),
      crate::common::BET_ID_BASIC,
      &market,
      &gs,
      1,
      0,
      max_stake,
      odds_scaled,
      RFQ_OFFER_EXPIRY,
   );
   let enc_pre = read_encumbrance(&env, &encumbrance_pda());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let r = run_fill_rfq_bet(
      &mut env,
      crate::common::BET_ID_BASIC,
      amount,
      max_stake,
      odds_scaled,
      RFQ_OFFER_EXPIRY,
      sig,
      fill_bet_netting_placeholder(),
   );
   assert_ok_record_cu("fill_rfq_bet/1_mm/no_netting", &r);
   let bet = bet_pda_for(&user(), crate::common::BET_ID_BASIC);
   assert_bet_after_fill(&env, &bet, amount, 0);
   let post_u = read_token_balance(&env, &user_collateral_ata());
   assert_eq!(pre_u - post_u, amount);
   let enc_post = read_encumbrance(&env, &encumbrance_pda());
   assert!(enc_post >= enc_pre);
}

#[test]
fn fill_rfq_bet_bad_signature_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let mut sig = sign_rfq_bet_quote(
      &user(),
      901,
      &market,
      &EventGameState::zeroed(),
      1,
      0,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   sig[0] ^= 0xff;
   let r = run_fill_rfq_bet(
      &mut env,
      901,
      10_000_000,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
      sig,
      fill_bet_netting_placeholder(),
   );
   assert_spamm_err(&r, SpammError::InvalidRfqSignature);
}

#[test]
fn fill_rfq_bet_expired_quote_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.set_clock_unix_timestamp(1);
   let market = market_spread_pregame(event_id_soccer());
   let sig = sign_rfq_bet_quote(
      &user(),
      902,
      &market,
      &EventGameState::zeroed(),
      1,
      0,
      50_000_000,
      20_000,
      0,
   );
   let r = run_fill_rfq_bet(
      &mut env,
      902,
      10_000_000,
      50_000_000,
      20_000,
      0,
      sig,
      fill_bet_netting_placeholder(),
   );
   assert_spamm_err(&r, SpammError::QuoteExpired);
}

#[test]
fn fill_rfq_bet_amount_exceeds_max_stake() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let max_stake = 5_000_000u64;
   let sig = sign_rfq_bet_quote(
      &user(),
      903,
      &market,
      &EventGameState::zeroed(),
      1,
      0,
      max_stake,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   let r = run_fill_rfq_bet(
      &mut env,
      903,
      10_000_000,
      max_stake,
      20_000,
      RFQ_OFFER_EXPIRY,
      sig,
      fill_bet_netting_placeholder(),
   );
   assert_spamm_err(&r, SpammError::StakeExceedsMaxStake);
}

#[test]
fn fill_rfq_bet_replay_same_bet_id_fails() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let bet_id = 904u64;
   let gs = EventGameState::zeroed();
   let sig = sign_rfq_bet_quote(
      &user(),
      bet_id,
      &market,
      &gs,
      1,
      0,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   let r1 = run_fill_rfq_bet(
      &mut env,
      bet_id,
      10_000_000,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
      sig,
      fill_bet_netting_placeholder(),
   );
   assert!(r1.program_result.is_ok(), "first fill {:?}", r1);
   let sig2 = sign_rfq_bet_quote(
      &user(),
      bet_id,
      &market,
      &gs,
      1,
      0,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   let r2 = run_fill_rfq_bet(
      &mut env,
      bet_id,
      10_000_000,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
      sig2,
      fill_bet_netting_placeholder(),
   );
   assert_spamm_err(&r2, SpammError::AccountAlreadyExists);
}

#[test]
fn fill_rfq_bet_wrong_user_in_signed_message() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let sig = sign_rfq_bet_quote(
      &crate::common::wrong_signer(),
      905,
      &market,
      &EventGameState::zeroed(),
      1,
      0,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   let r = run_fill_rfq_bet(
      &mut env,
      905,
      10_000_000,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
      sig,
      fill_bet_netting_placeholder(),
   );
   assert_spamm_err(&r, SpammError::InvalidRfqSignature);
}

#[test]
fn fill_rfq_bet_encumbrance_equals_profit() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let amount = 10_000_000u64;
   let odds_scaled = 20_000u32;
   let sig = sign_rfq_bet_quote(
      &user(),
      881,
      &market,
      &EventGameState::zeroed(),
      1,
      0,
      50_000_000,
      odds_scaled,
      RFQ_OFFER_EXPIRY,
   );
   let enc_pre = read_encumbrance(&env, &encumbrance_pda());
   let r = run_fill_rfq_bet(
      &mut env,
      881,
      amount,
      50_000_000,
      odds_scaled,
      RFQ_OFFER_EXPIRY,
      sig,
      fill_bet_netting_placeholder(),
   );
   assert!(r.program_result.is_ok(), "{:?}", r);
   let p = calc_potential_profit(amount, odds_scaled).unwrap();
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc_pre + p as i64);
}

#[test]
fn fill_rfq_bet_paused() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let pause = env.agg_ix(
      1,
      vec![0u8],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   assert!(env.run_ix(pause).program_result.is_ok());
   let market = market_spread_pregame(event_id_soccer());
   let sig = sign_rfq_bet_quote(
      &user(),
      882,
      &market,
      &EventGameState::zeroed(),
      1,
      0,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   let r = run_fill_rfq_bet(
      &mut env,
      882,
      1_000_000,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
      sig,
      fill_bet_netting_placeholder(),
   );
   assert_spamm_err(&r, SpammError::ProgramPaused);
}

#[test]
fn fill_rfq_bet_wrong_domain() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let sig = sign_rfq_bet_quote_wrong_domain(
      &user(),
      883,
      &market,
      &EventGameState::zeroed(),
      1,
      0,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   let r = run_fill_rfq_bet(
      &mut env,
      883,
      1_000_000,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
      sig,
      fill_bet_netting_placeholder(),
   );
   assert_spamm_err(&r, SpammError::InvalidRfqSignature);
}

#[test]
fn fill_rfq_bet_signed_other_mm() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let market = market_spread_pregame(event_id_soccer());
   let sig = sign_rfq_bet_quote_other_mm(
      &user(),
      884,
      &market,
      &EventGameState::zeroed(),
      1,
      0,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   let r = run_fill_rfq_bet(
      &mut env,
      884,
      1_000_000,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
      sig,
      fill_bet_netting_placeholder(),
   );
   assert_spamm_err(&r, SpammError::InvalidRfqSignature);
}
