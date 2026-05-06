//! Admin instructions: `write_arbitrary_data` (254) and `force_close_pda` (255).

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;

use crate::common::{
   admin, assert_ok_record_cu, assert_program_err, config_pda, encumbrance_pda, event_id_soccer,
   netting_pda_for_event, system_owned_empty, wrong_signer, Env,
};
#[test]
fn write_arbitrary_data_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let target = encumbrance_pda();
   let ix = env.agg_ix(
      254,
      vec![1, 2, 3, 4],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new(target, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_ok_record_cu("write_arbitrary_data", &r);
   let acct = env.get_account(&target).expect("encumbrance after write");
   assert_eq!(&acct.data[..4], &[1u8, 2, 3, 4]);
}

#[test]
fn write_arbitrary_data_non_admin() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let target = encumbrance_pda();
   let ix = env.agg_ix(
      254,
      vec![1],
      vec![
         AccountMeta::new(wrong_signer(), true),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new(target, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

/// C-1: wrong `config_pda` pubkey must fail `verify_config_pda` (`InvalidSeeds`).
#[test]
fn write_arbitrary_data_fake_config_pda_regression() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let fake = solana_pubkey::Pubkey::new_from_array([0xC1; 32]);
   env.upsert(fake, system_owned_empty());
   let ix = env.agg_ix(
      254,
      vec![7],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new_readonly(fake, false),
         AccountMeta::new(encumbrance_pda(), false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidSeeds);
}

#[test]
fn force_close_pda_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      255,
      vec![],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_ok_record_cu("force_close_pda", &r);
   assert!(
      env.get_account(&np).map(|a| a.data.is_empty()).unwrap_or(true),
      "netting pda should be closed or absent"
   );
}

#[test]
fn force_close_pda_wrong_admin() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      255,
      vec![],
      vec![
         AccountMeta::new(wrong_signer(), true),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

#[test]
fn force_close_pda_wrong_config_address() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let fake = solana_pubkey::Pubkey::new_from_array([0xFE; 32]);
   env.upsert(fake, system_owned_empty());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      255,
      vec![],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new_readonly(fake, false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidSeeds);
}
