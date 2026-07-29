//! `fill_rfq_parlay` coverage.

use solana_program_error::ProgramError;

use spamm_aggregator::constants::ODDS_SCALE;
use spamm_aggregator::instructions::FillRfqParlayIxData;
use spamm_aggregator::state::{EventGameState, MarketId, ParlayLegTable};

use crate::common::{
   assert_parlay_after_fill, assert_program_err, bet_token_ata, encumbrance_pda, event_id_soccer,
   event_id_soccer_b, fill_rfq_parlay_instruction, market_soccer_ft_pregame, market_spread_pregame,
   oracle_body_three_outcome, oracle_body_two_outcome, parlay_bet_pda_for, parlay_leg, parlay_table,
   read_encumbrance, sign_rfq_parlay_quote, system_owned_empty, uniform_parlay_combined_odds, user,
   RFQ_OFFER_EXPIRY, Env,
};

fn rfq_parlay_legs(m1: MarketId, m2: MarketId, leg_odds: u32) -> ParlayLegTable {
   let gs = EventGameState::zeroed();
   let mut l0 = parlay_leg(m1, 0, 1, gs);
   let mut l1 = parlay_leg(m2, 1, 1, gs);
   l0.odds_scaled = leg_odds;
   l1.odds_scaled = leg_odds;
   parlay_table(&[l0, l1])
}

fn two_leg_setup() -> (Env, MarketId, MarketId) {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   (env, m1, m2)
}

#[test]
fn fill_rfq_parlay_two_legs_success() {
   let (mut env, m1, m2) = two_leg_setup();
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 1201u64;
   let amount = 10_000_000u64;
   let max_stake = 50_000_000u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table,
      max_stake,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let enc_pre = read_encumbrance(&env, &encumbrance_pda());
   let data = FillRfqParlayIxData {
      bet_id,
      amount,
      num_legs: 2,
      legs: table,
      max_stake,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat, &[m1, m2]);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "fill_rfq_parlay {:?}", r);
   assert_parlay_after_fill(&env, &bet, &encumbrance_pda(), enc_pre, amount, 2, combined);
}

#[test]
fn fill_rfq_parlay_bad_signature_rejected() {
   let (mut env, m1, m2) = two_leg_setup();
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 1202u64;
   let mut sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table,
      50_000_000,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   sig[1] ^= 0xaa;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      num_legs: 2,
      legs: table,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat, &[m1, m2]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_rfq_parlay_odds_below_scale_rejected() {
   let (mut env, m1, m2) = two_leg_setup();
   let table = rfq_parlay_legs(m1, m2, 20_000);
   let bad_odds = ODDS_SCALE as u32;
   let bet_id = 1203u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table,
      50_000_000,
      bad_odds,
      RFQ_OFFER_EXPIRY,
   );
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      num_legs: 2,
      legs: table,
      max_stake: 50_000_000,
      odds_scaled: bad_odds,
      offer_expiry: RFQ_OFFER_EXPIRY,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat, &[m1, m2]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_rfq_parlay_leg_odds_product_mismatch_rejected() {
   let (mut env, m1, m2) = two_leg_setup();
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let signed_combined = uniform_parlay_combined_odds(leg_odds, 2);
   let wrong_combined = signed_combined + 1;
   let bet_id = 1204u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table,
      50_000_000,
      signed_combined,
      RFQ_OFFER_EXPIRY,
   );
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      num_legs: 2,
      legs: table,
      max_stake: 50_000_000,
      odds_scaled: wrong_combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat, &[m1, m2]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}
