//! `withdraw_from_liability_account` tests.

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;

use crate::common::{
   assert_program_err, assert_spamm_err, bet_pda_for, bet_token_ata, encumbrance_pda, event_id_soccer, fill_bet_instruction,
   fill_bet_netting_placeholder, liability_token_ata, market_spread_pregame, mm_admin, mm_collateral_ata,
   mm_config_pda, mm_program_id, mint_pubkey, read_encumbrance, read_token_balance, record_cu_success,
   system_owned_empty, user, user_collateral_ata, wrong_signer, config_pda, Env,
};
use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::FillBetIxData;
use spamm_aggregator::state::EventGameState;
use mollusk_svm_programs_token::token;
use solana_program_pack::Pack;
use spl_token_interface::state::Account as TokenState;

fn token_amount(acct: &solana_account::Account) -> u64 {
   TokenState::unpack_from_slice(&acct.data).expect("token unpack").amount
}

#[test]
fn withdraw_free_after_fill() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 600);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 600,
      market_id: mid,
      side: 0,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(&data, bet, bat, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());

   let liab = liability_token_ata();
   let bal_after_fill = token_amount(env.get_account(&liab).expect("liab"));
   env.patch_spl_token_balance(liab, bal_after_fill.saturating_add(25_000_000));

   let enc_pda = encumbrance_pda();
   let enc_before = read_encumbrance(&env, &enc_pda);
   let mm_tok = mm_collateral_ata();
   let mm_before = read_token_balance(&env, &mm_tok);
   let liab_before = read_token_balance(&env, &liab);

   let liab_ac = env.get_account(&liab).expect("liab");
   let enc_data = env.get_account(&enc_pda).expect("enc");
   let enc_val = i64::from_le_bytes(enc_data.data[2..10].try_into().unwrap());
   let enc_u = if enc_val < 0 { 0u64 } else { enc_val as u64 };
   let bal = token_amount(liab_ac);
   let free = bal.saturating_sub(enc_u);
   assert!(free > 0);

   let mut wd = Vec::new();
   wd.extend_from_slice(&free.to_le_bytes());
   let ix = env.agg_ix(
      50,
      wd,
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(mm_config_pda(), false),
         AccountMeta::new(enc_pda, false),
         AccountMeta::new(liab, false),
         AccountMeta::new(mm_collateral_ata(), false),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
      ],
   );
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   assert_eq!(read_encumbrance(&env, &enc_pda), enc_before);
   assert_eq!(read_token_balance(&env, &mm_tok), mm_before.saturating_add(free));
   assert_eq!(read_token_balance(&env, &liab), liab_before.saturating_sub(free));
   record_cu_success("withdraw_from_liability_account", &r);
}

#[test]
fn withdraw_rejected_while_agg_paused() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 601);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 601,
      market_id: mid,
      side: 0,
      amount: 2_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(&data, bet, bat, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());

   let pause = env.agg_ix(
      1,
      vec![0u8],
      vec![
         AccountMeta::new(crate::common::admin(), true),
         AccountMeta::new(crate::common::config_pda(), false),
      ],
   );
   assert!(env.run_ix(pause).program_result.is_ok());

   let liab = liability_token_ata();
   let enc_pda = encumbrance_pda();
   let free = token_amount(env.get_account(&liab).expect("liab"))
      .saturating_sub({
         let enc_val = i64::from_le_bytes(env.get_account(&enc_pda).expect("enc").data[2..10].try_into().unwrap());
         if enc_val < 0 { 0u64 } else { enc_val as u64 }
      });
   let mut wd = Vec::new();
   wd.extend_from_slice(&free.to_le_bytes());
   let ix = env.agg_ix(
      50,
      wd,
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(mm_config_pda(), false),
         AccountMeta::new(enc_pda, false),
         AccountMeta::new(liab, false),
         AccountMeta::new(mm_collateral_ata(), false),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::ProgramPaused);
}

fn filled_env_with_extra_liab() -> (Env, u64) {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 610);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 610,
      market_id: mid,
      side: 0,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(&data, bet, bat, &mid, fill_bet_netting_placeholder()))
      .program_result
      .is_ok());
   let liab = liability_token_ata();
   let bal_after_fill = token_amount(env.get_account(&liab).expect("liab"));
   env.patch_spl_token_balance(liab, bal_after_fill.saturating_add(25_000_000));
   let liab_ac = env.get_account(&liab).expect("liab");
   let enc_data = env.get_account(&encumbrance_pda()).expect("enc");
   let enc_val = i64::from_le_bytes(enc_data.data[2..10].try_into().unwrap());
   let enc_u = if enc_val < 0 { 0u64 } else { enc_val as u64 };
   let bal = token_amount(liab_ac);
   let free = bal.saturating_sub(enc_u);
   (env, free)
}

#[test]
fn withdraw_amount_exceeds_free_rejected() {
   let (mut env, free) = filled_env_with_extra_liab();
   let liab = liability_token_ata();
   let enc_pda = encumbrance_pda();
   let bust = free.saturating_add(1);
   let ix = env.agg_ix(
      50,
      bust.to_le_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(mm_config_pda(), false),
         AccountMeta::new(enc_pda, false),
         AccountMeta::new(liab, false),
         AccountMeta::new(mm_collateral_ata(), false),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn withdraw_wrong_mm_admin_rejected() {
   let (mut env, free) = filled_env_with_extra_liab();
   let liab = liability_token_ata();
   let enc_pda = encumbrance_pda();
   let ix = env.agg_ix(
      50,
      free.to_le_bytes().to_vec(),
      vec![
         AccountMeta::new(wrong_signer(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(mm_config_pda(), false),
         AccountMeta::new(enc_pda, false),
         AccountMeta::new(liab, false),
         AccountMeta::new(mm_collateral_ata(), false),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

#[test]
fn withdraw_bad_encumbrance_pda_rejected() {
   let (mut env, free) = filled_env_with_extra_liab();
   let liab = liability_token_ata();
   let fake_enc = solana_pubkey::Pubkey::new_from_array([0xE1; 32]);
   env.upsert(fake_enc, system_owned_empty());
   let ix = env.agg_ix(
      50,
      free.to_le_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(mm_config_pda(), false),
         AccountMeta::new(fake_enc, false),
         AccountMeta::new(liab, false),
         AccountMeta::new(mm_collateral_ata(), false),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountOwner);
}

#[test]
fn withdraw_wrong_ix_data_len_rejected() {
   let (mut env, _free) = filled_env_with_extra_liab();
   let liab = liability_token_ata();
   let enc_pda = encumbrance_pda();
   let ix = env.agg_ix(
      50,
      vec![1, 2, 3, 4, 5, 6, 7],
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(mm_config_pda(), false),
         AccountMeta::new(enc_pda, false),
         AccountMeta::new(liab, false),
         AccountMeta::new(mm_collateral_ata(), false),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn withdraw_mm_token_wrong_owner_rejected() {
   let (mut env, free) = filled_env_with_extra_liab();
   let liab = liability_token_ata();
   let enc_pda = encumbrance_pda();
   let ix = env.agg_ix(
      50,
      free.to_le_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(mm_config_pda(), false),
         AccountMeta::new(enc_pda, false),
         AccountMeta::new(liab, false),
         AccountMeta::new(user_collateral_ata(), false),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}
