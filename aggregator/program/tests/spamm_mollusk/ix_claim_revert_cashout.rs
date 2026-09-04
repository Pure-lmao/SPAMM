//! `claim_cashout_escrow` + `revert_cashout` Mollusk coverage.
//! Also: cashout → grade_bets → settle_bet pays the filling MM.

use solana_instruction::{AccountMeta, Instruction};

use spamm_aggregator::constants::LIVE_CASHOUT_DELAY;
use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::{
   FillBetIxData, FillCashoutIxData, GRADE_BETS_IX_DISCRIMINATOR,
};
use spamm_aggregator::state::account_bet::BetResult;
use spamm_aggregator::state::EventGameState;

use crate::common::{
   admin, agg_program_id, assert_account_closed_or_system_empty, assert_ok_record_cu,
   assert_spamm_err, bet_pda_for, bet_token_ata, cashout_escrow_pda_for, cashout_pda_for,
   claim_cashout_escrow_instruction, config_pda, decode_bet,
   event_id_soccer, fill_bet_instruction, fill_bet_netting_placeholder, fill_cashout_instruction,
   liability_token_ata, market_spread_pregame, mm_collateral_ata, mm_program_id, oracle_body_two_outcome,
   read_token_balance, revert_cashout_instruction, settle_cashout_instruction, system_owned_empty,
   upsert_cashout_accounts, user, Env,
};

fn fill_live_full_cashout(env: &mut Env, bet_id: u64, cashout_id: u64, stake: u64) {
   let mut mid = market_spread_pregame(event_id_soccer());
   mid.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.patch_event_state_sequence(&event_id_soccer(), 2);

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

   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let escrow = cashout_escrow_pda_for(&user(), bet_id);
   upsert_cashout_accounts(env, co, escrow);
   env.set_clock_unix_timestamp(1_000);
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
   assert!(r.program_result.is_ok(), "fill_cashout live {:?}", r);
   let after = decode_bet(env, &bet);
   assert!(matches!(after.result, BetResult::CashedOut));
   assert_eq!(after.amount, 0, "delayed full cashout must zero remaining stake");
}

fn grade_cashout(env: &mut Env, cashout_pda: solana_pubkey::Pubkey, result: u8) {
   let metas = vec![
      AccountMeta::new(admin(), true),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new(cashout_pda, false),
   ];
   let mut buf = vec![GRADE_BETS_IX_DISCRIMINATOR];
   buf.push(result);
   let ix = Instruction::new_with_bytes(agg_program_id(), &buf, metas);
   assert!(env.run_ix(ix).program_result.is_ok(), "grade cashout");
}

#[test]
fn claim_cashout_escrow_after_delay_closes_original() {
   let mut env = Env::new();
   let bet_id = 1801u64;
   let cashout_id = 9401u64;
   fill_live_full_cashout(&mut env, bet_id, cashout_id, 4_000_000);
   let bet = bet_pda_for(&user(), bet_id);
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let escrow = cashout_escrow_pda_for(&user(), bet_id);
   env.set_clock_unix_timestamp((1_000 + LIVE_CASHOUT_DELAY + 1) as i64);
   let bat = bet_token_ata(&bet);
   let r = env.run_ix(claim_cashout_escrow_instruction(
      escrow,
      bet_token_ata(&escrow),
      bet,
      bat,
      co,
   ));
   assert_ok_record_cu("claim_cashout_escrow/after_delay", &r);
   assert_account_closed_or_system_empty(&env, &escrow);
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &bat);
}

#[test]
fn claim_cashout_escrow_delay_not_elapsed() {
   let mut env = Env::new();
   let bet_id = 1802u64;
   let cashout_id = 9402u64;
   fill_live_full_cashout(&mut env, bet_id, cashout_id, 4_000_000);
   let bet = bet_pda_for(&user(), bet_id);
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let escrow = cashout_escrow_pda_for(&user(), bet_id);
   // Timestamp on escrow was ~1000; leave clock at 1000 → delay not elapsed.
   env.set_clock_unix_timestamp(1_000);
   let r = env.run_ix(claim_cashout_escrow_instruction(
      escrow,
      bet_token_ata(&escrow),
      bet,
      bet_token_ata(&bet),
      co,
   ));
   assert_spamm_err(&r, SpammError::CashoutDelayNotElapsed);
}

