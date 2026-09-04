//! `freebet_fill_rfq_bet` coverage.

use solana_instruction::AccountMeta;

use spamm_aggregator::instructions::FillRfqBetIxData;
use spamm_aggregator::state::EventGameState;

use crate::common::{
   assert_ok_record_cu, bet_pda_for, bet_token_ata, bootstrap_issued_freebet, decode_bet,
   event_id_soccer, fill_bet_netting_placeholder, freebet_fill_rfq_bet_instruction,
   market_spread_pregame, rich_signer_account, sign_rfq_bet_quote, system_owned_empty, user,
   wrong_signer, Env, FREEBET_ID_BASIC, RFQ_OFFER_EXPIRY,
};

const STAKE: u64 = 10_000_000;

#[test]
fn freebet_fill_rfq_bet_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 50_000, 1, &[], &[]);
   env.set_clock_unix_timestamp(1);
   let market = market_spread_pregame(event_id_soccer());
   let bet_id = 701u64;
   let odds_scaled = 20_000u32;
   let gs = EventGameState::zeroed();
   let sig = sign_rfq_bet_quote(
      &user(),
      bet_id,
      &market,
      &gs,
      1,
      0,
      50_000_000,
      odds_scaled,
      RFQ_OFFER_EXPIRY,
   );
   let data = FillRfqBetIxData {
      bet_id,
      market_id: market,
      side: 0,
      amount: STAKE,
      event_state_sequence: 1,
      event_game_state: gs,
      max_stake: 50_000_000,
      odds_scaled,
      offer_expiry: RFQ_OFFER_EXPIRY,
   };
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let r = env.run_ix(freebet_fill_rfq_bet_instruction(
      FREEBET_ID_BASIC,
      &data,
      &sig,
      bet,
      bat,
      &market,
      fill_bet_netting_placeholder(),
   ));
   assert_ok_record_cu("freebet_fill_rfq_bet/success", &r);
   assert_eq!(decode_bet(&env, &bet).freebet_id, FREEBET_ID_BASIC);
}

#[test]
fn freebet_fill_rfq_bet_wrong_user() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, STAKE, 10_000, 50_000, 1, &[], &[]);
   env.upsert(wrong_signer(), rich_signer_account());
   let market = market_spread_pregame(event_id_soccer());
   let sig = sign_rfq_bet_quote(
      &user(),
      897,
      &market,
      &EventGameState::zeroed(),
      1,
      0,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   let bet = bet_pda_for(&user(), 897);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillRfqBetIxData {
      bet_id: 897,
      market_id: market,
      side: 0,
      amount: STAKE,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
      max_stake: 50_000_000,
      odds_scaled: 20_000,
      offer_expiry: RFQ_OFFER_EXPIRY,
   };
   let mut ix = freebet_fill_rfq_bet_instruction(
      FREEBET_ID_BASIC,
      &data,
      &sig,
      bet,
      bat,
      &market,
      fill_bet_netting_placeholder(),
   );
   ix.accounts[1] = AccountMeta::new_readonly(wrong_signer(), true);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_err());
}
