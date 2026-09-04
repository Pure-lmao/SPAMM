//! `fill_rfq_parlay` coverage.

use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

use spamm_aggregator::constants::{MAX_RFQ_PARLAY_LEGS, ODDS_SCALE};
use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::{FillRfqParlayIxData, FILL_RFQ_PARLAY_IX_DISCRIMINATOR};
use spamm_aggregator::state::account_bet::BetResult;
use spamm_aggregator::state::{EventGameState, MarketId, ParlayLegQuoted};

use crate::common::{
   admin, agg_program_id, assert_account_closed_or_system_empty, assert_parlay_after_fill,
   assert_program_err, assert_spamm_err, bet_token_ata, config_pda, decode_parlay_bet, encumbrance_pda,
   fill_rfq_parlay_instruction, fill_rfq_parlay_metas, FILL_MM_GROUP_OFFSET,
   event_id_soccer, event_id_soccer_b, grade_parlay_instruction, grade_parlay_leg_mask, market_soccer_ft_pregame, market_spread_pregame,
   mm_collateral_ata, oracle_body_three_outcome, oracle_body_two_outcome,
   parlay_bet_pda_for, parlay_leg, parlay_legs_rfq, read_encumbrance, read_token_balance,
   record_cu_success, rfq_max_leg_markets, rfq_parlay_legs_from_markets, settle_parlay_instruction,
   sign_rfq_parlay_quote, system_owned_empty, uniform_parlay_combined_odds, user, user_collateral_ata,
   wrong_signer, RFQ_OFFER_EXPIRY, Env,
};

fn rfq_parlay_legs(m1: MarketId, m2: MarketId, leg_odds: u32) -> [ParlayLegQuoted; MAX_RFQ_PARLAY_LEGS] {
   let gs = EventGameState::zeroed();
   let l0 = parlay_leg(m1, 0, 1, gs).with_odds(leg_odds);
   let l1 = parlay_leg(m2, 1, 1, gs).with_odds(leg_odds);
   parlay_legs_rfq(&[l0, l1])
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

fn upsert_parlay_bet_accounts(env: &mut Env, bet_id: u64) -> (Pubkey, Pubkey) {
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   (bet, bat)
}

fn fill_rfq_parlay_ix_with_metas(
   payload: &FillRfqParlayIxData,
   signature: &[u8; 64],
   metas: Vec<AccountMeta>,
) -> Instruction {
   let n = payload.num_legs as usize;
   let wire_len = FillRfqParlayIxData::wire_len(n);
   let mut wire = vec![0u8; wire_len];
   payload
      .write_wire_with_signature(signature, &mut wire)
      .expect("fill rfq parlay wire");
   let mut buf = vec![FILL_RFQ_PARLAY_IX_DISCRIMINATOR];
   buf.extend_from_slice(&wire);
   Instruction::new_with_bytes(agg_program_id(), &buf, metas)
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
      &table[..2],
      max_stake,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let enc_pre = read_encumbrance(&env, &encumbrance_pda());
   let data = FillRfqParlayIxData {
      bet_id,
      amount,
      max_stake,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "fill_rfq_parlay {:?}", r);
   assert_parlay_after_fill(&env, &bet, &encumbrance_pda(), enc_pre, amount, 2, combined);
   record_cu_success("fill_rfq_parlay/2_leg", &r);
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
      &table[..2],
      50_000_000,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   sig[1] ^= 0xaa;
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::InvalidRfqSignature);
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
      &table[..2],
      50_000_000,
      bad_odds,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      max_stake: 50_000_000,
      odds_scaled: bad_odds,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
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
      &table[..2],
      50_000_000,
      signed_combined,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      max_stake: 50_000_000,
      odds_scaled: wrong_combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::ParlayOddsMismatch);
}

#[test]
fn fill_rfq_parlay_expired_quote() {
   let (mut env, m1, m2) = two_leg_setup();
   env.set_clock_unix_timestamp(1);
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 1300u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table[..2],
      50_000_000,
      combined,
      0,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: 0,
      num_legs: 2,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::QuoteExpired);
}

#[test]
fn fill_rfq_parlay_amount_exceeds_max_stake() {
   let (mut env, m1, m2) = two_leg_setup();
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 1301u64;
   let max_stake = 5_000_000u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table[..2],
      max_stake,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      max_stake,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::StakeExceedsMaxStake);
}

