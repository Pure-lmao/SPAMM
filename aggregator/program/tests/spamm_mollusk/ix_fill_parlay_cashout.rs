//! `fill_parlay_cashout` Mollusk coverage.

use solana_pubkey::Pubkey;

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::{FillParlayCashoutIxData, FillParlayIxData};
use spamm_aggregator::state::account_bet::BetResult;
use spamm_aggregator::state::{EventGameState, MarketId};

use crate::common::{
   assert_ok_record_cu, assert_spamm_err, bet_token_ata, cashout_escrow_pda_for, cashout_escrow_placeholder,
   cashout_parlay_pda_for, credit_liability_free, decode_parlay_bet, encumbrance_pda, event_id_soccer, event_id_soccer_b,
   fill_parlay_cashout_instruction, fill_parlay_instruction, liability_token_ata, market_soccer_ft_pregame,
   market_spread_pregame, mm_collateral_ata, mm_parlay_quote_buffer_is_used, mm_program_id, oracle_body_three_outcome, oracle_body_two_outcome,
   parlay_bet_pda_for, parlay_cashout_snapshots, parlay_leg, parlay_legs_fill, read_encumbrance, read_token_balance, system_owned_empty,
   upsert_cashout_accounts, user, Env,
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

fn fill_two_leg(env: &mut Env, m1: MarketId, m2: MarketId, bet_id: u64, amount: u64) -> (Pubkey, Pubkey) {
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
   let r = env.run_ix(fill_parlay_instruction(&payload, bet, bat, &[m1, m2]));
   assert!(r.program_result.is_ok(), "fill_parlay prelude {:?}", r);
   (bet, bat)
}

#[test]
fn fill_parlay_cashout_pregame_full_success() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet_id = 1501u64;
   let (bet, bat) = fill_two_leg(&mut env, m1, m2, bet_id, 5_000_000);
   let cashout_id = 9101u64;
   let co = cashout_parlay_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let payload = FillParlayCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: 5_000_000,
      min_payout: 1,
      num_legs: 2,
      snapshots: parlay_cashout_snapshots(2, 1),
   };
   let r = env.run_ix(fill_parlay_cashout_instruction(
      &payload,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &[m1, m2],
   ));
   assert_ok_record_cu("fill_parlay_cashout/pregame_full", &r);
   assert!(env.get_account(&co).unwrap().data.len() > 0);
}

#[test]
fn fill_parlay_cashout_partial_remaining_pending() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet_id = 1502u64;
   let stake = 8_000_000u64;
   let (bet, bat) = fill_two_leg(&mut env, m1, m2, bet_id, stake);
   let cashout_id = 9102u64;
   let co = cashout_parlay_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let cash_amt = 3_000_000u64;
   let payload = FillParlayCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: cash_amt,
      min_payout: 1,
      num_legs: 2,
      snapshots: parlay_cashout_snapshots(2, 1),
   };
   let r = env.run_ix(fill_parlay_cashout_instruction(
      &payload,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &[m1, m2],
   ));
   assert_ok_record_cu("fill_parlay_cashout/pregame_partial", &r);
   let rem = decode_parlay_bet(&env, &bet);
   assert!(matches!(rem.result, BetResult::Pending));
   assert_eq!(rem.amount, stake - cash_amt);
}

