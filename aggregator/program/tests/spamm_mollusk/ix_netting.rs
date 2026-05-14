//! Netting account lifecycle.

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;

use spamm_aggregator::instructions::{
   AddLineToLiabilityNettingIxData, RemoveLineFromLiabilityNettingIxData, ADD_LINE_TO_LIABILITY_NETTING_IX_LEN,
   REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN,
};

use crate::common::{
   admin, assert_ok_record_cu, assert_program_err, assert_netting_pda_initialized, config_pda, event_id_soccer,
   mm_admin, mm_config_pda, mm_program_id, netting_pda_for_event, read_netting_lines_snapshot,
   record_cu_success, system_owned_empty, wrong_signer, Env,
};

#[test]
fn create_netting_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let np = netting_pda_for_event(&event_id_soccer());
   env.upsert(np, system_owned_empty());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      50,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_ok_record_cu("create_netting_account", &r);
   assert_netting_pda_initialized(&env, &np, &event_id_soccer());
}

#[test]
fn create_netting_twice_fails() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      50,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn add_line_success_sorted() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let add = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 200,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix = env.agg_ix(
      51,
      w.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
      ],
   );
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok());
   let np = netting_pda_for_event(&event_id_soccer());
   let (n, lines) = read_netting_lines_snapshot(&env, &np);
   assert_eq!(n, 1);
   assert_eq!(lines, vec![(1u8, 200u16)]);
   record_cu_success("add_line_to_netting_account", &r);
}

#[test]
fn add_line_rejects_header_soccer_ft() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let add = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 1,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix = env.agg_ix(
      51,
      w.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn remove_line_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let add = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 200,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix_add = env.agg_ix(
      51,
      w.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
      ],
   );
   assert!(env.run_ix(ix_add).program_result.is_ok());

   let rem = RemoveLineFromLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 200,
   };
   let mut wr = [0u8; REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN];
   rem.write_wire(&mut wr).unwrap();
   let ix_rem = env.agg_ix(
      52,
      wr.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
      ],
   );
   let r = env.run_ix(ix_rem);
   assert!(r.program_result.is_ok());
   let (n, lines) = read_netting_lines_snapshot(&env, &np);
   assert_eq!(n, 0);
   assert!(lines.is_empty());
   record_cu_success("remove_line_from_netting_account", &r);
}

#[test]
fn close_netting_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      53,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok());
   assert!(
      env.get_account(&np).map(|a| a.data.is_empty()).unwrap_or(true),
      "netting pda should be closed or absent"
   );
   record_cu_success("close_netting_account", &r);
}

#[test]
fn add_line_second_line_records_cu() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());

   let add1 = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 200,
   };
   let mut w1 = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add1.write_wire(&mut w1).unwrap();
   assert!(env
      .run_ix(env.agg_ix(
         51,
         w1.to_vec(),
         vec![
            AccountMeta::new(mm_admin(), true),
            AccountMeta::new_readonly(mm_program_id(), false),
            AccountMeta::new_readonly(mm_config_pda(), false),
            AccountMeta::new(np, false),
         ],
      ))
      .program_result
      .is_ok());

   let add2 = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 201,
   };
   let mut w2 = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add2.write_wire(&mut w2).unwrap();
   let r2 = env.run_ix(env.agg_ix(
      51,
      w2.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
      ],
   ));
   assert!(r2.program_result.is_ok(), "{:?}", r2);
   let (n, lines) = read_netting_lines_snapshot(&env, &np);
   assert_eq!(n, 2);
   assert_eq!(lines, vec![(1u8, 200u16), (1u8, 201u16)]);
   record_cu_success("add_line_to_netting_account/second_line", &r2);
}

#[test]
fn remove_line_second_line_records_cu() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   for mkt in [200u16, 201u16] {
      let add = AddLineToLiabilityNettingIxData {
         event_id: event_id_soccer(),
         period: 1,
         mkt,
      };
      let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
      add.write_wire(&mut w).unwrap();
      assert!(env
         .run_ix(env.agg_ix(
            51,
            w.to_vec(),
            vec![
               AccountMeta::new(mm_admin(), true),
               AccountMeta::new_readonly(mm_program_id(), false),
               AccountMeta::new_readonly(mm_config_pda(), false),
               AccountMeta::new(np, false),
            ],
         ))
         .program_result
         .is_ok());
   }
   let rem = RemoveLineFromLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 201,
   };
   let mut wr = [0u8; REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN];
   rem.write_wire(&mut wr).unwrap();
   let r = env.run_ix(env.agg_ix(
      52,
      wr.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
      ],
   ));
   assert!(r.program_result.is_ok(), "{:?}", r);
   let (n, lines) = read_netting_lines_snapshot(&env, &np);
   assert_eq!(n, 1);
   assert_eq!(lines, vec![(1u8, 200u16)]);
   record_cu_success("remove_line_from_netting_account/second_line", &r);
}

