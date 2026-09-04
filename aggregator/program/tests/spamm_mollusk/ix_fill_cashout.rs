//! `fill_cashout` Mollusk coverage.
//!
//! Requires a rebuilt MM SBF with cashout CPIs (discs 140–141).

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::{FillBetIxData, FillCashoutIxData, FILL_CASHOUT_IX_DISCRIMINATOR};
use spamm_aggregator::state::account_bet::BetResult;
use spamm_aggregator::state::EventGameState;

use crate::common::{
   agg_program_id, assert_account_closed_or_system_empty, assert_ok_record_cu, assert_program_err, assert_spamm_err,
   bet_pda_for, bet_token_ata, cashout_escrow_placeholder, cashout_pda_for, credit_liability_free, decode_bet, decode_cashout,
   encumbrance_pda, expected_cashout_payment, event_id_soccer, fill_bet_instruction, fill_bet_netting_placeholder,
   fill_cashout_instruction, fill_cashout_metas_one_mm, liability_token_ata, market_spread_pregame, mm_collateral_ata,
   mm_program_id, mm_quote_buffer_is_used, oracle_body_two_outcome, read_encumbrance, read_token_balance, system_owned_empty, upsert_cashout_accounts,
   user, user_collateral_ata, Env, FILL_CASHOUT_MM_ACCOUNTS, FILL_CASHOUT_MM_GROUP_OFFSET,
};

fn fill_open_bet(env: &mut Env, bet_id: u64, amount: u64) -> (Pubkey, Pubkey, spamm_aggregator::state::MarketId) {
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
   let r = env.run_ix(fill_bet_instruction(
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert!(r.program_result.is_ok(), "fill_bet prelude {:?}", r);
   (bet, bat, mid)
}

#[test]
fn fill_cashout_pregame_full_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1401u64;
   let stake = 10_000_000u64;
   let (bet, bat, mid) = fill_open_bet(&mut env, bet_id, stake);
   let bd = decode_bet(&env, &bet);
   let cashout_id = 9001u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let co_ata = bet_token_ata(&co);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let expected_c = expected_cashout_payment(stake, bd.payout, 20_000);
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_cashout_instruction(
      &data,
      bet,
      bat,
      co,
      co_ata,
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_ok_record_cu("fill_cashout/pregame_full", &r);
   assert_account_closed_or_system_empty(&env, &bet);
   let co_d = decode_cashout(&env, &co);
   assert_eq!(co_d.amount, stake);
   assert_eq!(co_d.orig_owner.as_ref(), user().as_ref());
   assert!(matches!(co_d.result, BetResult::Pending));
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u + expected_c
   );
   assert_eq!(read_token_balance(&env, &liability_token_ata()), pre_liab);
   assert_eq!(
      read_token_balance(&env, &mm_collateral_ata()),
      pre_mm - expected_c
   );
   assert_eq!(mm_quote_buffer_is_used(&env), 1);
}

#[test]
fn fill_cashout_pregame_partial_remaining_pending() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1402u64;
   let stake = 10_000_000u64;
   let cash_amt = 4_000_000u64;
   let (bet, bat, mid) = fill_open_bet(&mut env, bet_id, stake);
   let cashout_id = 9002u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let co_ata = bet_token_ata(&co);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: cash_amt,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_cashout_instruction(
      &data,
      bet,
      bat,
      co,
      co_ata,
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert_ok_record_cu("fill_cashout/pregame_partial", &r);
   let rem = decode_bet(&env, &bet);
   assert!(matches!(rem.result, BetResult::Pending));
   assert_eq!(rem.amount, stake - cash_amt);
   let co_d = decode_cashout(&env, &co);
   assert_eq!(co_d.amount, cash_amt);
}

#[test]
fn fill_cashout_live_full_escrow_cashed_out() {
   let mut env = Env::new();
   let mut mid = market_spread_pregame(event_id_soccer());
   mid.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.patch_event_state_sequence(&event_id_soccer(), 2);

   let bet_id = 1403u64;
   let stake = 5_000_000u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let fill = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: stake,
      min_odds_scaled: 15_000,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(
         &fill,
         bet,
         bat,
         &mid,
         fill_bet_netting_placeholder(),
      ))
      .program_result
      .is_ok());

   let cashout_id = 9003u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let escrow = crate::common::cashout_escrow_pda_for(&user(), bet_id);
   upsert_cashout_accounts(&mut env, co, escrow);
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_cashout_instruction(
      &data,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      escrow,
      bet_token_ata(&escrow),
      &mid,
   ));
   assert_ok_record_cu("fill_cashout/live_full_escrow", &r);
   let rem = decode_bet(&env, &bet);
   assert!(matches!(rem.result, BetResult::CashedOut));
   assert_eq!(rem.amount, 0, "delayed full cashout must zero remaining stake");
   assert!(env.get_account(&escrow).unwrap().data.len() > 0);
}