#[test]
fn fill_rfq_parlay_replay_bet_id() {
   let (mut env, m1, m2) = two_leg_setup();
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 1302u64;
   let amount = 10_000_000u64;
   let max_stake = 50_000_000u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table[..2],
      max_stake,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let data = FillRfqParlayIxData {
      bet_id,
      amount,
      max_stake,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let r1 = env.run_ix(fill_rfq_parlay_instruction(&data, &sig, bet, bat));
   assert!(r1.program_result.is_ok(), "first fill {:?}", r1);
   let sig2 = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table[..2],
      max_stake,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let r2 = env.run_ix(fill_rfq_parlay_instruction(&data, &sig2, bet, bat));
   assert_spamm_err(&r2, SpammError::AccountAlreadyExists);
}

#[test]
fn fill_rfq_parlay_wrong_user_in_signed_message() {
   let (mut env, m1, m2) = two_leg_setup();
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 1303u64;
   let sig = sign_rfq_parlay_quote(
      &wrong_signer(),
      bet_id,
      2,
      &table[..2],
      50_000_000,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::InvalidRfqSignature);
}

#[test]
fn fill_rfq_parlay_paused() {
   let (mut env, m1, m2) = two_leg_setup();
   let pause = env.agg_ix(
      1,
      vec![0u8],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   assert!(env.run_ix(pause).program_result.is_ok());
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 1304u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table[..2],
      50_000_000,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::ProgramPaused);
}

#[test]
fn fill_rfq_parlay_bad_mm_config() {
   let (mut env, m1, m2) = two_leg_setup();
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 1305u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table[..2],
      50_000_000,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let mut metas = fill_rfq_parlay_metas(bet, bat);
   let bad_cfg = Pubkey::new_unique();
   env.upsert(bad_cfg, system_owned_empty());
   metas[FILL_MM_GROUP_OFFSET + 1] = AccountMeta::new(bad_cfg, false);
   let ix = fill_rfq_parlay_ix_with_metas(&data, &sig, metas);
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::MmNotRegistered);
}

#[test]
fn fill_rfq_parlay_max_legs_success() {
   let mut env = Env::new();
   let markets_bodies = rfq_max_leg_markets(MAX_RFQ_PARLAY_LEGS);
   let refs: Vec<_> = markets_bodies.iter().map(|(m, b)| (*m, b.as_slice())).collect();
   env.bootstrap_mm_with_markets(&refs);
   let markets: Vec<_> = markets_bodies.iter().map(|(m, _)| *m).collect();
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs_from_markets(&markets, leg_odds);
   let n = MAX_RFQ_PARLAY_LEGS as u8;
   let combined = uniform_parlay_combined_odds(leg_odds, MAX_RFQ_PARLAY_LEGS);
   let bet_id = 1306u64;
   let amount = 10_000_000u64;
   let max_stake = 50_000_000u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      n,
      &table[..MAX_RFQ_PARLAY_LEGS],
      max_stake,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let enc_pre = read_encumbrance(&env, &encumbrance_pda());
   let data = FillRfqParlayIxData {
      bet_id,
      amount,
      max_stake,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: n,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "fill_rfq_parlay max legs {:?}", r);
   assert_parlay_after_fill(
      &env,
      &bet,
      &encumbrance_pda(),
      enc_pre,
      amount,
      n,
      combined,
   );
}

fn craft_rfq_parlay_wire_with_num_legs(
   bet_id: u64,
   amount: u64,
   max_stake: u64,
   odds_scaled: u32,
   offer_expiry: u32,
   num_legs: u8,
   legs: [ParlayLegQuoted; MAX_RFQ_PARLAY_LEGS],
   signature: &[u8; 64],
) -> Vec<u8> {
   // Valid 2-leg body, then poke `num_legs` so `write_wire` is not asked to encode an
   // out-of-range count. `FillRfqParlayIxData::decode` reports `InvalidParlayLegCount`.
   let data = FillRfqParlayIxData {
      bet_id,
      amount,
      max_stake,
      odds_scaled,
      offer_expiry,
      num_legs: 2,
      legs,
   };
   let mut w = vec![0u8; FillRfqParlayIxData::wire_len(2)];
   data
      .write_wire_with_signature(signature, &mut w)
      .expect("rfq parlay wire");
   w[FillRfqParlayIxData::NUM_LEGS_OFFSET] = num_legs;
   w
}

