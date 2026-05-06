//! `change_config_status` tests.
use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;

use crate::common::{admin, assert_program_err, config_pda, read_config_authority_status, record_cu_success, wrong_signer, Env};

#[test]
fn change_config_pause_toggle() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   // Measure active transition after an explicit pause (bootstrap already active).
   let ix_pause_first = env.agg_ix(
      1,
      vec![0u8],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   assert!(env.run_ix(ix_pause_first).program_result.is_ok());
   assert_eq!(read_config_authority_status(&env, &config_pda()).1, 0u8);

   let ix_act = env.agg_ix(
      1,
      vec![1],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   let r = env.run_ix(ix_act);
   assert!(r.program_result.is_ok());
   assert_eq!(read_config_authority_status(&env, &config_pda()).1, 1u8);
   record_cu_success("change_config_status/active", &r);

   let ix_paused = env.agg_ix(
      1,
      vec![0],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   let r2 = env.run_ix(ix_paused);
   assert!(r2.program_result.is_ok());
   assert_eq!(read_config_authority_status(&env, &config_pda()).1, 0u8);
   record_cu_success("change_config_status/paused", &r2);
}

#[test]
fn change_config_non_admin() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let ix = env.agg_ix(
      1,
      vec![1],
      vec![
         AccountMeta::new(wrong_signer(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

#[test]
fn change_config_bad_status_byte() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let ix = env.agg_ix(
      1,
      vec![2],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn change_config_wrong_data_len() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let ix = env.agg_ix(
      1,
      vec![],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn change_config_wrong_config_pda() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let bad = solana_pubkey::Pubkey::new_from_array([0x77; 32]);
   env.upsert(bad, crate::common::system_owned_empty());
   let ix = env.agg_ix(
      1,
      vec![1],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(bad, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidSeeds);
}