#[test]
fn create_netting_after_force_close_records_cu() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let close_ix = env.agg_ix(
      255,
      vec![],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   assert!(env.run_ix(close_ix).program_result.is_ok());
   env.upsert(np, system_owned_empty());
   let create_ix = env.agg_ix(
      50,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(create_ix);
   assert_ok_record_cu("init_program/post_force_close_reinit", &r);
   assert_netting_pda_initialized(&env, &np, &event_id_soccer());
}

#[test]
fn create_netting_wrong_mm_admin_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let np = netting_pda_for_event(&event_id_soccer());
   env.upsert(np, system_owned_empty());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      50,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(wrong_signer(), true),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

#[test]
fn create_netting_non_executable_mm_program_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let np = netting_pda_for_event(&event_id_soccer());
   env.upsert(np, system_owned_empty());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      50,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new_readonly(wrong_signer(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountOwner);
}

#[test]
fn create_netting_bad_event_id_len_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let np = netting_pda_for_event(&event_id_soccer());
   env.upsert(np, system_owned_empty());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      50,
      vec![1, 2],
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn create_netting_wrong_netting_pda_address_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let bad = solana_pubkey::Pubkey::new_from_array([0x99; 32]);
   env.upsert(bad, system_owned_empty());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      50,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(bad, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidSeeds);
}

#[test]
fn add_line_duplicate_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let add = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 200,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let metas = vec![
      AccountMeta::new(mm_admin(), true),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new(np, false),
   ];
   assert!(env.run_ix(env.agg_ix(51, w.to_vec(), metas.clone())).program_result.is_ok());
   let r = env.run_ix(env.agg_ix(51, w.to_vec(), metas));
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn add_line_netting_missing_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let fake = solana_pubkey::Pubkey::new_from_array([0x77; 32]);
   env.upsert(fake, system_owned_empty());
   let add = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 200,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix = env.agg_ix(
      51,
      w.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(fake, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountOwner);
}

#[test]
fn add_line_wrong_admin_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let add = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 200,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix = env.agg_ix(
      51,
      w.to_vec(),
      vec![
         AccountMeta::new(wrong_signer(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

#[test]
fn add_line_bad_ix_len_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let ix = env.agg_ix(
      51,
      vec![1, 2, 3],
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn remove_line_never_added_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let add = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 200,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   assert!(env
      .run_ix(env.agg_ix(
         51,
         w.to_vec(),
         vec![
            AccountMeta::new(mm_admin(), true),
            AccountMeta::new_readonly(mm_program_id(), false),
            AccountMeta::new_readonly(mm_config_pda(), false),
            AccountMeta::new(np, false),
         ],
      ))
      .program_result
      .is_ok());
   let rem = RemoveLineFromLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 999,
   };
   let mut wr = [0u8; REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN];
   rem.write_wire(&mut wr).unwrap();
   let ix = env.agg_ix(
      52,
      wr.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn remove_line_wrong_admin_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let add = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 200,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   assert!(env
      .run_ix(env.agg_ix(
         51,
         w.to_vec(),
         vec![
            AccountMeta::new(mm_admin(), true),
            AccountMeta::new_readonly(mm_program_id(), false),
            AccountMeta::new_readonly(mm_config_pda(), false),
            AccountMeta::new(np, false),
         ],
      ))
      .program_result
      .is_ok());
   let rem = RemoveLineFromLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 200,
   };
   let mut wr = [0u8; REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN];
   rem.write_wire(&mut wr).unwrap();
   let ix = env.agg_ix(
      52,
      wr.to_vec(),
      vec![
         AccountMeta::new(wrong_signer(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

#[test]
fn close_netting_wrong_admin_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      53,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(wrong_signer(), true),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

#[test]
fn close_netting_uninitialized_pda_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let fake = solana_pubkey::Pubkey::new_from_array([0x88; 32]);
   env.upsert(fake, system_owned_empty());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      53,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new(fake, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountOwner);
}
