//! Previously untested SpammError paths reachable with the example MM.

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;

use spamm_aggregator::constants::LIVE_CASHOUT_DELAY;
use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::{
   AddLineToLiabilityNettingIxData, FillBetIxData, FillCashoutIxData, FillParlayIxData, FillRfqBetIxData,
   FillRfqCashoutIxData, GRADE_BETS_IX_DISCRIMINATOR, ADD_LINE_TO_LIABILITY_NETTING_IX_LEN,
   REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN, RemoveLineFromLiabilityNettingIxData,
};
use spamm_aggregator::state::account_bet::BetResult;
use spamm_aggregator::state::{EventGameState, FreebetState};

use crate::common::{
   add_line_account_metas, admin, agg_program_id, assert_program_err, assert_spamm_err, bet_pda_for,
   bet_token_ata, bootstrap_issued_freebet, cashout_escrow_placeholder, cashout_pda_for, claim_cashout_escrow_instruction,
   config_pda, decode_bet, decode_cashout, decode_freebet, encumbrance_pda, event_id_soccer,
   expected_cashout_payment, fill_bet_instruction, fill_bet_instruction_mms_for, fill_bet_netting_placeholder,
   FILL_MM_GROUP_OFFSET, fill_cashout_instruction, fill_rfq_bet_instruction, fill_rfq_cashout_instruction,
   freebet_fill_bet_instruction, freebet_fill_parlay_instruction, freebet_fill_rfq_bet_instruction,
   freebet_pda, issue_freebet_instruction, market_spread_pregame, mm_admin, mm_collateral_ata, mm_config_pda,
   mm_program_id, netting_pda_for_event, oracle_body_two_outcome, parlay_bet_pda_for, parlay_leg,
   parlay_legs_fill, read_mm_list_tail, revoke_freebet_instruction, sign_rfq_bet_quote,
   sign_rfq_cashout_quote, settle_bet_instruction, system_owned_empty, upsert_cashout_accounts, user, user_b,
   user_b_collateral_ata, user_collateral_ata, MmKeys, Env, FREEBET_EXPIRY, FREEBET_ID_BASIC, RFQ_OFFER_EXPIRY,
};

fn grade_ix(results: &[u8], bets: &[solana_pubkey::Pubkey]) -> solana_instruction::Instruction {
   let mut metas = vec![
      AccountMeta::new(admin(), true),
      AccountMeta::new_readonly(config_pda(), false),
   ];
   for b in bets {
      metas.push(AccountMeta::new(*b, false));
   }
   let mut buf = vec![GRADE_BETS_IX_DISCRIMINATOR];
   buf.extend_from_slice(results);
   solana_instruction::Instruction::new_with_bytes(agg_program_id(), &buf, metas)
}