#[test]
fn fill_cashout_live_prefunded_escrow_dust_fails() {
   let mut env = Env::new();
   let mut mid = market_spread_pregame(event_id_soccer());
   mid.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.patch_event_state_sequence(&event_id_soccer(), 2);

   let bet_id = 1410u64;
   let stake = 5_000_000u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let fill = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: stake,
      min_odds_scaled: 15_000,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(
         &fill,
         bet,
         bat,
         &mid,
         fill_bet_netting_placeholder(),
      ))
      .program_result
      .is_ok());

   let cashout_id = 9010u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let escrow = crate::common::cashout_escrow_pda_for(&user(), bet_id);
   upsert_cashout_accounts(&mut env, co, escrow);
   env.upsert(
      escrow,
      solana_account::Account {
         lamports: 1,
         data: vec![],
         owner: solana_sdk_ids::system_program::ID,
         executable: false,
         rent_epoch: 0,
      },
   );
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_cashout_instruction(
      &data,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      escrow,
      bet_token_ata(&escrow),
      &mid,
   ));
   assert!(r.program_result.is_err(), "1-lamport escrow PDA bricks CreateAccount");
}

#[test]
fn fill_cashout_quoted_sequence_below_ticket_rejected() {
   let mut env = Env::new();
   let mut mid = market_spread_pregame(event_id_soccer());
   mid.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.patch_event_state_sequence(&event_id_soccer(), 2);

   let bet_id = 1411u64;
   let stake = 5_000_000u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let fill = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: stake,
      min_odds_scaled: 15_000,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(
         &fill,
         bet,
         bat,
         &mid,
         fill_bet_netting_placeholder(),
      ))
      .program_result
      .is_ok());

   env.patch_event_state_sequence(&event_id_soccer(), 1);
   let cashout_id = 9011u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
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
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_cashout_no_quotes_min_payout_too_high() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1404u64;
   let (bet, bat, mid) = fill_open_bet(&mut env, bet_id, 10_000_000);
   let cashout_id = 9004u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let bd = decode_bet(&env, &bet);
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: 10_000_000,
      // Must be ≤ orig.payout (else InvalidCashout); above any fair C (capped at payout−1).
      min_payout: bd.payout,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
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
   assert_spamm_err(&r, SpammError::NoQuotesAvailable);
}

#[test]
fn fill_cashout_mm_accounts_not_multiple_of_eight() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1405u64;
   let (bet, bat, mid) = fill_open_bet(&mut env, bet_id, 1_000_000);
   let cashout_id = 9005u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: 1_000_000,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut metas = fill_cashout_metas_one_mm(
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   );
   metas.truncate(FILL_CASHOUT_MM_GROUP_OFFSET + FILL_CASHOUT_MM_ACCOUNTS - 1);
   let mut buf = vec![FILL_CASHOUT_IX_DISCRIMINATOR];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_CASHOUT_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let ix = solana_instruction::Instruction::new_with_bytes(
      crate::common::agg_program_id(),
      &buf,
      metas,
   );
   let r = env.run_ix(ix);
   assert!(r.program_result.is_err());
}

#[test]
fn fill_cashout_skips_unregistered_mm() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 887u64;
   let (bet, bat, mid) = fill_open_bet(&mut env, bet_id, 2_000_000);
   let cashout_id = 9887u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let payload = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: 2_000_000,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut metas = fill_cashout_metas_one_mm(
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   );
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let dead: Vec<AccountMeta> = (0..FILL_CASHOUT_MM_ACCOUNTS)
      .map(|_| AccountMeta::new_readonly(sys, false))
      .collect();
   metas.splice(FILL_CASHOUT_MM_GROUP_OFFSET..FILL_CASHOUT_MM_GROUP_OFFSET, dead);
   let mut buf = vec![FILL_CASHOUT_IX_DISCRIMINATOR];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_CASHOUT_IX_DATA_LEN];
   payload.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let r = env.run_ix(solana_instruction::Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      metas,
   ));
   assert!(r.program_result.is_ok(), "dead MM skipped: {:?}", r);
}

#[test]
fn fill_cashout_unpaid_when_mm_ata_empty() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 888u64;
   let (bet, bat, mid) = fill_open_bet(&mut env, bet_id, 2_000_000);
   env.patch_spl_token_balance(mm_collateral_ata(), 0);
   let cashout_id = 9888u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let payload = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: 2_000_000,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_cashout_instruction(
      &payload,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      cashout_escrow_placeholder(),
      cashout_escrow_placeholder(),
      &mid,
   ));
   assert!(r.program_result.is_err(), "unpaid cashout must fail: {:?}", r);
}

