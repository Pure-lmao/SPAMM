//! Per-market mint checks and one boosted single (pay the issuer top-up at settle).

use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_program_option::COption;
use solana_pubkey::Pubkey;

use mollusk_svm_programs_token::token;
use spl_token_interface::state::Mint;

use spamm_aggregator::constants::{FREEBET_REINSTATE_SECS, MAX_PROMO_ALLOWED_MMS, MAX_PROMO_ALLOWED_OPERATORS};
use spamm_aggregator::helpers::calc_potential_profit;
use spamm_aggregator::instructions::{
   FillBetIxData, FillParlayIxData, GRADE_BETS_IX_DISCRIMINATOR, ISSUE_BOOST_IX_DISCRIMINATOR,
   SETTLE_BOOSTED_BET_IX_DISCRIMINATOR,
};
use spamm_aggregator::state::account_bet::BetResult;
use spamm_aggregator::state::{
   BoostAccountData, EventGameState, PromoState, IssueBoostIxData, BOOST_ACCOUNT_SEED,
   FREEBET_ACCOUNT_SEED, ISSUE_BOOST_IX_HEADER_LEN,
};

use crate::common::{
   admin, agg_program_id, assert_account_closed_or_system_empty, assert_program_err, bet_pda_for,
   bet_token_ata, clock_sysvar_pubkey, config_pda, create_promo_issuer_ata_instruction,    decode_bet,
   event_id_soccer, event_id_soccer_b, fill_bet_metas_one_mm, fill_bet_netting_placeholder,
   fill_parlay_instruction, init_freebet_issuer_instruction, issue_freebet_instruction, issuer_ata,
   issuer_auth, issuer_pda, market_soccer_ft_pregame, market_spread_pregame, mint_pubkey, mm_program_id,
   oracle_body_three_outcome, oracle_body_two_outcome, parlay_bet_pda_for, parlay_leg, parlay_legs_fill,
   read_token_balance, rent_sysvar_pubkey, rich_signer_account, settle_bet_metas, system_owned_empty,
   user, user_collateral_ata, Env, FREEBET_EXPIRY, FREEBET_ID_BASIC, USER_COLLATERAL_TOKENS,
};

const STAKE: u64 = 10_000_000;
const BOOST_ID: u32 = 3;

fn grade_ix(result: u8, bet: Pubkey) -> Instruction {
   Instruction::new_with_bytes(
      agg_program_id(),
      &[GRADE_BETS_IX_DISCRIMINATOR, result],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new(bet, false),
      ],
   )
}

fn boost_pda() -> Pubkey {
   Pubkey::find_program_address(
      &[
         BOOST_ACCOUNT_SEED,
         issuer_auth().as_ref(),
         mint_pubkey().as_ref(),
         &BOOST_ID.to_le_bytes(),
      ],
      &agg_program_id(),
   )
   .0
}

fn issue_boost_instruction() -> Instruction {
   let parsed = IssueBoostIxData {
      boost_id: BOOST_ID,
      expiry: FREEBET_EXPIRY,
      max_stake: STAKE,
      min_odds_scaled: 10_000,
      max_odds_scaled: 50_000,
      boost_bps: 10_000,
      min_legs: 1,
      num_mms: 0,
      num_operators: 0,
      allowed_mms: [pinocchio::Address::default(); MAX_PROMO_ALLOWED_MMS],
      allowed_operators: [pinocchio::Address::default(); MAX_PROMO_ALLOWED_OPERATORS],
   };
   let mut body = vec![0u8; ISSUE_BOOST_IX_HEADER_LEN];
   parsed.write_wire(&mut body).expect("issue boost wire");
   let mut buf = vec![ISSUE_BOOST_IX_DISCRIMINATOR];
   buf.extend_from_slice(&body);
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      vec![
         AccountMeta::new(issuer_auth(), true),
         AccountMeta::new(issuer_pda(), false),
         AccountMeta::new_readonly(user(), false),
         AccountMeta::new(boost_pda(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(sys, false),
         AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      ],
   )
}

fn boosted_fill_instruction(data: &FillBetIxData, bet: Pubkey, bat: Pubkey, market: &spamm_aggregator::state::MarketId) -> Instruction {
   let mut payload = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut payload).expect("fill bet wire");
   let mut buf = vec![spamm_aggregator::instructions::BOOSTED_FILL_BET_IX_DISCRIMINATOR];
   buf.extend_from_slice(&BOOST_ID.to_le_bytes());
   buf.extend_from_slice(&payload);
   let mut metas = fill_bet_metas_one_mm(bet, bat, market, fill_bet_netting_placeholder());
   metas.splice(
      3..3,
      [
         AccountMeta::new_readonly(issuer_pda(), false),
         AccountMeta::new_readonly(issuer_ata(), false),
         AccountMeta::new(boost_pda(), false),
      ],
   );
   Instruction::new_with_bytes(agg_program_id(), &buf, metas)
}

