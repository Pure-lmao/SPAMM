//! Netting account lifecycle.

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;

use spamm_aggregator::instructions::{
   AddLineToLiabilityNettingIxData, FillBetIxData, RemoveLineFromLiabilityNettingIxData,
   ADD_LINE_TO_LIABILITY_NETTING_IX_LEN, REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN,
};
use spamm_aggregator::state::EventGameState;

use spamm_aggregator::state::{NETTING_ACCOUNT_ALLOC_LEN, NETTING_HEADER_LEN, NETTING_LINE_LEN};

use crate::common::{
   admin, assert_ok_record_cu, assert_program_err, assert_netting_pda_initialized, bet_pda_for, bet_token_ata,
   config_pda, event_id_soccer, fill_bet_instruction, market_spread_pregame, mm_admin, mm_config_pda,
   mm_program_id, netting_pda_for_event, read_netting_lines_snapshot, read_netting_soccer_header_and_lines,
   record_cu_success, rent_sysvar_pubkey, system_owned_empty, user, wrong_signer, Env,
};

#[test]
fn create_netting_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let np = netting_pda_for_event(&event_id_soccer());
   env.upsert(np, system_owned_empty());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      40,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
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
      40,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
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
      mkt: 400,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix = env.agg_ix(
      41,
      w.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(
            mollusk_svm::program::keyed_account_for_system_program().0,
            false,
         ),
      ],
   );
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok());
   let np = netting_pda_for_event(&event_id_soccer());
   let (n, lines) = read_netting_lines_snapshot(&env, &np);
   assert_eq!(n, 1);
   assert_eq!(lines, vec![(1u8, 400u16)]);
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
      41,
      w.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(
            mollusk_svm::program::keyed_account_for_system_program().0,
            false,
         ),
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
      mkt: 400,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix_add = env.agg_ix(
      41,
      w.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(
            mollusk_svm::program::keyed_account_for_system_program().0,
            false,
         ),
      ],
   );
   assert!(env.run_ix(ix_add).program_result.is_ok());

   let rem = RemoveLineFromLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 400,
   };
   let mut wr = [0u8; REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN];
   rem.write_wire(&mut wr).unwrap();
   let ix_rem = env.agg_ix(
      42,
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
      43,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
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
      mkt: 400,
   };
   let mut w1 = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add1.write_wire(&mut w1).unwrap();
   assert!(env
      .run_ix(env.agg_ix(
         41,
         w1.to_vec(),
         vec![
            AccountMeta::new(mm_admin(), true),
            AccountMeta::new_readonly(mm_program_id(), false),
            AccountMeta::new_readonly(mm_config_pda(), false),
            AccountMeta::new(np, false),
            AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
            AccountMeta::new_readonly(
               mollusk_svm::program::keyed_account_for_system_program().0,
               false,
            ),
         ],
      ))
      .program_result
      .is_ok());

   let add2 = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 401,
   };
   let mut w2 = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add2.write_wire(&mut w2).unwrap();
   let r2 = env.run_ix(env.agg_ix(
      41,
      w2.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(
            mollusk_svm::program::keyed_account_for_system_program().0,
            false,
         ),
      ],
   ));
   assert!(r2.program_result.is_ok(), "{:?}", r2);
   let (n, lines) = read_netting_lines_snapshot(&env, &np);
   assert_eq!(n, 2);
   assert_eq!(lines, vec![(1u8, 400u16), (1u8, 401u16)]);
   record_cu_success("add_line_to_netting_account/second_line", &r2);
}

