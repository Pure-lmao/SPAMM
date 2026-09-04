//! `init` / `issue` / `revoke` / `withdraw` / `remove` freebet issuer coverage.

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::state::FreebetState;

use crate::common::{
   admin, assert_account_closed_or_system_empty, assert_ok_record_cu, assert_program_err, assert_spamm_err,
   bootstrap_issued_freebet, decode_freebet, decode_issuer, freebet_pda, init_freebet_issuer_instruction,
   issue_freebet_instruction, issuer_ata, issuer_auth, issuer_auth_ata, issuer_pda, mint_pubkey,
   mm_program_id, read_token_balance, remove_freebet_issuer_instruction, revoke_freebet_instruction,
   rich_signer_account, system_owned_empty, withdraw_freebet_funds_instruction, wrong_signer, Env,
   FREEBET_EXPIRY, FREEBET_ID_BASIC, USER_COLLATERAL_TOKENS,
};
use mollusk_svm_programs_token::token;
use solana_program_option::COption;
use spl_token_interface::state::{Account as TokenAccount, AccountState};

fn upsert_issuer_auth_ata(env: &mut Env, amount: u64) {
   let tok = token::create_account_for_token_account(TokenAccount {
      mint: mint_pubkey(),
      owner: issuer_auth(),
      amount,
      delegate: COption::None,
      state: AccountState::Initialized,
      is_native: COption::None,
      delegated_amount: 0,
      close_authority: COption::None,
   });
   env.upsert(issuer_auth_ata(), tok);
}

#[test]
fn init_issue_revoke_success() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   env.upsert(issuer_auth(), rich_signer_account());
   env.upsert(issuer_pda(), system_owned_empty());
   env.upsert(issuer_ata(), system_owned_empty());
   env.upsert(crate::common::freebet_pda(FREEBET_ID_BASIC), system_owned_empty());
   env.set_clock_unix_timestamp(1);
   let r = env.run_ix(init_freebet_issuer_instruction());
   assert_ok_record_cu("init_freebet_issuer", &r);
   assert_eq!(decode_issuer(&env).open_count, 0);

   let r = env.run_ix(issue_freebet_instruction(
      FREEBET_ID_BASIC,
      FREEBET_EXPIRY,
      10_000_000,
      10_000,
      50_000,
      1,
      &[],
      &[],
   ));
   assert_ok_record_cu("issue_freebet", &r);
   assert_eq!(decode_issuer(&env).open_count, 1);
   let fb = decode_freebet(&env, FREEBET_ID_BASIC);
   assert_eq!(fb.state, FreebetState::Available);
   assert_eq!(fb.amount, 10_000_000);
   assert_eq!(fb.num_mms, 0);
   assert_eq!(fb.num_operators, 0);

   let r = env.run_ix(revoke_freebet_instruction(FREEBET_ID_BASIC));
   assert_ok_record_cu("revoke_freebet", &r);
   assert_eq!(decode_issuer(&env).open_count, 0);
   assert_account_closed_or_system_empty(&env, &crate::common::freebet_pda(FREEBET_ID_BASIC));
}

#[test]
fn withdraw_and_remove_success() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   env.upsert(issuer_auth(), rich_signer_account());
   env.upsert(issuer_pda(), system_owned_empty());
   env.upsert(issuer_ata(), system_owned_empty());
   let r = env.run_ix(init_freebet_issuer_instruction());
   assert!(r.program_result.is_ok(), "{:?}", r);
   env.patch_spl_token_balance(issuer_ata(), USER_COLLATERAL_TOKENS);
   upsert_issuer_auth_ata(&mut env, 0);
   let out = 1_000_000u64;
   let r = env.run_ix(withdraw_freebet_funds_instruction(out));
   assert_ok_record_cu("withdraw_freebet_funds", &r);
   assert_eq!(read_token_balance(&env, &issuer_ata()), USER_COLLATERAL_TOKENS - out);
   assert_eq!(read_token_balance(&env, &issuer_auth_ata()), out);

   let r = env.run_ix(remove_freebet_issuer_instruction());
   assert_ok_record_cu("remove_freebet_issuer", &r);
   assert_account_closed_or_system_empty(&env, &issuer_pda());
}

#[test]
fn issue_expired_fails() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   env.upsert(issuer_auth(), rich_signer_account());
   env.upsert(issuer_pda(), system_owned_empty());
   env.upsert(issuer_ata(), system_owned_empty());
   env.upsert(crate::common::freebet_pda(FREEBET_ID_BASIC), system_owned_empty());
   env.set_clock_unix_timestamp(5_000);
   let r = env.run_ix(init_freebet_issuer_instruction());
   assert!(r.program_result.is_ok(), "{:?}", r);
   let r = env.run_ix(issue_freebet_instruction(
      FREEBET_ID_BASIC,
      1_000,
      10_000_000,
      10_000,
      50_000,
      1,
      &[],
      &[],
   ));
   assert_spamm_err(&r, SpammError::FreebetExpired);
}

#[test]
fn remove_with_open_freebet_fails() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, 10_000_000, 10_000, 50_000, 1, &[], &[]);
   upsert_issuer_auth_ata(&mut env, 0);
   let r = env.run_ix(remove_freebet_issuer_instruction());
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn bootstrap_issued_freebet_open_count() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   bootstrap_issued_freebet(&mut env, FREEBET_ID_BASIC, 10_000_000, 10_000, 50_000, 1, &[], &[]);
   assert_eq!(decode_issuer(&env).open_count, 1);
}

#[test]
fn issue_freebet_wrong_signer() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   env.upsert(wrong_signer(), rich_signer_account());
   env.upsert(issuer_auth(), rich_signer_account());
   env.upsert(issuer_pda(), system_owned_empty());
   env.upsert(issuer_ata(), system_owned_empty());
   assert!(env.run_ix(init_freebet_issuer_instruction()).program_result.is_ok());
   env.upsert(freebet_pda(FREEBET_ID_BASIC), system_owned_empty());
   let mut ix = issue_freebet_instruction(
      FREEBET_ID_BASIC,
      FREEBET_EXPIRY,
      1_000_000,
      10_000,
      200_000,
      1,
      &[],
      &[],
   );
   ix.accounts[0] = AccountMeta::new(wrong_signer(), true);
   let r = env.run_ix(ix);
   assert!(r.program_result.is_err());
}

#[test]
fn issue_stores_allowlists() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   env.upsert(issuer_auth(), rich_signer_account());
   env.upsert(issuer_pda(), system_owned_empty());
   env.upsert(issuer_ata(), system_owned_empty());
   env.upsert(crate::common::freebet_pda(FREEBET_ID_BASIC), system_owned_empty());
   env.set_clock_unix_timestamp(1);
   assert!(env.run_ix(init_freebet_issuer_instruction()).program_result.is_ok());
   let r = env.run_ix(issue_freebet_instruction(
      FREEBET_ID_BASIC,
      FREEBET_EXPIRY,
      10_000_000,
      10_000,
      50_000,
      1,
      &[mm_program_id()],
      &[admin()],
   ));
   assert_ok_record_cu("issue_freebet/allowlists", &r);
   let fb = decode_freebet(&env, FREEBET_ID_BASIC);
   assert_eq!(fb.num_mms, 1);
   assert_eq!(fb.num_operators, 1);
   assert_eq!(fb.allowed_mms[0].as_ref(), mm_program_id().as_ref());
   assert_eq!(fb.allowed_operators[0].as_ref(), admin().as_ref());
}
