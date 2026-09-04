//! `settle_freebet` coverage.

use solana_instruction::{AccountMeta, Instruction};

use spamm_aggregator::constants::FREEBET_REINSTATE_SECS;
use spamm_aggregator::errors::SpammError;
use spamm_aggregator::helpers::calc_potential_profit;
use spamm_aggregator::instructions::{FillBetIxData, GRADE_BETS_IX_DISCRIMINATOR};
use spamm_aggregator::state::account_bet::BetResult;
use spamm_aggregator::state::{EventGameState, FreebetState};

use crate::common::{
   admin, agg_program_id, assert_account_closed_or_system_empty, assert_ok_record_cu, assert_spamm_err,
   bet_pda_for, bet_token_ata, bootstrap_issued_freebet, config_pda, decode_bet, decode_freebet,
   decode_issuer, encumbrance_pda, event_id_soccer, fill_bet_netting_placeholder,
   freebet_fill_bet_instruction, issuer_ata, market_spread_pregame, read_encumbrance,
   read_token_balance, settle_bet_instruction, settle_freebet_instruction, system_owned_empty, user,
   user_collateral_ata, Env, FREEBET_ID_BASIC,
};

const STAKE: u64 = 10_000_000;

fn grade_ix(results: &[u8], bets: &[solana_pubkey::Pubkey]) -> Instruction {
   let mut metas = vec![
      AccountMeta::new(admin(), true),
      AccountMeta::new_readonly(config_pda(), false),
   ];
   for b in bets {
      metas.push(AccountMeta::new(*b, false));
   }
   let mut buf = vec![GRADE_BETS_IX_DISCRIMINATOR];
   buf.extend_from_slice(results);
   Instruction::new_with_bytes(agg_program_id(), &buf, metas)
}

fn fill_freebet_bet(env: &mut Env, bet_id: u64) -> (solana_pubkey::Pubkey, solana_pubkey::Pubkey) {
   bootstrap_issued_freebet(env, FREEBET_ID_BASIC, STAKE, 10_000, 50_000, 1, &[], &[]);
   let mid = market_spread_pregame(event_id_soccer());
   let data = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: STAKE,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let r = env.run_ix(freebet_fill_bet_instruction(
      FREEBET_ID_BASIC,
      &data,
      bet,
      bat,
      &mid,
      fill_bet_netting_placeholder(),
   ));
   assert!(r.program_result.is_ok(), "freebet fill {:?}", r);
   (bet, bat)
}

#[test]
fn settle_freebet_won_routes_stake_to_issuer() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, bat) = fill_freebet_bet(&mut env, 901);
   assert!(env.run_ix(grade_ix(&[BetResult::Won as u8], &[bet])).program_result.is_ok());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_i = read_token_balance(&env, &issuer_ata());
   let pre_e = read_encumbrance(&env, &encumbrance_pda());
   let bd = decode_bet(&env, &bet);
   let r = env.run_ix(settle_freebet_instruction(bet, bat, FREEBET_ID_BASIC));
   assert_ok_record_cu("settle_freebet/won", &r);
   let profit = calc_potential_profit(bd.fillers[0].amount, bd.fillers[0].odds_scaled).unwrap();
   assert_eq!(read_token_balance(&env, &user_collateral_ata()), pre_u + profit);
   assert_eq!(read_token_balance(&env, &issuer_ata()), pre_i + bd.amount);
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      pre_e - profit as i64
   );
   assert_account_closed_or_system_empty(&env, &bet);
   assert_account_closed_or_system_empty(&env, &crate::common::freebet_pda(FREEBET_ID_BASIC));
   assert_eq!(decode_issuer(&env).open_count, 0);
}

#[test]
fn settle_freebet_lost_pays_mm() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, bat) = fill_freebet_bet(&mut env, 902);
   assert!(env.run_ix(grade_ix(&[BetResult::Lost as u8], &[bet])).program_result.is_ok());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_i = read_token_balance(&env, &issuer_ata());
   let r = env.run_ix(settle_freebet_instruction(bet, bat, FREEBET_ID_BASIC));
   assert_ok_record_cu("settle_freebet/lost", &r);
   assert_eq!(read_token_balance(&env, &user_collateral_ata()), pre_u);
   assert_eq!(read_token_balance(&env, &issuer_ata()), pre_i);
   assert_account_closed_or_system_empty(&env, &crate::common::freebet_pda(FREEBET_ID_BASIC));
}

#[test]
fn settle_freebet_cancel_reinstates() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, bat) = fill_freebet_bet(&mut env, 903);
   assert!(env
      .run_ix(grade_ix(&[BetResult::Cancelled as u8], &[bet]))
      .program_result
      .is_ok());
   env.set_clock_unix_timestamp(10);
   let pre_i = read_token_balance(&env, &issuer_ata());
   let r = env.run_ix(settle_freebet_instruction(bet, bat, FREEBET_ID_BASIC));
   assert_ok_record_cu("settle_freebet/cancel", &r);
   assert_eq!(read_token_balance(&env, &issuer_ata()), pre_i + STAKE);
   let fb = decode_freebet(&env, FREEBET_ID_BASIC);
   assert_eq!(fb.state, FreebetState::Available);
   assert_eq!(fb.amount, STAKE);
   assert_eq!(fb.expiry, 10 + FREEBET_REINSTATE_SECS);
   assert_eq!(decode_issuer(&env).open_count, 1);
}

#[test]
fn settle_freebet_half_lost_halves_amount() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, bat) = fill_freebet_bet(&mut env, 904);
   assert!(env
      .run_ix(grade_ix(&[BetResult::HalfLost as u8], &[bet]))
      .program_result
      .is_ok());
   env.set_clock_unix_timestamp(20);
   let r = env.run_ix(settle_freebet_instruction(bet, bat, FREEBET_ID_BASIC));
   assert_ok_record_cu("settle_freebet/half_lost", &r);
   let fb = decode_freebet(&env, FREEBET_ID_BASIC);
   assert_eq!(fb.state, FreebetState::Available);
   assert_eq!(fb.amount, STAKE / 2);
   assert_eq!(fb.expiry, 20 + FREEBET_REINSTATE_SECS);
}

#[test]
fn settle_bet_rejects_freebet_ticket() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, bat) = fill_freebet_bet(&mut env, 905);
   assert!(env.run_ix(grade_ix(&[BetResult::Won as u8], &[bet])).program_result.is_ok());
   let r = env.run_ix(settle_bet_instruction(bet, bat, 905));
   assert_spamm_err(&r, SpammError::InvalidFreebet);
}