#[test]
fn remove_line_second_line_records_cu() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   for mkt in [400u16, 401u16] {
      let add = AddLineToLiabilityNettingIxData {
         event_id: event_id_soccer(),
         period: 1,
         mkt,
      };
      let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
      add.write_wire(&mut w).unwrap();
      assert!(env
         .run_ix(env.agg_ix(
            41,
            w.to_vec(),
            vec![
               AccountMeta::new(mm_admin(), true),
               AccountMeta::new_readonly(mm_program_id(), false),
               AccountMeta::new_readonly(mm_config_pda(), false),
               AccountMeta::new(np, false),
               AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
               AccountMeta::new_readonly(
                  mollusk_svm::program::keyed_account_for_system_program().0,
                  false,
               ),
            ],
         ))
         .program_result
         .is_ok());
   }
   let rem = RemoveLineFromLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 401,
   };
   let mut wr = [0u8; REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN];
   rem.write_wire(&mut wr).unwrap();
   let r = env.run_ix(env.agg_ix(
      42,
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
   assert_eq!(lines, vec![(1u8, 400u16)]);
   record_cu_success("remove_line_from_netting_account/second_line", &r);
}

#[test]
#[cfg(feature = "devnet")]
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
      40,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
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
      40,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(wrong_signer(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
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
      40,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(wrong_signer(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
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
      40,
      vec![1, 2],
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
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
      40,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(bad, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
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
      mkt: 400,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let metas = vec![
      AccountMeta::new(mm_admin(), true),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new(np, false),
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(
         mollusk_svm::program::keyed_account_for_system_program().0,
         false,
      ),
   ];
   assert!(env.run_ix(env.agg_ix(41, w.to_vec(), metas.clone())).program_result.is_ok());
   let r = env.run_ix(env.agg_ix(41, w.to_vec(), metas));
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn add_line_first_half_period_ok() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let add = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 2,
      mkt: 400,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let metas = vec![
      AccountMeta::new(mm_admin(), true),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new(np, false),
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(
         mollusk_svm::program::keyed_account_for_system_program().0,
         false,
      ),
   ];
   let r = env.run_ix(env.agg_ix(41, w.to_vec(), metas));
   assert!(r.program_result.is_ok(), "{:?}", r.program_result);
   let (_, lines) = read_netting_soccer_header_and_lines(&env, &np);
   assert_eq!(lines.len(), 1);
   assert_eq!(lines[0].0, 2);
   assert_eq!(lines[0].1, 400);
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
      mkt: 400,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix = env.agg_ix(
      41,
      w.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(fake, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(
            mollusk_svm::program::keyed_account_for_system_program().0,
            false,
         ),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
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
      mkt: 400,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix = env.agg_ix(
      41,
      w.to_vec(),
      vec![
         AccountMeta::new(wrong_signer(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(
            mollusk_svm::program::keyed_account_for_system_program().0,
            false,
         ),
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
      41,
      vec![1, 2, 3],
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(
            mollusk_svm::program::keyed_account_for_system_program().0,
            false,
         ),
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
      mkt: 400,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   assert!(env
      .run_ix(env.agg_ix(
         41,
         w.to_vec(),
         vec![
            AccountMeta::new(mm_admin(), true),
            AccountMeta::new_readonly(mm_program_id(), false),
            AccountMeta::new_readonly(mm_config_pda(), false),
            AccountMeta::new(np, false),
            AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
            AccountMeta::new_readonly(
               mollusk_svm::program::keyed_account_for_system_program().0,
               false,
            ),
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
      42,
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
      mkt: 400,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   assert!(env
      .run_ix(env.agg_ix(
         41,
         w.to_vec(),
         vec![
            AccountMeta::new(mm_admin(), true),
            AccountMeta::new_readonly(mm_program_id(), false),
            AccountMeta::new_readonly(mm_config_pda(), false),
            AccountMeta::new(np, false),
            AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
            AccountMeta::new_readonly(
               mollusk_svm::program::keyed_account_for_system_program().0,
               false,
            ),
         ],
      ))
      .program_result
      .is_ok());
   let rem = RemoveLineFromLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 400,
   };
   let mut wr = [0u8; REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN];
   rem.write_wire(&mut wr).unwrap();
   let ix = env.agg_ix(
      42,
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
      43,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(wrong_signer(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
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
      43,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(fake, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

fn run_add_line(
   env: &mut Env,
   np: solana_pubkey::Pubkey,
   period: u8,
   mkt: u16,
) -> mollusk_svm::result::InstructionResult {
   let add = AddLineToLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period,
      mkt,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   env.run_ix(env.agg_ix(
      41,
      w.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(
            mollusk_svm::program::keyed_account_for_system_program().0,
            false,
         ),
      ],
   ))
}

#[test]
fn add_line_resizes_past_create_capacity() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&event_id_soccer());
   let mut last = None;
   for mkt in 51u16..=61 {
      let r = run_add_line(&mut env, np, 1, mkt);
      assert!(
         r.program_result.is_ok(),
         "add_line mkt {mkt} {:?}",
         r.program_result
      );
      last = Some(r);
   }
   let r = last.expect("11 add_line ixs");
   let (n, lines) = read_netting_lines_snapshot(&env, &np);
   assert_eq!(n, 11);
   assert_eq!(lines.len(), 11);
   let acct = env.get_account(&np).expect("netting after resize");
   assert_eq!(
      acct.data.len(),
      NETTING_HEADER_LEN + 11 * NETTING_LINE_LEN
   );
   record_cu_success("add_line_to_netting_account/resize_11", &r);
}

#[test]
fn fill_bet_resizes_netting_on_eleventh_line() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let eid = event_id_soccer();
   let np = netting_pda_for_event(&eid);
   for mkt in 51u16..=60 {
      let r = run_add_line(&mut env, np, 1, mkt);
      assert!(
         r.program_result.is_ok(),
         "add_line mkt {mkt} {:?}",
         r.program_result
      );
   }
   let acct0 = env.get_account(&np).expect("netting at create size");
   assert_eq!(acct0.data.len(), NETTING_ACCOUNT_ALLOC_LEN);
   let (n0, _) = read_netting_lines_snapshot(&env, &np);
   assert_eq!(n0, 10);

   let mid = market_spread_pregame(eid);
   let bet = bet_pda_for(&user(), 801);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 801,
      market_id: mid,
      side: 0,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_bet_instruction(&data, bet, bat, &mid, np));
   assert_ok_record_cu("fill_bet/netting_realloc_11", &r);

   let (n, lines) = read_netting_lines_snapshot(&env, &np);
   assert_eq!(n, 11);
   assert!(lines.contains(&(1u8, 400u16)));
   let acct = env.get_account(&np).expect("netting after fill realloc");
   assert_eq!(
      acct.data.len(),
      NETTING_HEADER_LEN + 11 * NETTING_LINE_LEN
   );
}

fn fill_spread_into_netting(env: &mut Env) {
   env.bootstrap_default_mm_spread();
   env.create_netting_for_soccer_event();
   let eid = event_id_soccer();
   let mid = market_spread_pregame(eid);
   let np = netting_pda_for_event(&eid);
   let bet = bet_pda_for(&user(), 800);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 800,
      market_id: mid,
      side: 0,
      amount: 5_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(
      env.run_ix(fill_bet_instruction(&data, bet, bat, &mid, np))
         .program_result
         .is_ok()
   );
}

#[test]
fn remove_line_with_open_profit_rejected() {
   let mut env = Env::new();
   fill_spread_into_netting(&mut env);
   let np = netting_pda_for_event(&event_id_soccer());
   let rem = RemoveLineFromLiabilityNettingIxData {
      event_id: event_id_soccer(),
      period: 1,
      mkt: 400,
   };
   let mut wr = [0u8; REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN];
   rem.write_wire(&mut wr).unwrap();
   let ix = env.agg_ix(
      42,
      wr.to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
      ],
   );
   assert_program_err(&env.run_ix(ix), ProgramError::InvalidAccountData);
}

#[test]
fn close_netting_with_open_profit_rejected() {
   let mut env = Env::new();
   fill_spread_into_netting(&mut env);
   let np = netting_pda_for_event(&event_id_soccer());
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let ix = env.agg_ix(
      43,
      event_id_soccer().as_wire_bytes().to_vec(),
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(np, false),
         AccountMeta::new_readonly(sys, false),
      ],
   );
   assert_program_err(&env.run_ix(ix), ProgramError::InvalidAccountData);
}