fn settle_boosted_instruction(bet: Pubkey, bat: Pubkey) -> Instruction {
   let mut metas = settle_bet_metas(bet, bat, 0);
   metas.remove(10);
   metas.remove(9);
   metas.splice(
      6..6,
      [
         AccountMeta::new(issuer_auth(), false),
         AccountMeta::new(issuer_pda(), false),
         AccountMeta::new(issuer_ata(), false),
         AccountMeta::new(boost_pda(), false),
      ],
   );
   metas.insert(13, AccountMeta::new_readonly(clock_sysvar_pubkey(), false));
   Instruction::new_with_bytes(agg_program_id(), &[SETTLE_BOOSTED_BET_IX_DISCRIMINATOR], metas)
}

fn bootstrap_boost(env: &mut Env, issuer_balance: u64) {
   env.upsert(issuer_auth(), rich_signer_account());
   env.upsert(issuer_pda(), system_owned_empty());
   env.upsert(issuer_ata(), system_owned_empty());
   env.upsert(boost_pda(), system_owned_empty());
   env.set_clock_unix_timestamp(1);
   assert!(env.run_ix(init_freebet_issuer_instruction()).program_result.is_ok());
   assert!(env.run_ix(create_promo_issuer_ata_instruction()).program_result.is_ok());
   if issuer_balance > 0 {
      env.patch_spl_token_balance(issuer_ata(), issuer_balance);
   }
   assert!(env.run_ix(issue_boost_instruction()).program_result.is_ok(), "issue_boost");
}

fn fill_boosted(env: &mut Env, bet_id: u64) -> (Pubkey, Pubkey) {
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
   let issuer_before = read_token_balance(env, &issuer_ata());
   let user_before = read_token_balance(env, &user_collateral_ata());
   let r = env.run_ix(boosted_fill_instruction(&data, bet, bat, &mid));
   assert!(r.program_result.is_ok(), "boosted fill {:?}", r);
   assert_eq!(read_token_balance(env, &issuer_ata()), issuer_before);
   assert_eq!(read_token_balance(env, &user_collateral_ata()), user_before - STAKE);
   (bet, bat)
}

fn decode_boost(env: &Env) -> BoostAccountData {
   let acct = env.get_account(&boost_pda()).expect("boost pda");
   BoostAccountData::decode(&acct.data).expect("decode boost")
}

fn upsert_mint(env: &mut Env, key: Pubkey, decimals: u8) {
   env.upsert(
      key,
      token::create_account_for_mint(Mint {
         mint_authority: COption::Some(admin()),
         supply: 0,
         decimals,
         is_initialized: true,
         freeze_authority: COption::None,
      }),
   );
}

#[test]
fn netting_pda_differs_by_operator() {
   let eid = event_id_soccer();
   let other = Pubkey::new_from_array([0x44; 32]);
   let a = crate::common::netting_pda_for_event(&eid);
   let b = Pubkey::find_program_address(
      &[
         b"netting",
         mm_program_id().as_ref(),
         eid.as_wire_bytes().as_slice(),
         other.as_ref(),
         mint_pubkey().as_ref(),
      ],
      &agg_program_id(),
   )
   .0;
   assert_ne!(a, b);
}

#[test]
fn parlay_rejects_mixed_mints() {
   let mut env = Env::new();
   let m1 = market_spread_pregame(event_id_soccer());
   let mut m2 = market_soccer_ft_pregame(event_id_soccer_b());
   m2.mint = Pubkey::new_from_array([0x33; 32]);
   let b1 = oracle_body_two_outcome(20_000, 20_000);
   let b2 = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(m1, b1.as_slice()), (m2, b2.as_slice())]);
   let bet_id = crate::common::BET_ID_PARLAY;
   let bet = parlay_bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let l0 = parlay_leg(m1, 0, 1, EventGameState::zeroed());
   let l1 = parlay_leg(m2, 1, 1, EventGameState::zeroed());
   let payload = FillParlayIxData {
      bet_id,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      num_legs: 2,
      legs: parlay_legs_fill(&[l0, l1]),
   };
   let r = env.run_ix(fill_parlay_instruction(&payload, bet, bat, &[m1, m2]));
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn nine_decimal_mint_minimum_is_tenth_token() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let mint = Pubkey::new_from_array([0x11; 32]);
   upsert_mint(&mut env, mint, 9);
   env.upsert(issuer_auth(), rich_signer_account());
   env.upsert(issuer_pda(), system_owned_empty());
   env.set_clock_unix_timestamp(1);
   assert!(env.run_ix(init_freebet_issuer_instruction()).program_result.is_ok());
   let pda = Pubkey::find_program_address(
      &[FREEBET_ACCOUNT_SEED, issuer_auth().as_ref(), mint.as_ref(), &FREEBET_ID_BASIC.to_le_bytes()],
      &agg_program_id(),
   )
   .0;
   env.upsert(pda, system_owned_empty());
   let mut low = issue_freebet_instruction(FREEBET_ID_BASIC, FREEBET_EXPIRY, 100_000_000 - 1, 10_000, 50_000, 1, &[], &[]);
   low.accounts[3] = AccountMeta::new(pda, false);
   low.accounts[4] = AccountMeta::new_readonly(mint, false);
   assert_program_err(&env.run_ix(low), ProgramError::InvalidInstructionData);
   let mut ok = issue_freebet_instruction(FREEBET_ID_BASIC, FREEBET_EXPIRY, 100_000_000, 10_000, 50_000, 1, &[], &[]);
   ok.accounts[3] = AccountMeta::new(pda, false);
   ok.accounts[4] = AccountMeta::new_readonly(mint, false);
   assert!(env.run_ix(ok).program_result.is_ok(), "min stake 1e8");
}

