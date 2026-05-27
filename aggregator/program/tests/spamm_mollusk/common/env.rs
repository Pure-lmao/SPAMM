//! Mollusk harness: load both BPF artifacts, seed SPL programs, run instructions.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use mollusk_svm::result::{InstructionResult, ProgramResult as MolluskProgramResult};
use mollusk_svm::program::keyed_account_for_system_program;
use mollusk_svm::Mollusk;
use mollusk_svm_programs_token::{associated_token, token};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_program_option::COption;
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use solana_sdk_ids::address_lookup_table;
use spl_token_interface::state::{Account as TokenAccount, AccountState, Mint};

use spamm_aggregator::state::{EventId, EventStateData, MarketId, EVENT_STATE_LEN};
use zeropod::ZeroPodFixed;

use super::fixtures::*;
use super::ledger::record_cu;

/// Serialize `Env::new` so parallel tests do not copy over `spamm_market_maker.so` while Mollusk holds it open (Windows error 32).
static ENV_DEPLOY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Default lamports for funded signers / feepayers.
pub const RICH_LAMPORTS: u64 = 500_000_000_000;

/// User collateral ATA balance after aggregator + MM bootstrap (covers stakes in `fill_*` tests).
pub const USER_COLLATERAL_TOKENS: u64 = 50_000_000_000_000;

/// MM collateral ATA balance after `register_mm` — must cover `fill_quote` liability deposits.
pub const MM_COLLATERAL_TOKENS: u64 = 50_000_000_000_000;

pub fn record_cu_success(name: &str, res: &InstructionResult) {
   if res.program_result.is_ok() {
      record_cu(name, res.compute_units_consumed);
   }
}

/// Panics unless the instruction succeeded, then records CU under `name`.
pub fn assert_ok_record_cu(name: &str, res: &InstructionResult) {
   assert!(
      res.program_result.is_ok(),
      "expected Ok for CU key {name:?}, got {:?} full={res:?}",
      res.program_result
   );
   record_cu_success(name, res);
}

/// Panics unless the instruction succeeded (no CU bookkeeping).
pub fn assert_ix_ok(res: &InstructionResult, label: &str) {
   assert!(
      res.program_result.is_ok(),
      "{label}: expected Ok, got {:?} full={res:?}",
      res.program_result
   );
}

pub fn assert_program_err(res: &InstructionResult, expected: ProgramError) {
   match &res.program_result {
      MolluskProgramResult::Failure(got) => {
         assert_eq!(*got, expected, "unexpected failure: {:?}", res.raw_result);
      }
      other => panic!("expected Failure({expected:?}), got {other:?} full={res:?}"),
   }
}

fn deploy_dir() -> PathBuf {
   PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/deploy")
}

/// Prefer the MM workspace artifact so tests do not run a stale `target/deploy` copy.
fn mm_so_path() -> PathBuf {
   let external = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("../../market_maker/program/target/deploy/spamm_market_maker.so");
   if external.exists() {
      return external;
   }
   deploy_dir().join("spamm_market_maker.so")
}

/// Prefer the alt_stub crate artifact so tests do not run a stale `target/deploy` copy.
fn alt_stub_so_path() -> PathBuf {
   let built = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("tests/spamm_mollusk/alt_stub/target/deploy/spamm_alt_stub.so");
   if built.exists() {
      return built;
   }
   deploy_dir().join("spamm_alt_stub.so")
}

pub fn system_owned_empty() -> Account {
   Account {
      lamports: 0,
      data: vec![],
      owner: solana_sdk_ids::system_program::ID,
      executable: false,
      rent_epoch: 0,
   }
}

pub fn rich_signer_account() -> Account {
   Account {
      lamports: RICH_LAMPORTS,
      data: vec![],
      owner: solana_sdk_ids::system_program::ID,
      executable: false,
      rent_epoch: 0,
   }
}

/// Shared test environment.
pub struct Env {
   pub mollusk: Mollusk,
   pub accounts: Vec<(Pubkey, Account)>,
}

