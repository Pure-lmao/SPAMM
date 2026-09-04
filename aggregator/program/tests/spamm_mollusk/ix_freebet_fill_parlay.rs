//! `freebet_fill_parlay` coverage.

use solana_instruction::AccountMeta;

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::FillParlayIxData;
use spamm_aggregator::state::{EventGameState, MarketId};

use crate::common::{
   assert_ok_record_cu, assert_spamm_err, bet_token_ata, bootstrap_issued_freebet, decode_parlay_bet,
   event_id_soccer, event_id_soccer_b, freebet_fill_parlay_instruction, market_soccer_ft_pregame,
   market_spread_pregame, oracle_body_three_outcome, oracle_body_two_outcome, parlay_bet_pda_for,
   parlay_leg, parlay_legs_fill, rich_signer_account, system_owned_empty, user, wrong_signer, Env,
   FREEBET_ID_BASIC,
};

const STAKE: u64 = 5_000_000;

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
fn freebet_fill_parlay_success() {
   let (mut env, m1, m2) = two_leg_setup();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 200_000, 2, &[], &[]);
   let bet_id = 601u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id,
      amount: STAKE,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   let r = env.run_ix(freebet_fill_parlay_instruction(
      FREEBET_ID_BASIC,
      &payload,
      bet,
      bat,
      &[m1, m2],
   ));
   assert_ok_record_cu("freebet_fill_parlay/success", &r);
   let pd = decode_parlay_bet(&env, &bet);
   assert_eq!(pd.freebet_id, FREEBET_ID_BASIC);
   assert_eq!(pd.amount, STAKE);
}

#[test]
fn freebet_fill_parlay_wrong_user() {
   let (mut env, m1, m2) = two_leg_setup();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 200_000, 2, &[], &[]);
   env.upsert(wrong_signer(), rich_signer_account());
   let bet_id = 896u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id,
      amount: STAKE,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   let mut ix = freebet_fill_parlay_instruction(FREEBET_ID_BASIC, &payload, bet, bat, &[m1, m2]);
   ix.accounts[1] = AccountMeta::new_readonly(wrong_signer(), true);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_err());
}

#[test]
fn freebet_fill_parlay_operator_whitelist_reject() {
   let (mut env, m1, m2) = two_leg_setup();
   let other = solana_pubkey::Pubkey::new_from_array([0x22; 32]);
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 200_000, 2, &[], &[other]);
   let bet_id = 602u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id,
      amount: STAKE,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   let r = env.run_ix(freebet_fill_parlay_instruction(
      FREEBET_ID_BASIC,
      &payload,
      bet,
      bat,
      &[m1, m2],
   ));
   assert_spamm_err(&r, SpammError::FreebetOperatorNotAllowed);
}