#[test]
fn eleven_decimal_mint_rejected() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let mint = Pubkey::new_from_array([0x22; 32]);
   upsert_mint(&mut env, mint, 11);
   env.upsert(issuer_auth(), rich_signer_account());
   env.upsert(issuer_pda(), system_owned_empty());
   env.upsert(crate::common::freebet_pda(FREEBET_ID_BASIC), system_owned_empty());
   env.set_clock_unix_timestamp(1);
   assert!(env.run_ix(init_freebet_issuer_instruction()).program_result.is_ok());
   let mut ix = issue_freebet_instruction(FREEBET_ID_BASIC, FREEBET_EXPIRY, 1_000_000_000, 10_000, 50_000, 1, &[], &[]);
   ix.accounts[4] = AccountMeta::new_readonly(mint, false);
   assert_program_err(&env.run_ix(ix), ProgramError::InvalidAccountData);
}

#[test]
fn boosted_win_pays_issuer_topup() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_boost(&mut env, USER_COLLATERAL_TOKENS);
   let (bet, bat) = fill_boosted(&mut env, 8801);
   assert!(env.run_ix(grade_ix(BetResult::Won as u8, bet)).program_result.is_ok());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let pre_i = read_token_balance(&env, &issuer_ata());
   let bd = decode_bet(&env, &bet);
   let profit = calc_potential_profit(bd.fillers[0].amount, bd.fillers[0].odds_scaled).unwrap();
   assert_eq!(profit, STAKE);
   let r = env.run_ix(settle_boosted_instruction(bet, bat));
   assert!(r.program_result.is_ok(), "settle boosted {:?}", r);
   assert_eq!(read_token_balance(&env, &user_collateral_ata()), pre_u + STAKE + profit + profit);
   assert_eq!(read_token_balance(&env, &issuer_ata()), pre_i - profit);
   assert_account_closed_or_system_empty(&env, &boost_pda());
}

#[test]
fn boosted_loss_moves_no_issuer_tokens() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_boost(&mut env, USER_COLLATERAL_TOKENS);
   let (bet, bat) = fill_boosted(&mut env, 8802);
   assert!(env.run_ix(grade_ix(BetResult::Lost as u8, bet)).program_result.is_ok());
   let pre_i = read_token_balance(&env, &issuer_ata());
   assert!(env.run_ix(settle_boosted_instruction(bet, bat)).program_result.is_ok());
   assert_eq!(read_token_balance(&env, &issuer_ata()), pre_i);
   assert_account_closed_or_system_empty(&env, &boost_pda());
}

#[test]
fn boosted_push_reinstates() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_boost(&mut env, USER_COLLATERAL_TOKENS);
   let (bet, bat) = fill_boosted(&mut env, 8803);
   env.set_clock_unix_timestamp(1_000);
   assert!(env.run_ix(grade_ix(BetResult::Push as u8, bet)).program_result.is_ok());
   let pre_i = read_token_balance(&env, &issuer_ata());
   assert!(env.run_ix(settle_boosted_instruction(bet, bat)).program_result.is_ok());
   assert_eq!(read_token_balance(&env, &issuer_ata()), pre_i);
   let boost = decode_boost(&env);
   assert_eq!(boost.state, PromoState::Available);
   assert_eq!(boost.expiry, 1_000 + FREEBET_REINSTATE_SECS);
}

#[test]
fn boosted_win_empty_issuer_ata_fails() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_boost(&mut env, 0);
   let (bet, bat) = fill_boosted(&mut env, 8804);
   assert!(env.run_ix(grade_ix(BetResult::Won as u8, bet)).program_result.is_ok());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let r = env.run_ix(settle_boosted_instruction(bet, bat));
   assert!(r.program_result.is_err(), "empty issuer must fail settle");
   assert_eq!(read_token_balance(&env, &user_collateral_ata()), pre_u);
   assert_eq!(read_token_balance(&env, &issuer_ata()), 0);
}