fn pause(env: &mut Env) {
   let ix = env.agg_ix(
      1,
      vec![0u8],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   assert!(env.run_ix(ix).program_result.is_ok());
}

fn unpause(env: &mut Env) {
   let ix = env.agg_ix(
      1,
      vec![1u8],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   assert!(env.run_ix(ix).program_result.is_ok());
}

fn open_bet(env: &mut Env, bet_id: u64, amount: u64) -> (solana_pubkey::Pubkey, solana_pubkey::Pubkey) {
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
      .run_ix(fill_bet_instruction(&data, bet, bat, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());
   (bet, bat)
}

#[test]
fn settle_cashed_out_ticket_invalid_cashout() {
   let mut env = Env::new();
   let mut mid = market_spread_pregame(event_id_soccer());
   mid.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.patch_event_state_sequence(&event_id_soccer(), 2);
   let bet_id = 8001u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let fill = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(&fill, bet, bat, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());
   let co = cashout_pda_for(&mm_program_id(), 8001);
   let escrow = crate::common::cashout_escrow_pda_for(&user(), bet_id);
   upsert_cashout_accounts(&mut env, co, escrow);
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id: 8001,
      amount: 5_000_000,
      min_payout: 1,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_cashout_instruction(
         &data,
         bet,
         bat,
         co,
         bet_token_ata(&co),
         escrow,
         bet_token_ata(&escrow),
         &mid,
      ))
      .program_result
      .is_ok());
   assert!(matches!(decode_bet(&env, &bet).result, BetResult::CashedOut));
   let r = env.run_ix(settle_bet_instruction(bet, bat, bet_id));
   assert_spamm_err(&r, SpammError::InvalidCashout);
}

#[test]
fn grade_cashed_out_original_rejects_non_rollback() {
   let mut env = Env::new();
   let mut mid = market_spread_pregame(event_id_soccer());
   mid.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.patch_event_state_sequence(&event_id_soccer(), 2);
   let bet_id = 8002u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let fill = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(&fill, bet, bat, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());
   let co = cashout_pda_for(&mm_program_id(), 8002);
   let escrow = crate::common::cashout_escrow_pda_for(&user(), bet_id);
   upsert_cashout_accounts(&mut env, co, escrow);
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id: 8002,
      amount: 5_000_000,
      min_payout: 1,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_cashout_instruction(
         &data,
         bet,
         bat,
         co,
         bet_token_ata(&co),
         escrow,
         bet_token_ata(&escrow),
         &mid,
      ))
      .program_result
      .is_ok());
   let r = env.run_ix(grade_ix(&[BetResult::Won as u8], &[bet]));
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_cashout_amount_zero_and_over_remaining() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, bat) = open_bet(&mut env, 8003, 5_000_000);
   let mid = market_spread_pregame(event_id_soccer());
   let co = cashout_pda_for(&mm_program_id(), 8003);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let zero = FillCashoutIxData {
      orig_bet_id: 8003,
      cashout_id: 8003,
      amount: 0,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r0 = env.run_ix(fill_cashout_instruction(
      &zero,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_spamm_err(&r0, SpammError::InvalidCashout);
   let over = FillCashoutIxData {
      orig_bet_id: 8003,
      cashout_id: 8004,
      amount: 5_000_001,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let co2 = cashout_pda_for(&mm_program_id(), 8004);
   upsert_cashout_accounts(&mut env, co2, cashout_escrow_placeholder());
   let r1 = env.run_ix(fill_cashout_instruction(
      &over,
      bet,
      bat,
      co2,
      bet_token_ata(&co2),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_spamm_err(&r1, SpammError::InvalidCashout);
}

#[test]
fn freebet_used_cannot_revoke_or_refill() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, 10_000_000, 10_000, 50_000, 1, &[], &[]);
   let mid = market_spread_pregame(event_id_soccer());
   let data = FillBetIxData {
      bet_id: 8010,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let bet = bet_pda_for(&user(), 8010);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   assert!(env
      .run_ix(freebet_fill_bet_instruction(
         FREEBET_ID_BASIC,
         &data,
         bet,
         bat,
         &mid,
         fill_bet_netting_placeholder(),
      ))
      .program_result
      .is_ok());
   assert_eq!(decode_freebet(&env, FREEBET_ID_BASIC).state, FreebetState::Used);
   let rev = env.run_ix(revoke_freebet_instruction(FREEBET_ID_BASIC));
   assert_spamm_err(&rev, SpammError::FreebetNotAvailable);
   let bet2 = bet_pda_for(&user(), 8011);
   let bat2 = bet_token_ata(&bet2);
   env.upsert(bet2, system_owned_empty());
   env.upsert(bat2, system_owned_empty());
   let data2 = FillBetIxData {
      bet_id: 8011,
      ..data
   };
   let r2 = env.run_ix(freebet_fill_bet_instruction(
      FREEBET_ID_BASIC,
      &data2,
      bet2,
      bat2,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert_spamm_err(&r2, SpammError::FreebetNotAvailable);
}

#[test]
fn freebet_parlay_leg_count_boundary() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_spread_pregame(crate::common::event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_two_outcome(20_000, 20_000);
   env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   bootstrap_issued_freebet(&mut env, 802, 5_000_000, 10_000, 200_000, 3, &[], &[]);
   let bet_lo = parlay_bet_pda_for(&user(), 8019);
   let bat_lo = bet_token_ata(&bet_lo);
   env.upsert(bet_lo, system_owned_empty());
   env.upsert(bat_lo, system_owned_empty());
   let payload_lo = FillParlayIxData {
      bet_id: 8019,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[
         parlay_leg(m1, 0, 1, EventGameState::zeroed()),
         parlay_leg(m2, 1, 1, EventGameState::zeroed()),
      ]),
   };
   let r_lo = env.run_ix(freebet_fill_parlay_instruction(
      802,
      &payload_lo,
      bet_lo,
      bat_lo,
      &[m1, m2],
   ));
   assert_spamm_err(&r_lo, SpammError::FreebetLegCount);
   env.upsert(freebet_pda(FREEBET_ID_BASIC), system_owned_empty());
   assert!(env
      .run_ix(issue_freebet_instruction(
         FREEBET_ID_BASIC,
         FREEBET_EXPIRY,
         5_000_000,
         10_000,
         200_000,
         2,
         &[],
         &[],
      ))
      .program_result
      .is_ok());
   let bet = parlay_bet_pda_for(&user(), 8020);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let payload1 = FillParlayIxData {
      bet_id: 8020,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, parlay_leg(m2, 1, 1, EventGameState::zeroed())]),
   };
   assert!(env
      .run_ix(freebet_fill_parlay_instruction(
         FREEBET_ID_BASIC,
         &payload1,
         bet,
         bat,
         &[m1, m2],
      ))
      .program_result
      .is_ok());
}

#[test]
fn freebet_parlay_mm_not_allowed() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let m2 = market_spread_pregame(crate::common::event_id_soccer_b());
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_two_outcome(20_000, 20_000);
   env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   let other = solana_pubkey::Pubkey::new_from_array([0x11; 32]);
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, 5_000_000, 10_000, 200_000, 2, &[other], &[]);
   let bet = parlay_bet_pda_for(&user(), 8021);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let payload = FillParlayIxData {
      bet_id: 8021,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[
         parlay_leg(m1, 0, 1, EventGameState::zeroed()),
         parlay_leg(m2, 1, 1, EventGameState::zeroed()),
      ]),
   };
   let r = env.run_ix(freebet_fill_parlay_instruction(
      FREEBET_ID_BASIC,
      &payload,
      bet,
      bat,
      &[m1, m2],
   ));
   assert_spamm_err(&r, SpammError::FreebetMmNotAllowed);
}