#[test]
fn fill_parlay_cashout_no_quotes() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet_id = 1503u64;
   let (bet, bat) = fill_two_leg(&mut env, m1, m2, bet_id, 5_000_000);
   let cashout_id = 9103u64;
   let co = cashout_parlay_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let payload = FillParlayCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: 5_000_000,
      // Fair C is capped below payout; floor at full payout → MM soft-fails → NoQuotes.
      min_payout: {
         let pd = decode_parlay_bet(&env, &bet);
         pd.payout
      },
      num_legs: 2,
      snapshots: parlay_cashout_snapshots(2, 1),
   };
   let r = env.run_ix(fill_parlay_cashout_instruction(
      &payload,
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

#[test]
fn fill_parlay_cashout_live_escrow() {
   let mut env = Env::new();
   let mut m1 = market_spread_pregame(event_id_soccer());
   let mut m2 = market_soccer_ft_pregame(event_id_soccer_b());
   m1.is_pregame = false;
   m2.is_pregame = false;
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   env.patch_event_state_sequence(&event_id_soccer(), 2);
   env.patch_event_state_sequence(&event_id_soccer_b(), 2);
   let bet_id = 892u64;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 2, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 2, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   assert!(env
      .run_ix(fill_parlay_instruction(&payload, bet, bat, &[m1, m2]))
      .program_result
      .is_ok());
   let cashout_id = 9892u64;
   let co = cashout_parlay_pda_for(&mm_program_id(), cashout_id);
   let escrow = cashout_escrow_pda_for(&user(), bet_id);
   upsert_cashout_accounts(&mut env, co, escrow);
   let cash = FillParlayCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: 5_000_000,
      min_payout: 1,
      num_legs: 2,
      snapshots: parlay_cashout_snapshots(2, 2),
   };
   let r = env.run_ix(fill_parlay_cashout_instruction(
      &cash,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      escrow,
      bet_token_ata(&escrow),
      &[m1, m2],
   ));
   assert_ok_record_cu("fill_parlay_cashout/live_escrow", &r);
   assert!(env.get_account(&escrow).unwrap().data.len() > 0);
}

#[test]
fn fill_parlay_cashout_full_free_liability() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet_id = 1504u64;
   let stake = 5_000_000u64;
   let (bet, bat) = fill_two_leg(&mut env, m1, m2, bet_id, stake);
   let bd = decode_parlay_bet(&env, &bet);
   let combined = crate::common::uniform_parlay_combined_odds(20_000, 2);
   let expected_c = crate::common::expected_cashout_payment(stake, bd.payout, combined);
   credit_liability_free(&mut env, expected_c);
   env.patch_spl_token_balance(mm_collateral_ata(), 0);
   let cashout_id = 9104u64;
   let co = cashout_parlay_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_enc = read_encumbrance(&env, &encumbrance_pda());
   let pre_u = read_token_balance(&env, &crate::common::user_collateral_ata());
   let payload = FillParlayCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      num_legs: 2,
      snapshots: parlay_cashout_snapshots(2, 1),
   };
   let r = env.run_ix(fill_parlay_cashout_instruction(
      &payload,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &[m1, m2],
   ));
   assert_ok_record_cu("fill_parlay_cashout/full_free_liability", &r);
   assert_eq!(
      read_token_balance(&env, &crate::common::user_collateral_ata()),
      pre_u + expected_c
   );
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      pre_liab - expected_c
   );
   assert_eq!(read_token_balance(&env, &mm_collateral_ata()), pre_mm);
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), pre_enc);
   assert_eq!(mm_parlay_quote_buffer_is_used(&env), 1);
}

#[test]
fn fill_parlay_cashout_partial_free_liability() {
   let (mut env, m1, m2) = two_leg_setup();
   let bet_id = 1505u64;
   let stake = 5_000_000u64;
   let (bet, bat) = fill_two_leg(&mut env, m1, m2, bet_id, stake);
   let bd = decode_parlay_bet(&env, &bet);
   let combined = crate::common::uniform_parlay_combined_odds(20_000, 2);
   let expected_c = crate::common::expected_cashout_payment(stake, bd.payout, combined);
   let amount_from_liability = expected_c / 2;
   let amount_to_send = expected_c - amount_from_liability;
   credit_liability_free(&mut env, amount_from_liability);
   let cashout_id = 9105u64;
   let co = cashout_parlay_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_enc = read_encumbrance(&env, &encumbrance_pda());
   let pre_u = read_token_balance(&env, &crate::common::user_collateral_ata());
   let payload = FillParlayCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      num_legs: 2,
      snapshots: parlay_cashout_snapshots(2, 1),
   };
   let r = env.run_ix(fill_parlay_cashout_instruction(
      &payload,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &[m1, m2],
   ));
   assert_ok_record_cu("fill_parlay_cashout/partial_free_liability", &r);
   assert_eq!(
      read_token_balance(&env, &crate::common::user_collateral_ata()),
      pre_u + expected_c
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
   assert_eq!(mm_parlay_quote_buffer_is_used(&env), 1);
}
