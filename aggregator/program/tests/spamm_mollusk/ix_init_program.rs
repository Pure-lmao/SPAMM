//! `init_program` Mollusk tests.

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;
use solana_program_option::COption;
use solana_pubkey::Pubkey;
use spl_token_interface::state::Mint;

use mollusk_svm_programs_token::token;

use crate::common::{
   admin, assert_program_err, bet_feepayer, config_pda, mm_admin, mint_pubkey, mm_list_pda, read_config_authority_status,
   record_cu_success, rich_signer_account, system_owned_empty, user, wrong_signer, Env,
};

fn seed_funded_actors(env: &mut Env) {
   let (sys_pk, sys_acct) = mollusk_svm::program::keyed_account_for_system_program();
   let (tok_pk, tok_acct) = mollusk_svm_programs_token::token::keyed_account();
   let (ata_pk, ata_acct) = mollusk_svm_programs_token::associated_token::keyed_account();
   env.accounts = vec![
      (sys_pk, sys_acct),
      (tok_pk, tok_acct),
      (ata_pk, ata_acct),
      (admin(), rich_signer_account()),
      (mm_admin(), rich_signer_account()),
      (user(), rich_signer_account()),
      (bet_feepayer(), rich_signer_account()),
      (wrong_signer(), rich_signer_account()),
   ];
   let mint_acct = token::create_account_for_mint(Mint {
      mint_authority: COption::Some(admin()),
      supply: 0,
      decimals: 6,
      is_initialized: true,
      freeze_authority: COption::None,
   });
   env.upsert(mint_pubkey(), mint_acct);
}

#[test]
fn init_program_success_creates_pdas() {
   let mut env = Env::new();
   seed_funded_actors(&mut env);
   env.upsert(config_pda(), system_owned_empty());
   env.upsert(mm_list_pda(), system_owned_empty());
   let sys_pk = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      0,
      vec![],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
         AccountMeta::new(mm_list_pda(), false),
         AccountMeta::new_readonly(sys_pk, false),
      ],
   );
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   let cfg = env.get_account(&config_pda()).expect("config");
   assert!(!cfg.data.is_empty());
   let (authority, status) = read_config_authority_status(&env, &config_pda());
   assert_eq!(authority, admin());
   assert_eq!(status, 0u8);
   let ml = env.get_account(&mm_list_pda()).expect("mm_list");
   assert_eq!(ml.data[0], spamm_aggregator::state::other::MM_LIST_PDA_DISCRIMINATOR);
   assert_eq!(ml.data.len(), spamm_aggregator::state::other::MM_LIST_HEADER_LEN);
   record_cu_success("init_program", &r);
}

#[test]
fn init_program_fails_reinit() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let sys_pk = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      0,
      vec![],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
         AccountMeta::new(mm_list_pda(), false),
         AccountMeta::new_readonly(sys_pk, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn init_program_wrong_config_pda_seeds() {
   let mut env = Env::new();
   seed_funded_actors(&mut env);
   env.upsert(config_pda(), system_owned_empty());
   env.upsert(mm_list_pda(), system_owned_empty());
   let bad = Pubkey::new_from_array([0x55; 32]);
   env.upsert(bad, system_owned_empty());
   let sys_pk = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      0,
      vec![],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(bad, false),
         AccountMeta::new(mm_list_pda(), false),
         AccountMeta::new_readonly(sys_pk, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidSeeds);
}

#[test]
fn init_program_wrong_mm_list_pda() {
   let mut env = Env::new();
   seed_funded_actors(&mut env);
   env.upsert(config_pda(), system_owned_empty());
   let bad_list = Pubkey::new_from_array([0x66; 32]);
   env.upsert(bad_list, system_owned_empty());
   let sys_pk = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      0,
      vec![],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
         AccountMeta::new(bad_list, false),
         AccountMeta::new_readonly(sys_pk, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidSeeds);
}

#[test]
fn init_program_missing_admin_signer() {
   let mut env = Env::new();
   seed_funded_actors(&mut env);
   env.upsert(config_pda(), system_owned_empty());
   env.upsert(mm_list_pda(), system_owned_empty());
   let sys_pk = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      0,
      vec![],
      vec![
         AccountMeta::new(admin(), false),
         AccountMeta::new(config_pda(), false),
         AccountMeta::new(mm_list_pda(), false),
         AccountMeta::new_readonly(sys_pk, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::MissingRequiredSignature);
}