#[test]
fn freebet_odds_out_of_range_rfq_and_auction_skip() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, 10_000_000, 30_000, 40_000, 1, &[], &[]);
   let mid = market_spread_pregame(event_id_soccer());
   let data = FillBetIxData {
      bet_id: 8022,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let bet = bet_pda_for(&user(), 8022);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let skip = env.run_ix(freebet_fill_bet_instruction(
      FREEBET_ID_BASIC,
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert_spamm_err(&skip, SpammError::NoQuotesAvailable);
   let sig = sign_rfq_bet_quote(
      &user(),
      8023,
      &mid,
      &EventGameState::zeroed(),
      1,
      0,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   let bet2 = bet_pda_for(&user(), 8023);
   let bat2 = bet_token_ata(&bet2);
   env.upsert(bet2, system_owned_empty());
   env.upsert(bat2, system_owned_empty());
   let rfq = FillRfqBetIxData {
      bet_id: 8023,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
      max_stake: 50_000_000,
      odds_scaled: 20_000,
      offer_expiry: RFQ_OFFER_EXPIRY,
   };
   let r = env.run_ix(freebet_fill_rfq_bet_instruction(
      FREEBET_ID_BASIC,
      &rfq,
      &sig,
      bet2,
      bat2,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert_spamm_err(&r, SpammError::FreebetOddsOutOfRange);
}

#[test]
fn fill_rfq_cashout_expiry_boundary() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, bat) = open_bet(&mut env, 8030, 10_000_000);
   let mid = market_spread_pregame(event_id_soccer());
   let bd = decode_bet(&env, &bet);
   let max_payment = expected_cashout_payment(10_000_000, bd.payout, 20_000);
   let gs = EventGameState::zeroed();
   env.set_clock_unix_timestamp(10);
   let sig_ok = sign_rfq_cashout_quote(&user(), 8030, 9301, 10_000_000, max_payment, 10, 1, &gs);
   let co = cashout_pda_for(&mm_program_id(), 9301);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let ok = FillRfqCashoutIxData {
      orig_bet_id: 8030,
      cashout_id: 9301,
      amount: 10_000_000,
      min_payout: 1,
      max_payment,
      offer_expiry: 10,
      event_state_sequence: 1,
      event_game_state: gs,
   };
   let r_ok = env.run_ix(fill_rfq_cashout_instruction(
      &ok,
      &sig_ok,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert!(r_ok.program_result.is_ok(), "{:?}", r_ok);

   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, bat) = open_bet(&mut env, 8031, 10_000_000);
   let bd = decode_bet(&env, &bet);
   let max_payment = expected_cashout_payment(10_000_000, bd.payout, 20_000);
   env.set_clock_unix_timestamp(10);
   let sig = sign_rfq_cashout_quote(&user(), 8031, 9302, 10_000_000, max_payment, 9, 1, &gs);
   let co = cashout_pda_for(&mm_program_id(), 9302);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let bad = FillRfqCashoutIxData {
      orig_bet_id: 8031,
      cashout_id: 9302,
      amount: 10_000_000,
      min_payout: 1,
      max_payment,
      offer_expiry: 9,
      event_state_sequence: 1,
      event_game_state: gs,
   };
   let r = env.run_ix(fill_rfq_cashout_instruction(
      &bad,
      &sig,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_spamm_err(&r, SpammError::QuoteExpired);
}

#[test]
fn fill_rfq_bet_mm_not_registered() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let sig = sign_rfq_bet_quote(
      &user(),
      8040,
      &mid,
      &EventGameState::zeroed(),
      1,
      0,
      50_000_000,
      20_000,
      RFQ_OFFER_EXPIRY,
   );
   let bet = bet_pda_for(&user(), 8040);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillRfqBetIxData {
      bet_id: 8040,
      market_id: mid,
      side: 0,
      amount: 1_000_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
      max_stake: 50_000_000,
      odds_scaled: 20_000,
      offer_expiry: RFQ_OFFER_EXPIRY,
   };
   let mut ix = fill_rfq_bet_instruction(
      &data,
      &sig,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   );
   let bad = solana_pubkey::Pubkey::new_unique();
   env.upsert(bad, system_owned_empty());
   ix.accounts[FILL_MM_GROUP_OFFSET + 1] = AccountMeta::new(bad, false);
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::MmNotRegistered);
}

#[test]
fn cashout_odds_drift_and_no_quotes() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, bat) = open_bet(&mut env, 8050, 10_000_000);
   let mid = market_spread_pregame(event_id_soccer());
   let keys = MmKeys::default_mm();
   env.patch_market_odds(&keys, &mid, &oracle_body_two_outcome(40_000, 10_000));
   let co = cashout_pda_for(&mm_program_id(), 8050);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let data = FillCashoutIxData {
      orig_bet_id: 8050,
      cashout_id: 8050,
      amount: 10_000_000,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let orig_payout = decode_bet(&env, &bet).payout;
   let r = env.run_ix(fill_cashout_instruction(
      &data,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert!(r.program_result.is_ok(), "{:?}", r);
   let c = decode_cashout(&env, &co);
   let fair_high = expected_cashout_payment(10_000_000, orig_payout.max(c.payout), 40_000);
   assert!(c.amount > 0);
   let _ = fair_high;

   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, bat) = open_bet(&mut env, 8051, 10_000_000);
   env.patch_market_odds(&keys, &mid, &oracle_body_two_outcome(1_000_000, 10_000));
   let co = cashout_pda_for(&mm_program_id(), 8051);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let snap = env.snapshot_accounts(&[bet, user_collateral_ata()]);
   let high_min = FillCashoutIxData {
      orig_bet_id: 8051,
      cashout_id: 8051,
      amount: 10_000_000,
      min_payout: u64::MAX / 2,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_cashout_instruction(
      &high_min,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_spamm_err(&r, SpammError::NoQuotesAvailable);
   env.assert_accounts_unchanged(&snap);
}

#[test]
fn pause_blocks_fill_cashout_withdraw_grade_and_settle() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, bat) = open_bet(&mut env, 8060, 2_000_000);
   pause(&mut env);
   let mid = market_spread_pregame(event_id_soccer());
   let fill = FillBetIxData {
      bet_id: 8061,
      market_id: mid,
      side: 0,
      amount: 1_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let b2 = bet_pda_for(&user(), 8061);
   let a2 = bet_token_ata(&b2);
   env.upsert(b2, system_owned_empty());
   env.upsert(a2, system_owned_empty());
   assert_spamm_err(
      &env.run_ix(fill_bet_instruction(&fill, b2, a2, &mid, fill_bet_netting_placeholder())),
      SpammError::ProgramPaused,
   );
   let co = cashout_pda_for(&mm_program_id(), 8060);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let cash = FillCashoutIxData {
      orig_bet_id: 8060,
      cashout_id: 8060,
      amount: 2_000_000,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   assert_spamm_err(
      &env.run_ix(fill_cashout_instruction(
         &cash,
         bet,
         bat,
         co,
         bet_token_ata(&co),
         cashout_escrow_placeholder(),
         cashout_escrow_placeholder(),
         &mid,
      )),
      SpammError::ProgramPaused,
   );
   let mut wd = Vec::new();
   wd.extend_from_slice(&1u64.to_le_bytes());
   let wix = env.agg_ix(
      50,
      wd,
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(mm_config_pda(), false),
         AccountMeta::new(encumbrance_pda(), false),
         AccountMeta::new(crate::common::liability_token_ata(), false),
         AccountMeta::new(mm_collateral_ata(), false),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new_readonly(crate::common::mint_pubkey(), false),
         AccountMeta::new_readonly(mollusk_svm_programs_token::token::ID, false),
      ],
   );
   assert_spamm_err(&env.run_ix(wix), SpammError::ProgramPaused);
   assert_spamm_err(&env.run_ix(grade_ix(&[BetResult::Won as u8], &[bet])), SpammError::ProgramPaused);
   unpause(&mut env);
   assert!(env
      .run_ix(fill_bet_instruction(&fill, b2, a2, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());
}

#[test]
fn claim_cashout_escrow_at_exact_delay() {
   let mut env = Env::new();
   let mut mid = market_spread_pregame(event_id_soccer());
   mid.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.patch_event_state_sequence(&event_id_soccer(), 2);
   let bet_id = 8070u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let fill = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: 4_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(&fill, bet, bat, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());
   let co = cashout_pda_for(&mm_program_id(), 8070);
   let escrow = crate::common::cashout_escrow_pda_for(&user(), bet_id);
   upsert_cashout_accounts(&mut env, co, escrow);
   env.set_clock_unix_timestamp(1_000);
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id: 8070,
      amount: 4_000_000,
      min_payout: 1,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_cashout_instruction(
         &data,
         bet,
         bat,
         co,
         bet_token_ata(&co),
         escrow,
         bet_token_ata(&escrow),
         &mid,
      ))
      .program_result
      .is_ok());
   env.set_clock_unix_timestamp((1_000 + LIVE_CASHOUT_DELAY as i64) - 1);
   let early = env.run_ix(claim_cashout_escrow_instruction(
      escrow,
      bet_token_ata(&escrow),
      bet,
      bat,
      co,
   ));
   assert_spamm_err(&early, SpammError::CashoutDelayNotElapsed);
   env.set_clock_unix_timestamp(1_000 + LIVE_CASHOUT_DELAY as i64);
   let ok = env.run_ix(claim_cashout_escrow_instruction(
      escrow,
      bet_token_ata(&escrow),
      bet,
      bat,
      co,
   ));
   assert!(ok.program_result.is_ok(), "{:?}", ok);
}

#[test]
fn two_user_netting_lifecycle_close() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let add = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 400,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   assert!(env.run_ix(env.agg_ix(41, w.to_vec(), add_line_account_metas(np))).program_result.is_ok());
   let mid = market_spread_pregame(event_id_soccer());
   let def = MmKeys::default_mm();
   let a_bet = bet_pda_for(&user(), 8080);
   let a_ata = bet_token_ata(&a_bet);
   env.upsert(a_bet, system_owned_empty());
   env.upsert(a_ata, system_owned_empty());
   let alice = FillBetIxData {
      bet_id: 8080,
      market_id: mid,
      side: 0,
      amount: 3_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction_mms_for(
         user(),
         user_collateral_ata(),
         &alice,
         a_bet,
         a_ata,
         &[(&def, np)],
         &mid,
      ))
      .program_result
      .is_ok());
   let b_bet = bet_pda_for(&user_b(), 8081);
   let b_ata = bet_token_ata(&b_bet);
   env.upsert(b_bet, system_owned_empty());
   env.upsert(b_ata, system_owned_empty());
   let bob = FillBetIxData {
      bet_id: 8081,
      market_id: mid,
      side: 1,
      amount: 3_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction_mms_for(
         user_b(),
         user_b_collateral_ata(),
         &bob,
         b_bet,
         b_ata,
         &[(&def, np)],
         &mid,
      ))
      .program_result
      .is_ok());
   let mut wd = Vec::new();
   wd.extend_from_slice(&1u64.to_le_bytes());
   let wix = env.agg_ix(
      50,
      wd,
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(mm_config_pda(), false),
         AccountMeta::new(encumbrance_pda(), false),
         AccountMeta::new(crate::common::liability_token_ata(), false),
         AccountMeta::new(mm_collateral_ata(), false),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new_readonly(crate::common::mint_pubkey(), false),
         AccountMeta::new_readonly(mollusk_svm_programs_token::token::ID, false),
      ],
   );
   assert!(env.run_ix(wix).program_result.is_err());
   assert!(env.run_ix(grade_ix(&[BetResult::Won as u8], &[a_bet])).program_result.is_ok());
   assert!(env.run_ix(grade_ix(&[BetResult::Lost as u8], &[b_bet])).program_result.is_ok());
   assert!(env
      .run_ix(crate::common::settle_bet_instruction_with_netting(a_bet, a_ata, 8080, np))
      .program_result
      .is_ok());
   assert!(env
      .run_ix(crate::common::settle_bet_instruction_mms(
         user_b(),
         user_b_collateral_ata(),
         b_bet,
         b_ata,
         8081,
         &[(&def, np)],
      ))
      .program_result
      .is_ok());
   let rem = RemoveLineFromLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 400,
   };
   let mut rw = [0u8; REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN];
   rem.write_wire(&mut rw).unwrap();
   assert!(env
      .run_ix(env.agg_ix(
         42,
         rw.to_vec(),
         vec![
            AccountMeta::new(mm_admin(), true),
            AccountMeta::new_readonly(mm_program_id(), false),
            AccountMeta::new_readonly(mm_config_pda(), false),
            AccountMeta::new(np, false),
         ],
      ))
      .program_result
      .is_ok());
   let close = env.agg_ix(
      43,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(mollusk_svm::program::keyed_account_for_system_program().0, false),
      ],
   );
   assert!(env.run_ix(close).program_result.is_ok(), "close netting");
   let _ = read_mm_list_tail(&env, &crate::common::mm_list_pda());
}

#[test]
fn get_cashout_quote_proxy_non_open_ticket() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, _) = open_bet(&mut env, 8090, 2_000_000);
   assert!(env.run_ix(grade_ix(&[BetResult::Won as u8], &[bet])).program_result.is_ok());
   let mid = market_spread_pregame(event_id_soccer());
   let data = FillCashoutIxData {
      orig_bet_id: 8090,
      cashout_id: 0,
      amount: 2_000_000,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(crate::common::get_cashout_quote_proxy_instruction(&data, bet, &mid));
   assert_spamm_err(&r, SpammError::InvalidCashout);
}