impl Env {
   pub fn new() -> Self {
      let _deploy_lock = ENV_DEPLOY_LOCK
         .get_or_init(|| Mutex::new(()))
         .lock()
         .expect("Env deploy mutex poisoned");
      let deploy = deploy_dir();
      std::env::set_var("SBF_OUT_DIR", deploy.to_string_lossy().as_ref());
      let agg_so = deploy.join("spamm_aggregator.so");
      let alt_src = alt_stub_so_path();
      let mm_src = mm_so_path();
      let mm_deploy = deploy.join("spamm_market_maker.so");
      if mm_src != mm_deploy {
         std::fs::copy(&mm_src, &mm_deploy).unwrap_or_else(|e| {
            panic!("copy MM artifact {:?} -> {:?}: {}", mm_src, mm_deploy, e);
         });
      }
      if !agg_so.exists() || !mm_deploy.exists() || !alt_src.exists() {
         panic!(
            "Missing SBF artifacts.\nExpected aggregator:\n  {:?}\nMM (after sync):\n  {:?}\nALT stub:\n  {:?}\nBuild with:\n  cargo build-sbf --manifest-path aggregator/program/Cargo.toml\n  cargo build-sbf --manifest-path market_maker/program/Cargo.toml\n  cargo build-sbf --manifest-path aggregator/program/tests/spamm_mollusk/alt_stub/Cargo.toml",
            agg_so, mm_deploy, alt_src
         );
      }

      let alt_deploy = deploy.join("spamm_alt_stub.so");
      let alt_built = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
         .join("tests/spamm_mollusk/alt_stub/target/deploy/spamm_alt_stub.so");
      let alt_copy_src = if alt_built.exists() { alt_built } else { alt_src };
      if alt_copy_src != alt_deploy {
         std::fs::copy(&alt_copy_src, &alt_deploy).unwrap_or_else(|e| {
            panic!("copy ALT stub {:?} -> {:?}: {}", alt_copy_src, alt_deploy, e);
         });
      }

      let mut mollusk = Mollusk::new(&agg_program_id(), "spamm_aggregator");
      mollusk.add_program(&mm_program_id(), "spamm_market_maker");
      mollusk.add_program(&address_lookup_table::id(), "spamm_alt_stub");
      token::add_program(&mut mollusk);
      associated_token::add_program(&mut mollusk);

      Self {
         mollusk,
         accounts: Vec::new(),
      }
   }

   pub fn upsert(&mut self, key: Pubkey, account: Account) {
      if let Some(i) = self.accounts.iter().position(|(k, _)| *k == key) {
         self.accounts[i] = (key, account);
      } else {
         self.accounts.push((key, account));
      }
   }

   pub fn get_account(&self, key: &Pubkey) -> Option<&Account> {
      self.accounts.iter().find(|(k, _)| k == key).map(|(_, a)| a)
   }

   /// Run any instruction; replaces account set with Mollusk output.
   pub fn run_ix(&mut self, ix: Instruction) -> InstructionResult {
      let loader = solana_sdk_ids::bpf_loader_upgradeable::id();
      let stub = Account {
         lamports: 1,
         data: vec![],
         owner: loader,
         executable: true,
         rent_epoch: 0,
      };
      if self.get_account(&mm_program_id()).is_none() {
         self.upsert(mm_program_id(), stub.clone());
      }
      if self.get_account(&agg_program_id()).is_none() {
         self.upsert(agg_program_id(), stub.clone());
      }
      let alt_id = address_lookup_table::id();
      if self.get_account(&alt_id).is_none() {
         self.upsert(alt_id, stub);
      }
      let (ix_sysvar_pk, ix_sysvar_acct) =
         mollusk_svm::instructions_sysvar::keyed_account(core::iter::once(&ix));
      self.upsert(ix_sysvar_pk, ix_sysvar_acct);
      let res = self
         .mollusk
         .process_instruction(&ix, self.accounts.as_slice());
      self.accounts = res.resulting_accounts.clone();
      res
   }

   pub fn agg_ix(&self, disc: u8, data: Vec<u8>, metas: Vec<AccountMeta>) -> Instruction {
      let mut buf = vec![disc];
      buf.extend_from_slice(&data);
      Instruction::new_with_bytes(agg_program_id(), &buf, metas)
   }

   pub fn mm_ix(&self, disc: u8, data: Vec<u8>, metas: Vec<AccountMeta>) -> Instruction {
      let mut buf = vec![disc];
      buf.extend_from_slice(&data);
      Instruction::new_with_bytes(mm_program_id(), &buf, metas)
   }