#[test]
fn fill_cashout_full_free_liability_amount_to_send_zero() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1410u64;
   let stake = 10_000_000u64;
   let (bet, bat, mid) = fill_open_bet(&mut env, bet_id, stake);
   let bd = decode_bet(&env, &bet);
   let expected_c = expected_cashout_payment(stake, bd.payout, 20_000);
   credit_liability_free(&mut env, expected_c);
   env.patch_spl_token_balance(mm_collateral_ata(), 0);
   let cashout_id = 9010u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_enc = read_encumbrance(&env, &encumbrance_pda());
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
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
   assert_ok_record_cu("fill_cashout/full_free_liability", &r);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
      pre_u + expected_c
   );
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      pre_liab - expected_c
   );
   assert_eq!(read_token_balance(&env, &mm_collateral_ata()), pre_mm);
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), pre_enc);
   assert_eq!(mm_quote_buffer_is_used(&env), 1);
}

#[test]
fn fill_cashout_partial_free_liability() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1411u64;
   let stake = 10_000_000u64;
   let (bet, bat, mid) = fill_open_bet(&mut env, bet_id, stake);
   let bd = decode_bet(&env, &bet);
   let expected_c = expected_cashout_payment(stake, bd.payout, 20_000);
   let amount_from_liability = expected_c / 2;
   let amount_to_send = expected_c - amount_from_liability;
   credit_liability_free(&mut env, amount_from_liability);
   let cashout_id = 9011u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   upsert_cashout_accounts(&mut env, co, cashout_escrow_placeholder());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let pre_enc = read_encumbrance(&env, &encumbrance_pda());
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
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
   assert_ok_record_cu("fill_cashout/partial_free_liability", &r);
   assert_eq!(
      read_token_balance(&env, &user_collateral_ata()),
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
   assert_eq!(mm_quote_buffer_is_used(&env), 1);
}

#[test]
fn fill_cashout_live_partial_free_escrow_dest() {
   let mut env = Env::new();
   let mut mid = market_spread_pregame(event_id_soccer());
   mid.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.patch_event_state_sequence(&event_id_soccer(), 2);

   let bet_id = 1412u64;
   let stake = 5_000_000u64;
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let fill = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: stake,
      min_odds_scaled: 15_000,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(
         &fill,
         bet,
         bat,
         &mid,
         fill_bet_netting_placeholder(),
      ))
      .program_result
      .is_ok());
   let bd = decode_bet(&env, &bet);
   let expected_c = expected_cashout_payment(stake, bd.payout, 20_000);
   let amount_from_liability = expected_c / 2;
   let amount_to_send = expected_c - amount_from_liability;
   credit_liability_free(&mut env, amount_from_liability);

   let cashout_id = 9012u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let escrow = crate::common::cashout_escrow_pda_for(&user(), bet_id);
   let escrow_ata = bet_token_ata(&escrow);
   upsert_cashout_accounts(&mut env, co, escrow);
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_cashout_instruction(
      &data,
      bet,
      bat,
      co,
      bet_token_ata(&co),
      escrow,
      escrow_ata,
      &mid,
   ));
   assert_ok_record_cu("fill_cashout/live_partial_free", &r);
   assert_eq!(read_token_balance(&env, &escrow_ata), expected_c);
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      pre_liab - amount_from_liability
   );
   assert_eq!(
      read_token_balance(&env, &mm_collateral_ata()),
      pre_mm - amount_to_send
   );
}

#[test]
fn split_fillers_redistributes_last_slot_and_conserves_reserved() {
   use core::mem::MaybeUninit;
   use pinocchio::Address;
   use spamm_aggregator::constants::MAX_NUMBER_OF_MMS;
   use spamm_aggregator::helpers::split_fillers;
   use spamm_aggregator::state::account_bet::BetFiller;

   let mm = Address::new_from_array([7u8; 32]);
   let amounts = [25u64, 25, 25, 25, 1];
   let orig_amount: u64 = 101;
   let cashout: u64 = 100;
   let mut orig = [BetFiller {
      mm_address: mm,
      amount: 0,
      reserved_profit: 0,
      odds_scaled: 13_000,
      is_potentially_netted: false,
   }; MAX_NUMBER_OF_MMS];
   let mut reserved_sum = 0u64;
   for i in 0..5 {
      let p = spamm_aggregator::helpers::calc_potential_profit(amounts[i], 13_000).unwrap();
      orig[i].amount = amounts[i];
      orig[i].reserved_profit = p;
      reserved_sum += p;
   }
   let mut remaining = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let mut cashed = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let payout = split_fillers(&orig, 5, orig_amount, cashout, &mut remaining, &mut cashed)
      .expect("split_fillers");
   assert!(payout > 0);
   let rem = unsafe { core::slice::from_raw_parts(remaining.as_ptr().cast::<BetFiller>(), 5) };
   let cas = unsafe { core::slice::from_raw_parts(cashed.as_ptr().cast::<BetFiller>(), 5) };
   assert_eq!(cas.iter().map(|f| f.amount).sum::<u64>(), cashout);
   assert_eq!(rem.iter().map(|f| f.amount).sum::<u64>(), orig_amount - cashout);
   assert_eq!(
      rem.iter().map(|f| f.reserved_profit).sum::<u64>()
         + cas.iter().map(|f| f.reserved_profit).sum::<u64>(),
      reserved_sum
   );
   assert!(cas[4].amount <= 1);
}
