//! `register_mm` tests.

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;

use solana_pubkey::Pubkey;

use crate::common::{
   assert_encumbrance_discriminator, assert_program_err, encumbrance_pda, event_id_soccer, liability_token_ata,
   market_spread_pregame, mm_admin, mm_list_pda, mm_program_id, oracle_body_two_outcome, read_encumbrance,
   read_mm_list_tail, record_cu_success, user, wrong_signer, Env,
};

fn register_metas(signer: solana_pubkey::Pubkey, mm_prog: solana_pubkey::Pubkey) -> Vec<AccountMeta> {
   let mut metas = Env::register_mm_metas();
   metas[0] = AccountMeta::new(signer, true);
   metas[1] = AccountMeta::new_readonly(mm_prog, false);
   metas
}

#[test]
fn register_mm_success() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let mid = market_spread_pregame(eid);
   let body = oracle_body_two_outcome(20_000, 20_000);
   let r = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   assert!(r.program_result.is_ok());
   let (n, addrs) = read_mm_list_tail(&env, &mm_list_pda());
   assert_eq!(n, 1);
   assert_eq!(addrs[0], mm_program_id());
   assert_encumbrance_discriminator(&env, &encumbrance_pda());
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), 0);
   record_cu_success("register_mm", &r);
}

#[test]
fn register_mm_twice_fails() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let ix = env.agg_ix(2, vec![], register_metas(mm_admin(), mm_program_id()));
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn register_mm_wrong_mm_admin_signer() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let eid = event_id_soccer();
   let mid = market_spread_pregame(eid);
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.prepare_mm_for_register(&[(mid, body.as_slice())]);
   env.upsert(encumbrance_pda(), crate::common::system_owned_empty());
   env.upsert(liability_token_ata(), crate::common::system_owned_empty());
   let ix = env.agg_ix(2, vec![], register_metas(wrong_signer(), mm_program_id()));
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

/// `mm_program` is not executable (`verify_mm_program_executable` → `IncorrectProgramId`).
#[test]
fn register_mm_non_executable_mm_program() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let eid = event_id_soccer();
   let mid = market_spread_pregame(eid);
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.prepare_mm_for_register(&[(mid, body.as_slice())]);
   env.upsert(encumbrance_pda(), crate::common::system_owned_empty());
   env.upsert(liability_token_ata(), crate::common::system_owned_empty());
   let ix = env.agg_ix(2, vec![], register_metas(mm_admin(), user()));
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectProgramId);
}

/// Executable account at wrong pubkey: config PDA is owned by the real MM program, not this account.
#[test]
fn register_mm_executable_foreign_mm_program_id() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let eid = event_id_soccer();
   let mid = market_spread_pregame(eid);
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.prepare_mm_for_register(&[(mid, body.as_slice())]);
   env.upsert(encumbrance_pda(), crate::common::system_owned_empty());
   env.upsert(liability_token_ata(), crate::common::system_owned_empty());
   env.upsert(wrong_signer(), crate::common::clone_account_stub());
   let ix = env.agg_ix(2, vec![], register_metas(mm_admin(), wrong_signer()));
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountOwner);
}

#[test]
fn register_mm_nonempty_ix_data() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let ix = env.agg_ix(2, vec![1], register_metas(mm_admin(), mm_program_id()));
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn register_mm_wrong_our_config_pda_rejected() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let eid = event_id_soccer();
   let mid = market_spread_pregame(eid);
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.prepare_mm_for_register(&[(mid, body.as_slice())]);
   env.upsert(encumbrance_pda(), crate::common::system_owned_empty());
   env.upsert(liability_token_ata(), crate::common::system_owned_empty());
   let fake = Pubkey::new_from_array([0xC3; 32]);
   env.upsert(fake, crate::common::system_owned_empty());
   let mut metas = register_metas(mm_admin(), mm_program_id());
   metas[5] = AccountMeta::new_readonly(fake, false);
   let ix = env.agg_ix(2, vec![], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidSeeds);
}

#[test]
fn register_mm_wrong_mm_list_pda_rejected() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let eid = event_id_soccer();
   let mid = market_spread_pregame(eid);
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.prepare_mm_for_register(&[(mid, body.as_slice())]);
   env.upsert(encumbrance_pda(), crate::common::system_owned_empty());
   env.upsert(liability_token_ata(), crate::common::system_owned_empty());
   let fake_list = Pubkey::new_from_array([0xC4; 32]);
   env.upsert(fake_list, crate::common::system_owned_empty());
   let mut metas = register_metas(mm_admin(), mm_program_id());
   metas[6] = AccountMeta::new(fake_list, false);
   let ix = env.agg_ix(2, vec![], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidSeeds);
}

#[test]
fn register_mm_wrong_mint_rejected() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let eid = event_id_soccer();
   let mid = market_spread_pregame(eid);
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.prepare_mm_for_register(&[(mid, body.as_slice())]);
   env.upsert(encumbrance_pda(), crate::common::system_owned_empty());
   env.upsert(liability_token_ata(), crate::common::system_owned_empty());
   let fake_mint = Pubkey::new_from_array([0xC5; 32]);
   env.upsert(fake_mint, crate::common::system_owned_empty());
   let mut metas = register_metas(mm_admin(), mm_program_id());
   metas[7] = AccountMeta::new_readonly(fake_mint, false);
   let ix = env.agg_ix(2, vec![], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn register_mm_wrong_system_program_rejected() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let eid = event_id_soccer();
   let mid = market_spread_pregame(eid);
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.prepare_mm_for_register(&[(mid, body.as_slice())]);
   env.upsert(encumbrance_pda(), crate::common::system_owned_empty());
   env.upsert(liability_token_ata(), crate::common::system_owned_empty());
   let mut metas = register_metas(mm_admin(), mm_program_id());
   metas[11] = AccountMeta::new_readonly(user(), false);
   let ix = env.agg_ix(2, vec![], metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectProgramId);
}

#[test]
fn register_mm_corrupted_mm_list_header_rejected() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let eid = event_id_soccer();
   let mid = market_spread_pregame(eid);
   let body = oracle_body_two_outcome(20_000, 20_000);
   env.prepare_mm_for_register(&[(mid, body.as_slice())]);
   env.upsert(encumbrance_pda(), crate::common::system_owned_empty());
   env.upsert(liability_token_ata(), crate::common::system_owned_empty());
   let mut bad = crate::common::system_owned_empty();
   bad.data = vec![0u8; 4];
   env.upsert(mm_list_pda(), bad);
   let ix = env.agg_ix(2, vec![], register_metas(mm_admin(), mm_program_id()));
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}
