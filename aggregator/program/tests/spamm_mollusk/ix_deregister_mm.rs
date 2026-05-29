//! `deregister_mm` tests.

use solana_instruction::AccountMeta;
use solana_program_pack::Pack;
use spl_token_interface::state::Account as TokenAccount;

use crate::common::{
   address_lookup_table_program_pubkey, admin, assert_encumbrance_discriminator, assert_program_err,
   config_pda, encumbrance_pda, liability_token_ata, lookup_table_pubkey, mm_admin, mm_collateral_ata,
   mm_config_pda, mm_list_pda, mm_list_peer_program, mm_parlay_quote_buffer_pda, mm_program_id,
   mm_quote_buffer_pda, mint_pubkey, patch_mm_list_entries, read_encumbrance, read_mm_list_tail,
   record_cu_success, wrong_signer, Env,
};
use mollusk_svm_programs_token::{associated_token, token};

fn deregister_metas(agg_admin: solana_pubkey::Pubkey, mm_admin_pk: solana_pubkey::Pubkey) -> Vec<AccountMeta> {
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   vec![
      AccountMeta::new(agg_admin, true),
      AccountMeta::new(mm_admin_pk, false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new(mm_list_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(token::ID, false),
      AccountMeta::new_readonly(associated_token::ID, false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new(lookup_table_pubkey(), false),
      AccountMeta::new_readonly(address_lookup_table_program_pubkey(), false),
      AccountMeta::new(mm_collateral_ata(), false),
      AccountMeta::new_readonly(mm_quote_buffer_pda(), false),
      AccountMeta::new_readonly(mm_parlay_quote_buffer_pda(), false),
   ]
}

/// Run `register_mm` on-chain, then assert encumbrance PDA + liability ATA match production layout.
fn setup_register_then_deregister_prep(env: &mut Env) {
   let reg_r = env.bootstrap_mm_registered();
   record_cu_success("register_mm", &reg_r);

   let enc = encumbrance_pda();
   assert_encumbrance_discriminator(env, &enc);
   assert_eq!(read_encumbrance(env, &enc), 0);

   let liab_key = liability_token_ata();
   let liab_acct = env
      .get_account(&liab_key)
      .unwrap_or_else(|| panic!("liability ATA missing after register_mm"));
   assert_eq!(liab_acct.owner, token::ID);
   let liab = TokenAccount::unpack_from_slice(&liab_acct.data).expect("liability ATA unpack");
   assert_eq!(liab.owner, enc);
   assert_eq!(liab.mint, mint_pubkey());

   let (n, addrs) = read_mm_list_tail(env, &mm_list_pda());
   assert_eq!(n, 1);
   assert_eq!(addrs[0], mm_program_id());
}

#[test]
fn deregister_mm_success() {
   let mut env = Env::new();
   setup_register_then_deregister_prep(&mut env);

   let dereg = env.agg_ix(54, vec![], deregister_metas(admin(), mm_admin()));
   let r = env.run_ix(dereg);
   assert!(r.program_result.is_ok(), "deregister_mm {:?}", r);

   let (n, _) = read_mm_list_tail(&env, &mm_list_pda());
   assert_eq!(n, 0);
   assert!(
      env.get_account(&encumbrance_pda())
         .map(|a| a.lamports == 0 && a.data.is_empty())
         .unwrap_or(true),
      "encumbrance PDA should be closed"
   );
   record_cu_success("deregister_mm", &r);
}

#[test]
fn deregister_mm_wrong_aggregator_admin() {
   let mut env = Env::new();
   setup_register_then_deregister_prep(&mut env);

   let dereg = env.agg_ix(54, vec![], deregister_metas(wrong_signer(), mm_admin()));
   let r = env.run_ix(dereg);
   assert_program_err(&r, solana_program_error::ProgramError::IncorrectAuthority);
}

/// Removing index 0 must copy the trailing pubkey with a byte-wise swap (header len is 3 → misaligned `Address`).
#[test]
fn deregister_mm_removes_first_of_two_preserves_peer() {
   let mut env = Env::new();
   setup_register_then_deregister_prep(&mut env);

   let peer = mm_list_peer_program();
   patch_mm_list_entries(
      &mut env,
      &mm_list_pda(),
      &[mm_program_id(), peer],
   );
   let (n, addrs) = read_mm_list_tail(&env, &mm_list_pda());
   assert_eq!(n, 2);
   assert_eq!(addrs[0], mm_program_id());
   assert_eq!(addrs[1], peer);

   let dereg = env.agg_ix(54, vec![], deregister_metas(admin(), mm_admin()));
   let r = env.run_ix(dereg);
   assert!(r.program_result.is_ok(), "deregister_mm {:?}", r);

   let (n, addrs) = read_mm_list_tail(&env, &mm_list_pda());
   assert_eq!(n, 1, "one MM should remain");
   assert_eq!(addrs[0], peer, "remaining entry must be the second pubkey");
   record_cu_success("deregister_mm/first_of_two", &r);
}

#[test]
fn deregister_mm_nonempty_ix_data() {
   let mut env = Env::new();
   setup_register_then_deregister_prep(&mut env);

   let dereg = env.agg_ix(54, vec![1], deregister_metas(admin(), mm_admin()));
   let r = env.run_ix(dereg);
   assert_program_err(&r, solana_program_error::ProgramError::InvalidInstructionData);
}