   /// Minimal SPL + actors + mint + user ATA; aggregator `init_program` + unpause. No MM.
   pub fn bootstrap_agg_only(&mut self) {
      let (sys_pk, sys_acct) = keyed_account_for_system_program();
      let (tok_pk, tok_acct) = token::keyed_account();
      let (ata_pk, ata_acct) = associated_token::keyed_account();

      self.accounts = vec![
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
      self.upsert(mint_pubkey(), mint_acct);

      let user_ata_key = user_collateral_ata();
      let user_tok = token::create_account_for_token_account(TokenAccount {
         mint: mint_pubkey(),
         owner: user(),
         amount: USER_COLLATERAL_TOKENS,
         delegate: COption::None,
         state: AccountState::Initialized,
         is_native: COption::None,
         delegated_amount: 0,
         close_authority: COption::None,
      });
      self.upsert(user_ata_key, user_tok);

      self.upsert(config_pda(), system_owned_empty());
      self.upsert(mm_list_pda(), system_owned_empty());
      self.upsert(lookup_table_pubkey(), system_owned_empty());

      let init = self.agg_ix(
         0,
         init_program_ix_data(),
         init_program_account_metas(admin(), true, sys_pk),
      );
      let r = self.run_ix(init);
      assert!(r.program_result.is_ok(), "init_program {:?}", r);

      let unpause = self.agg_ix(
         1,
         vec![1u8],
         vec![
            AccountMeta::new(admin(), true),
            AccountMeta::new(config_pda(), false),
         ],
      );
      let r2 = self.run_ix(unpause);
      assert!(r2.program_result.is_ok(), "change_config active {:?}", r2);
   }

   /// MM `init_program` + `init_event` + `init_market` (aggregator must already be initialised + active).
   pub fn prepare_mm_for_register(&mut self, markets: &[(MarketId, &[u8])]) {
      let sys_pk = keyed_account_for_system_program().0;
      let tok_pk = token::ID;
      let ata_pk = associated_token::ID;

      self.upsert(mm_config_pda(), system_owned_empty());
      self.upsert(mm_quote_buffer_pda(), system_owned_empty());
      self.upsert(mm_parlay_quote_buffer_pda(), system_owned_empty());
      let mm_tok_ata = mm_collateral_ata();
      self.upsert(mm_tok_ata, system_owned_empty());

      let mut admin_bytes = [0u8; 32];
      admin_bytes.copy_from_slice(mm_admin().as_ref());
      let mm_init = self.mm_ix(
         1,
         admin_bytes.to_vec(),
         vec![
            AccountMeta::new(mm_admin(), true),
            AccountMeta::new(mm_config_pda(), false),
            AccountMeta::new(mm_quote_buffer_pda(), false),
            AccountMeta::new(mm_parlay_quote_buffer_pda(), false),
            AccountMeta::new(mm_tok_ata, false),
            AccountMeta::new_readonly(mint_pubkey(), false),
            AccountMeta::new_readonly(tok_pk, false),
            AccountMeta::new_readonly(ata_pk, false),
            AccountMeta::new_readonly(sys_pk, false),
         ],
      );
      let r = self.run_ix(mm_init);
      assert!(r.program_result.is_ok(), "mm init_program {:?}", r);

      let mut seen_events = std::collections::HashSet::new();
      for (mid, _body) in markets {
         let eid = mid.event_id;
         let key = (eid.event, eid.league, eid.sport as u8);
         if seen_events.insert(key) {
            let es = event_state_pda(&eid);
            self.upsert(es, system_owned_empty());
            let ev_wire = eid.as_wire_bytes().to_vec();
            let ev_ix = self.mm_ix(
               9,
               ev_wire,
               vec![
                  AccountMeta::new(mm_admin(), true),
                  AccountMeta::new_readonly(mm_config_pda(), false),
                  AccountMeta::new(es, false),
                  AccountMeta::new_readonly(sys_pk, false),
               ],
            );
            let re = self.run_ix(ev_ix);
            assert!(re.program_result.is_ok(), "mm init_event {:?}", re);
            self.patch_event_state_sequence(&eid, 1);
         }
      }

      for (mid, oracle_body) in markets {
         let md = market_data_pda(mid);
         self.upsert(md, system_owned_empty());
         let mut data = Vec::with_capacity(MarketId::WIRE_SIZE + oracle_body.len());
         data.extend_from_slice(&market_id_wire_bytes(mid));
         data.extend_from_slice(oracle_body);
         let m_ix = self.mm_ix(
            10,
            data,
            vec![
               AccountMeta::new(mm_admin(), true),
               AccountMeta::new_readonly(mm_config_pda(), false),
               AccountMeta::new(md, false),
               AccountMeta::new_readonly(sys_pk, false),
            ],
         );
         let rm = self.run_ix(m_ix);
         assert!(rm.program_result.is_ok(), "mm init_market {:?}", rm);
      }
   }

   /// Set SPL token `amount` on an initialized ATA (Mollusk-only; avoids full MintTo CPI wiring).
   pub fn patch_spl_token_balance(&mut self, ata_key: Pubkey, amount: u64) {
      let mut acct = self
         .get_account(&ata_key)
         .unwrap_or_else(|| panic!("patch_spl_token_balance: missing account {ata_key}"))
         .clone();
      let mut parsed =
         TokenAccount::unpack_from_slice(&acct.data).expect("patch_spl_token_balance: unpack");
      parsed.amount = amount;
      let mut data = vec![0u8; TokenAccount::LEN];
      parsed.pack_into_slice(&mut data);
      acct.data = data;
      self.upsert(ata_key, acct);
   }

   /// After `register_mm`, fund user stake + MM collateral so `fill_bet` / `fill_parlay` can move tokens.
   pub fn seed_fill_token_balances(&mut self) {
      self.patch_spl_token_balance(user_collateral_ata(), USER_COLLATERAL_TOKENS);
      self.patch_spl_token_balance(mm_collateral_ata(), MM_COLLATERAL_TOKENS);
   }

   /// Account metas for aggregator `register_mm` (disc 2).
   pub fn register_mm_metas() -> Vec<AccountMeta> {
      let sys_pk = keyed_account_for_system_program().0;
      vec![
         AccountMeta::new(mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(mm_config_pda(), false),
         AccountMeta::new(encumbrance_pda(), false),
         AccountMeta::new(liability_token_ata(), false),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new(mm_list_pda(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
         AccountMeta::new_readonly(associated_token::ID, false),
         AccountMeta::new_readonly(sys_pk, false),
         AccountMeta::new(lookup_table_pubkey(), false),
         AccountMeta::new_readonly(address_lookup_table_program_pubkey(), false),
         AccountMeta::new_readonly(mm_collateral_ata(), false),
         AccountMeta::new_readonly(mm_quote_buffer_pda(), false),
         AccountMeta::new_readonly(mm_parlay_quote_buffer_pda(), false),
      ]
   }

   /// Seed empty encumbrance + liability slots, then run on-chain `register_mm` (creates PDA + ATA + ALT extend).
   pub fn register_mm_execute(&mut self) -> InstructionResult {
      self.upsert(encumbrance_pda(), system_owned_empty());
      self.upsert(liability_token_ata(), system_owned_empty());
      let reg = self.agg_ix(2, vec![], Self::register_mm_metas());
      self.run_ix(reg)
   }

   /// Aggregator active + MM program init + `register_mm` only (no events/markets/fills).
   pub fn bootstrap_mm_registered(&mut self) -> InstructionResult {
      self.bootstrap_agg_only();
      self.prepare_mm_for_register(&[]);
      let rr = self.register_mm_execute();
      assert!(rr.program_result.is_ok(), "register_mm {:?}", rr);
      rr
   }

   /// Full path: agg + MM program init + `init_event` + `init_market` for each market + `register_mm`.
   pub fn bootstrap_mm_with_markets(&mut self, markets: &[(MarketId, &[u8])]) -> InstructionResult {
      self.bootstrap_agg_only();
      self.prepare_mm_for_register(markets);
      let rr = self.register_mm_execute();
      assert!(rr.program_result.is_ok(), "register_mm {:?}", rr);
      self.seed_fill_token_balances();
      rr
   }

   /// One spread market (pregame) on `event_id_soccer`, odds 2.0 / 2.0 scaled.
   pub fn bootstrap_default_mm_spread(&mut self) {
      let eid = event_id_soccer();
      let mid = market_spread_pregame(eid);
      let body = oracle_body_two_outcome(20_000, 20_000);
      let _ = self.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   }

   pub fn create_netting_for_event(&mut self, eid: &EventId) {
      let sys_pk = keyed_account_for_system_program().0;
      let np = netting_pda_for_event(eid);
      self.upsert(np, system_owned_empty());
      let data = eid.as_wire_bytes().to_vec();
      let ix = self.agg_ix(
         50,
         data,
         vec![
            AccountMeta::new(mm_admin(), true),
            AccountMeta::new_readonly(mm_config_pda(), false),
            AccountMeta::new_readonly(mm_program_id(), false),
            AccountMeta::new(np, false),
            AccountMeta::new_readonly(sys_pk, false),
         ],
      );
      let r = self.run_ix(ix);
      assert!(r.program_result.is_ok(), "create_netting {:?}", r);
   }

   pub fn create_netting_for_soccer_event(&mut self) {
      self.create_netting_for_event(&event_id_soccer());
   }

   /// Rewrite `EventStateData.sequence` for devnet/MM-bootstrapped event state (live vs pregame tests).
   pub fn patch_event_state_sequence(&mut self, eid: &EventId, sequence: u16) {
      let pk = event_state_pda(eid);
      let mut acct = self
         .get_account(&pk)
         .unwrap_or_else(|| panic!("patch_event_state_sequence: missing event state {pk}"))
         .clone();
      if acct.data.len() > EVENT_STATE_LEN {
         acct.data.truncate(EVENT_STATE_LEN);
      }
      assert_eq!(
         acct.data.len(),
         EVENT_STATE_LEN,
         "event_state len (expected on-chain wire size)"
      );
      let zc = <EventStateData as ZeroPodFixed>::from_bytes_mut(&mut acct.data).unwrap_or_else(
         |e| panic!("patch_event_state_sequence: invalid event_state wire {e:?}"),
      );
      zc.sequence.set(sequence);
      self.upsert(pk, acct);
   }
}
