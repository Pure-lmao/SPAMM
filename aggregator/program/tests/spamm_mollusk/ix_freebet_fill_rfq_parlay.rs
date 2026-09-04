//! `freebet_fill_rfq_parlay` coverage.

use solana_instruction::AccountMeta;

use spamm_aggregator::constants::MAX_RFQ_PARLAY_LEGS;
use spamm_aggregator::instructions::FillRfqParlayIxData;
use spamm_aggregator::state::{EventGameState, MarketId, ParlayLegQuoted};

use crate::common::{
   assert_ok_record_cu, bet_token_ata, bootstrap_issued_freebet, decode_parlay_bet, event_id_soccer,
   event_id_soccer_b, freebet_fill_rfq_parlay_instruction, market_soccer_ft_pregame,
   market_spread_pregame, oracle_body_three_outcome, oracle_body_two_outcome, parlay_bet_pda_for,
   parlay_leg, parlay_legs_rfq, rich_signer_account, sign_rfq_parlay_quote, system_owned_empty,
   uniform_parlay_combined_odds, user, wrong_signer, Env, FREEBET_ID_BASIC, RFQ_OFFER_EXPIRY,
};

const STAKE: u64 = 10_000_000;

fn rfq_parlay_legs(m1: MarketId, m2: MarketId, leg_odds: u32) -> [ParlayLegQuoted; MAX_RFQ_PARLAY_LEGS] {
   let gs = EventGameState::zeroed();
   let l0 = parlay_leg(m1, 0, 1, gs).with_odds(leg_odds);
   let l1 = parlay_leg(m2, 1, 1, gs).with_odds(leg_odds);
   parlay_legs_rfq(&[l0, l1])
}

#[test]
fn freebet_fill_rfq_parlay_success() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 200_000, 2, &[], &[]);
   env.set_clock_unix_timestamp(1);
   let leg_odds = 20_000u32;
   let table = rfq_parlay_legs(m1, m2, leg_odds);
   let combined = uniform_parlay_combined_odds(leg_odds, 2);
   let bet_id = 801u64;
   let sig = sign_rfq_parlay_quote(
      &user(),
      bet_id,
      2,
      &table[..2],
      50_000_000,
      combined,
      RFQ_OFFER_EXPIRY,
   );
   let payload = FillRfqParlayIxData {
      bet_id,
      amount: STAKE,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let r = env.run_ix(freebet_fill_rfq_parlay_instruction(
      FREEBET_ID_BASIC,
      &payload,
      &sig,
      bet,
      bat,
   ));
   assert_ok_record_cu("freebet_fill_rfq_parlay/success", &r);
   assert_eq!(decode_parlay_bet(&env, &bet).freebet_id, FREEBET_ID_BASIC);
}

#[test]
fn freebet_fill_rfq_parlay_wrong_user() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_soccer_ft_pregame(event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 200_000, 2, &[], &[]);
   env.upsert(wrong_signer(), rich_signer_account());
   let table = rfq_parlay_legs(m1, m2, 20_000);
   let combined = uniform_parlay_combined_odds(20_000, 2);
   let bet_id = 898u64;
   let sig = sign_rfq_parlay_quote(&user(), bet_id, 2, &table[..2], 50_000_000, combined, RFQ_OFFER_EXPIRY);
   let payload = FillRfqParlayIxData {
      bet_id,
      amount: STAKE,
      max_stake: 50_000_000,
      odds_scaled: combined,
      offer_expiry: RFQ_OFFER_EXPIRY,
      num_legs: 2,
      legs: table,
   };
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let mut ix = freebet_fill_rfq_parlay_instruction(FREEBET_ID_BASIC, &payload, &sig, bet, bat);
   ix.accounts[1] = AccountMeta::new_readonly(wrong_signer(), true);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_err());
}