#[test]
fn fill_rfq_parlay_num_legs_invalid() {
   let (mut env, m1, m2) = two_leg_setup();
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let max_stake = 50_000_000u64;
   // Decode reports InvalidParlayLegCount for num_legs outside 2..=MAX.
   for (bet_id, num_legs) in [
      (1307u64, 0u8),
      (1308u64, 1u8),
      (1309u64, (MAX_RFQ_PARLAY_LEGS + 1) as u8),
   ] {
      let sig = sign_rfq_parlay_quote(
         &user(),
         bet_id,
         2,
         &table[..2],
         max_stake,
         combined,
         RFQ_OFFER_EXPIRY,
      );
      let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
      let wire = craft_rfq_parlay_wire_with_num_legs(
         bet_id,
         10_000_000,
         max_stake,
         combined,
         RFQ_OFFER_EXPIRY,
         num_legs,
         table,
         &sig,
      );
      let mut buf = vec![FILL_RFQ_PARLAY_IX_DISCRIMINATOR];
      buf.extend_from_slice(&wire);
      let ix = Instruction::new_with_bytes(agg_program_id(), &buf, fill_rfq_parlay_metas(bet, bat));
      let r = env.run_ix(ix);
      assert_spamm_err(&r, SpammError::InvalidParlayLegCount);
   }
}

#[test]
fn fill_rfq_parlay_event_rule_violation() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let m1 = market_spread_pregame(eid);
   let m2 = market_soccer_ft_pregame(eid);
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   let gs = EventGameState::zeroed();
   let l0 = parlay_leg(m1, 0, 1, gs).with_odds(0);
   let l1 = parlay_leg(m2, 1, 1, gs).with_odds(0);
   let table = parlay_legs_rfq(&[l0, l1]);
   // Ticket odds must clear `validate_odds_above_scale`; event-rule check runs before product match.
   let odds_scaled = 20_000u32;
   let bet_id = 1310u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table[..2],
      50_000_000,
      odds_scaled,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      max_stake: 50_000_000,
      odds_scaled,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::ParlayEventRuleViolation);
}

#[test]
fn fill_rfq_parlay_insufficient_liquidity() {
   let (mut env, m1, m2) = two_leg_setup();
   env.patch_spl_token_balance(mm_collateral_ata(), 0);
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 1311u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table[..2],
      50_000_000,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let data = FillRfqParlayIxData {
      bet_id,
      amount: 10_000_000,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let ix = fill_rfq_parlay_instruction(&data, &sig, bet, bat);
   let r = env.run_ix(ix);
   // Zero MM ATA: RFQ fill CPI propagates SPL Token InsufficientFunds (`Custom(1)`).
   assert_program_err(&r, ProgramError::Custom(1));
}

#[test]
fn fill_rfq_parlay_grade_settle_e2e() {
   let (mut env, m1, m2) = two_leg_setup();
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 1312u64;
   let amount = 4_000_000u64;
   let max_stake = 50_000_000u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table[..2],
      max_stake,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let (bet, bat) = upsert_parlay_bet_accounts(&mut env, bet_id);
   let enc_before = read_encumbrance(&env, &encumbrance_pda());
   let data = FillRfqParlayIxData {
      bet_id,
      amount,
      max_stake,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let fill = env.run_ix(fill_rfq_parlay_instruction(&data, &sig, bet, bat));
   assert!(fill.program_result.is_ok(), "{:?}", fill);
   assert_parlay_after_fill(
      &env,
      &bet,
      &encumbrance_pda(),
      enc_before,
      amount,
      2,
      combined,
   );

   let gr = env.run_ix(grade_parlay_instruction(
      &grade_parlay_leg_mask(&[BetResult::Won as u8, BetResult::Won as u8]),
      bet,
      admin(),
   ));
   assert!(gr.program_result.is_ok(), "{:?}", gr);

   let pd = decode_parlay_bet(&env, &bet);
   let profit = pd.payout.saturating_sub(pd.amount);
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let st = env.run_ix(settle_parlay_instruction(bet, bat, bet_id));
   assert!(st.program_result.is_ok(), "{:?}", st);
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