#[test]
fn claim_blocked_when_rolled_back_then_revert_restores() {
   let mut env = Env::new();
   let bet_id = 1803u64;
   let cashout_id = 9403u64;
   let stake = 4_000_000u64;
   fill_live_full_cashout(&mut env, bet_id, cashout_id, stake);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let co_ata = bet_token_ata(&co);
   let escrow = cashout_escrow_pda_for(&user(), bet_id);
   let escrow_ata = bet_token_ata(&escrow);

   grade_cashout(&mut env, co, BetResult::RolledBack as u8);
   env.set_clock_unix_timestamp((1_000 + LIVE_CASHOUT_DELAY + 1) as i64);
   let claim = env.run_ix(claim_cashout_escrow_instruction(escrow, escrow_ata, bet, bat, co));
   assert_spamm_err(&claim, SpammError::CashoutMustRevert);

   let escrowed = read_token_balance(&env, &escrow_ata);
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let pre_mm = read_token_balance(&env, &mm_collateral_ata());
   let r = env.run_ix(revert_cashout_instruction(bet, bat, co, co_ata, escrow, escrow_ata));
   assert_ok_record_cu("revert_cashout/rolled_back", &r);
   let rem = decode_bet(&env, &bet);
   assert!(matches!(rem.result, BetResult::Pending));
   assert_eq!(rem.amount, stake);
   assert_account_closed_or_system_empty(&env, &co);
   assert_account_closed_or_system_empty(&env, &escrow);
   assert_eq!(
      read_token_balance(&env, &liability_token_ata()),
      pre_liab + escrowed
   );
   assert_eq!(read_token_balance(&env, &mm_collateral_ata()), pre_mm);
}

#[test]
fn revert_full_delay_after_orig_rolled_back_restores_once() {
   let mut env = Env::new();
   let bet_id = 1805u64;
   let cashout_id = 9405u64;
   let stake = 4_000_000u64;
   fill_live_full_cashout(&mut env, bet_id, cashout_id, stake);
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let co_ata = bet_token_ata(&co);
   let escrow = cashout_escrow_pda_for(&user(), bet_id);
   let escrow_ata = bet_token_ata(&escrow);

   let metas = vec![
      AccountMeta::new(admin(), true),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new(bet, false),
   ];
   let buf = vec![GRADE_BETS_IX_DISCRIMINATOR, BetResult::RolledBack as u8];
   let ix = Instruction::new_with_bytes(agg_program_id(), &buf, metas);
   assert!(env.run_ix(ix).program_result.is_ok(), "grade orig RolledBack");

   let r = env.run_ix(revert_cashout_instruction(bet, bat, co, co_ata, escrow, escrow_ata));
   assert_ok_record_cu("revert_cashout/orig_rolled_back", &r);
   let rem = decode_bet(&env, &bet);
   assert!(matches!(rem.result, BetResult::RolledBack));
   assert_eq!(rem.amount, stake);
}

#[test]
fn cashout_grade_settle_pays_filling_mm() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bet_id = 1804u64;
   let stake = 6_000_000u64;
   let mid = market_spread_pregame(event_id_soccer());
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
      event_state_sequence: 1,
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

   let cashout_id = 9404u64;
   let co = cashout_pda_for(&mm_program_id(), cashout_id);
   let co_ata = bet_token_ata(&co);
   upsert_cashout_accounts(&mut env, co, crate::common::cashout_escrow_placeholder());
   let data = FillCashoutIxData {
      orig_bet_id: bet_id,
      cashout_id,
      amount: stake,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_cashout_instruction(
         &data,
         bet,
         bat,
         co,
         co_ata,
         crate::common::cashout_escrow_placeholder(),
         crate::common::cashout_escrow_placeholder(),
         &mid,
      ))
      .program_result
      .is_ok());

   grade_cashout(&mut env, co, BetResult::Won as u8);
   let pre_liab = read_token_balance(&env, &liability_token_ata());
   let r = env.run_ix(settle_cashout_instruction(co, co_ata, bet_id));
   assert_ok_record_cu("settle_bet/cashout_won", &r);
   assert_account_closed_or_system_empty(&env, &co);
   assert!(read_token_balance(&env, &liability_token_ata()) > pre_liab);
}
