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
use spl_token_interface::state::{Account as TokenAccount, AccountState, Mint};

use spamm_aggregator::constants::{ADDRESS_LEN, U64_LEN};
use spamm_aggregator::state::{EventId, EventStateData, MarketId, EVENT_STATE_HEADER_LEN};
use zeropod::ZeroPodFixed;

use super::fixtures::*;
use super::ledger::record_cu;
use super::mm_keys::{
   adversarial_mm_program_id, mm_alt_program_id, user_b, user_b_collateral_ata, MmKeys, EXTRA_MM_SLOTS,
};

/// Serialize `Env::new` so parallel tests do not copy over `spamm_market_maker.so` while Mollusk holds it open (Windows error 32).
static ENV_DEPLOY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Default lamports for funded signers / feepayers.
pub const RICH_LAMPORTS: u64 = 500_000_000_000;

/// User collateral ATA balance after aggregator + MM bootstrap (covers stakes in `fill_*` tests).
pub const USER_COLLATERAL_TOKENS: u64 = 50_000_000_000_000;

/// MM collateral ATA balance after `register_mm` — must cover `fill_bet_quote` liability deposits.
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

/// Snapshot of lamports + SPL amount + raw data for failure-path accretion checks.
#[derive(Clone)]
pub struct AccountSnapshot {
   pub key: Pubkey,
   pub lamports: u64,
   pub token_amount: Option<u64>,
   pub data: Vec<u8>,
   pub owner: Pubkey,
}

/// Assert a [`spamm_aggregator::errors::SpammError`] custom code.
pub fn assert_spamm_err(res: &InstructionResult, err: spamm_aggregator::errors::SpammError) {
   assert_program_err(res, ProgramError::Custom(err as u32));
}

fn deploy_dir() -> PathBuf {
   PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/deploy")
}

/// Prefer the newest MM `.so` among workspace build outputs (deploy dir can lag `sbpfv3` release).
fn mm_so_path() -> PathBuf {
   let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
   let candidates = [
      manifest.join("../../market_maker/program/target/deploy/spamm_market_maker.so"),
      manifest.join("../../market_maker/program/target/sbpfv3-solana-solana/release/spamm_market_maker.so"),
      manifest.join("target/deploy/spamm_market_maker.so"),
      manifest.join("target/sbpfv3-solana-solana/release/spamm_market_maker.so"),
   ];
   newest_existing_path(&candidates).unwrap_or_else(|| deploy_dir().join("spamm_market_maker.so"))
}

fn adversarial_so_path() -> PathBuf {
   let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
   let candidates = [
      manifest.join("tests/adversarial_mm/target/deploy/spamm_adversarial_mm.so"),
      manifest.join("tests/adversarial_mm/target/sbpfv3-solana-solana/release/spamm_adversarial_mm.so"),
      manifest.join("target/deploy/spamm_adversarial_mm.so"),
   ];
   newest_existing_path(&candidates).unwrap_or_else(|| deploy_dir().join("spamm_adversarial_mm.so"))
}
fn agg_so_path() -> PathBuf {
   let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
   let candidates = [
      manifest.join("target/deploy/spamm_aggregator.so"),
      manifest.join("target/sbpfv3-solana-solana/release/spamm_aggregator.so"),
   ];
   newest_existing_path(&candidates).unwrap_or_else(|| deploy_dir().join("spamm_aggregator.so"))
}

fn newest_existing_path(candidates: &[PathBuf]) -> Option<PathBuf> {
   candidates
      .iter()
      .filter(|p| p.exists())
      .max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
      .cloned()
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
      let agg_src = agg_so_path();
      let agg_deploy = deploy.join("spamm_aggregator.so");
      if agg_src != agg_deploy {
         std::fs::copy(&agg_src, &agg_deploy).unwrap_or_else(|e| {
            panic!("copy aggregator artifact {:?} -> {:?}: {}", agg_src, agg_deploy, e);
         });
      }
      let agg_so = agg_deploy;
      let mm_src = mm_so_path();
      let mm_deploy = deploy.join("spamm_market_maker.so");
      if mm_src != mm_deploy {
         std::fs::copy(&mm_src, &mm_deploy).unwrap_or_else(|e| {
            panic!("copy MM artifact {:?} -> {:?}: {}", mm_src, mm_deploy, e);
         });
      }
      let adv_src = adversarial_so_path();
      let adv_deploy = deploy.join("spamm_adversarial_mm.so");
      if adv_src != adv_deploy && adv_src.exists() {
         std::fs::copy(&adv_src, &adv_deploy).unwrap_or_else(|e| {
            panic!("copy adversarial MM artifact {:?} -> {:?}: {}", adv_src, adv_deploy, e);
         });
      }
      if !agg_so.exists() || !mm_deploy.exists() || !adv_deploy.exists() {
         panic!(
            "Missing SBF artifacts (Mollusk tests need compiled .so files; cargo check is not enough).\n\
             Expected aggregator:\n  {:?}\n\
             MM (after sync from {:?}):\n  {:?}\n\
             Adversarial MM:\n  {:?}\n\
             From repo root, run:\n\
               cargo build-sbf --arch v3 --manifest-path aggregator/program/Cargo.toml --features devnet\n\
               cargo build-sbf --arch v3 --manifest-path market_maker/program/Cargo.toml\n\
               cargo build-sbf --arch v3 --manifest-path aggregator/program/tests/adversarial_mm/Cargo.toml\n\
             Then: cd aggregator/program && cargo test -p spamm_aggregator --features test-sbf --test spamm_mollusk -- --test-threads=1\n\
             See .cursor/rules/mollusk-tests.mdc",
            agg_so, mm_src, mm_deploy, adv_deploy
         );
      }

      let mut mollusk = Mollusk::new(&agg_program_id(), "spamm_aggregator");
      mollusk.add_program(&mm_program_id(), "spamm_market_maker");
      for slot in 1..=EXTRA_MM_SLOTS {
         let stem = format!("spamm_market_maker_alt_{slot}");
         let alt_so = deploy.join(format!("{stem}.so"));
         std::fs::copy(&mm_deploy, &alt_so).unwrap_or_else(|e| {
            panic!("copy extra MM artifact {:?} -> {:?}: {}", mm_deploy, alt_so, e);
         });
         mollusk.add_program(&mm_alt_program_id(slot), &stem);
      }
      mollusk.add_program(&adversarial_mm_program_id(), "spamm_adversarial_mm");
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

   /// Patch the clock sysvar `unix_timestamp` (Mollusk default is 0).
   pub fn set_clock_unix_timestamp(&mut self, ts: i64) {
      let pk = clock_sysvar_pubkey();
      let mut acct = self.get_account(&pk).cloned().unwrap_or_else(|| {
         let (_, a) = self.mollusk.sysvars.keyed_account_for_clock_sysvar();
         a
      });
      if acct.data.len() >= 5 * U64_LEN {
         acct.data[4 * U64_LEN..5 * U64_LEN].copy_from_slice(&ts.to_le_bytes());
      }
      self.upsert(pk, acct);
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
      for slot in 1..=EXTRA_MM_SLOTS {
         let pk = mm_alt_program_id(slot);
         if self.get_account(&pk).is_none() {
            self.upsert(pk, stub.clone());
         }
      }
      if self.get_account(&agg_program_id()).is_none() {
         self.upsert(agg_program_id(), stub.clone());
      }
      if self.get_account(&adversarial_mm_program_id()).is_none() {
         self.upsert(adversarial_mm_program_id(), stub.clone());
      }
      let (ix_sysvar_pk, ix_sysvar_acct) =
         mollusk_svm::instructions_sysvar::keyed_account(core::iter::once(&ix));
      self.upsert(ix_sysvar_pk, ix_sysvar_acct);
      let clock_pk = clock_sysvar_pubkey();
      if self.get_account(&clock_pk).is_none() {
         let (_, clock_acct) = self.mollusk.sysvars.keyed_account_for_clock_sysvar();
         self.upsert(clock_pk, clock_acct);
      }
      let rent_pk = rent_sysvar_pubkey();
      if self.get_account(&rent_pk).is_none() {
         let (_, rent_acct) = self.mollusk.sysvars.keyed_account_for_rent_sysvar();
         self.upsert(rent_pk, rent_acct);
      }
      for meta in &ix.accounts {
         if self.get_account(&meta.pubkey).is_none() && !meta.is_writable {
            self.upsert(meta.pubkey, system_owned_empty());
         }
      }
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
      self.mm_ix_for(mm_program_id(), disc, data, metas)
   }

   pub fn mm_ix_for(
      &self,
      program: Pubkey,
      disc: u8,
      data: Vec<u8>,
      metas: Vec<AccountMeta>,
   ) -> Instruction {
      let mut buf = vec![disc];
      buf.extend_from_slice(&data);
      Instruction::new_with_bytes(program, &buf, metas)
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
         (user_b(), rich_signer_account()),
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

      let user_b_ata = user_b_collateral_ata();
      let user_b_tok = token::create_account_for_token_account(TokenAccount {
         mint: mint_pubkey(),
         owner: user_b(),
         amount: USER_COLLATERAL_TOKENS,
         delegate: COption::None,
         state: AccountState::Initialized,
         is_native: COption::None,
         delegated_amount: 0,
         close_authority: COption::None,
      });
      self.upsert(user_b_ata, user_b_tok);

      self.upsert(config_pda(), system_owned_empty());
      self.upsert(mm_list_pda(), system_owned_empty());

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

      let mut admin_bytes = [0u8; ADDRESS_LEN];
      admin_bytes.copy_from_slice(mm_admin().as_ref());
      let mut mm_init_data = Vec::with_capacity(2 * ADDRESS_LEN);
      mm_init_data.extend_from_slice(&admin_bytes);
      mm_init_data.extend_from_slice(super::rfq::rfq_signer_pubkey().as_ref());
      let mm_init = self.mm_ix(
         100,
         mm_init_data,
         vec![
            AccountMeta::new(mm_admin(), true),
            AccountMeta::new(mm_config_pda(), false),
            AccountMeta::new(mm_quote_buffer_pda(), false),
            AccountMeta::new(mm_parlay_quote_buffer_pda(), false),
            AccountMeta::new(mm_tok_ata, false),
            AccountMeta::new_readonly(mint_pubkey(), false),
            AccountMeta::new_readonly(tok_pk, false),
            AccountMeta::new_readonly(ata_pk, false),
            AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
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
               110,
               ev_wire,
               vec![
                  AccountMeta::new(mm_admin(), true),
                  AccountMeta::new_readonly(mm_config_pda(), false),
                  AccountMeta::new(es, false),
                  AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
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
            111,
            data,
            vec![
               AccountMeta::new(mm_admin(), true),
               AccountMeta::new_readonly(mm_config_pda(), false),
               AccountMeta::new(md, false),
               AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
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
      self.patch_spl_token_balance(user_b_collateral_ata(), USER_COLLATERAL_TOKENS);
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
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(sys_pk, false),
         AccountMeta::new_readonly(mm_collateral_ata(), false),
         AccountMeta::new_readonly(mm_quote_buffer_pda(), false),
         AccountMeta::new_readonly(mm_parlay_quote_buffer_pda(), false),
      ]
   }

   /// Seed empty encumbrance + liability slots, then run on-chain `register_mm` (creates PDA + ATA).
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
         40,
         data,
         vec![
            AccountMeta::new(mm_admin(), true),
            AccountMeta::new_readonly(mm_program_id(), false),
            AccountMeta::new_readonly(mm_config_pda(), false),
            AccountMeta::new(np, false),
            AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
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
      if acct.data.len() < EVENT_STATE_HEADER_LEN {
         panic!(
            "patch_event_state_sequence: event_state len {} < header {}",
            acct.data.len(),
            EVENT_STATE_HEADER_LEN
         );
      }
      let header = &mut acct.data[..EVENT_STATE_HEADER_LEN];
      let zc = <EventStateData as ZeroPodFixed>::from_bytes_mut(header).unwrap_or_else(
         |e| panic!("patch_event_state_sequence: invalid event_state wire {e:?}"),
      );
      zc.sequence.set(sequence);
      self.upsert(pk, acct);
   }

   pub fn snapshot_accounts(&self, keys: &[Pubkey]) -> Vec<AccountSnapshot> {
      keys
         .iter()
         .map(|key| {
            let acct = self
               .get_account(key)
               .unwrap_or_else(|| panic!("snapshot missing {key}"))
               .clone();
            let token_amount = if acct.data.len() >= TokenAccount::LEN {
               TokenAccount::unpack_from_slice(&acct.data).ok().map(|t| t.amount)
            } else {
               None
            };
            AccountSnapshot {
               key: *key,
               lamports: acct.lamports,
               token_amount,
               data: acct.data,
               owner: acct.owner,
            }
         })
         .collect()
   }

   pub fn assert_accounts_unchanged(&self, snap: &[AccountSnapshot]) {
      for s in snap {
         let acct = self
            .get_account(&s.key)
            .unwrap_or_else(|| panic!("missing after fail {}", s.key));
         assert_eq!(acct.lamports, s.lamports, "lamports changed {}", s.key);
         assert_eq!(acct.owner, s.owner, "owner changed {}", s.key);
         assert_eq!(acct.data, s.data, "data changed {}", s.key);
         if let Some(want) = s.token_amount {
            let got = if acct.data.len() >= spl_token_interface::state::Account::LEN {
               TokenAccount::unpack_from_slice(&acct.data)
                  .map(|t| t.amount)
                  .unwrap_or(want)
            } else {
               want
            };
            assert_eq!(got, want, "token amount changed {}", s.key);
         }
      }
   }

   /// Rewrite market-data oracle odds starting at byte 6 (`init_market` layout).
   pub fn patch_market_odds(&mut self, keys: &MmKeys, mid: &MarketId, body: &[u8]) {
      let pk = keys.market_data(mid);
      let mut acct = self
         .get_account(&pk)
         .unwrap_or_else(|| panic!("patch_market_odds missing {pk}"))
         .clone();
      assert!(acct.data.len() >= 6 + body.len(), "market data too short");
      acct.data[6..6 + body.len()].copy_from_slice(body);
      self.upsert(pk, acct);
   }

   pub fn prepare_mm_keys(&mut self, keys: &MmKeys, markets: &[(MarketId, &[u8])]) {
      let sys_pk = keyed_account_for_system_program().0;
      let tok_pk = token::ID;
      let ata_pk = associated_token::ID;

      self.upsert(keys.admin, rich_signer_account());
      self.upsert(keys.config, system_owned_empty());
      self.upsert(keys.quote_buf, system_owned_empty());
      self.upsert(keys.parlay_buf, system_owned_empty());
      let mm_tok_ata = keys.collateral_ata();
      self.upsert(mm_tok_ata, system_owned_empty());

      let mut admin_bytes = [0u8; ADDRESS_LEN];
      admin_bytes.copy_from_slice(keys.admin.as_ref());
      let mut mm_init_data = Vec::with_capacity(2 * ADDRESS_LEN);
      mm_init_data.extend_from_slice(&admin_bytes);
      mm_init_data.extend_from_slice(super::rfq::rfq_signer_pubkey().as_ref());
      let mm_init = self.mm_ix_for(
         keys.program_id,
         100,
         mm_init_data,
         vec![
            AccountMeta::new(keys.admin, true),
            AccountMeta::new(keys.config, false),
            AccountMeta::new(keys.quote_buf, false),
            AccountMeta::new(keys.parlay_buf, false),
            AccountMeta::new(mm_tok_ata, false),
            AccountMeta::new_readonly(mint_pubkey(), false),
            AccountMeta::new_readonly(tok_pk, false),
            AccountMeta::new_readonly(ata_pk, false),
            AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
            AccountMeta::new_readonly(sys_pk, false),
         ],
      );
      let r = self.run_ix(mm_init);
      assert!(r.program_result.is_ok(), "mm init_program {:?}", r);

      if keys.slot != 0 {
         self.clone_oracle_accounts_from_default(keys, markets);
         return;
      }

      let mut seen_events = std::collections::HashSet::new();
      for (mid, _body) in markets {
         let eid = mid.event_id;
         let key = (eid.event, eid.league, eid.sport as u8);
         if seen_events.insert(key) {
            let es = keys.event_state(&eid);
            self.upsert(es, system_owned_empty());
            let ev_wire = eid.as_wire_bytes().to_vec();
            let ev_ix = self.mm_ix_for(
               keys.program_id,
               110,
               ev_wire,
               vec![
                  AccountMeta::new(keys.admin, true),
                  AccountMeta::new_readonly(keys.config, false),
                  AccountMeta::new(es, false),
                  AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
                  AccountMeta::new_readonly(sys_pk, false),
               ],
            );
            let re = self.run_ix(ev_ix);
            assert!(re.program_result.is_ok(), "mm init_event {:?}", re);
            self.patch_event_state_sequence_at(keys, &eid, 1);
         }
      }

      for (mid, oracle_body) in markets {
         let md = keys.market_data(mid);
         self.upsert(md, system_owned_empty());
         let mut data = Vec::with_capacity(MarketId::WIRE_SIZE + oracle_body.len());
         data.extend_from_slice(&market_id_wire_bytes(mid));
         data.extend_from_slice(oracle_body);
         let m_ix = self.mm_ix_for(
            keys.program_id,
            111,
            data,
            vec![
               AccountMeta::new(keys.admin, true),
               AccountMeta::new_readonly(keys.config, false),
               AccountMeta::new(md, false),
               AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
               AccountMeta::new_readonly(sys_pk, false),
            ],
         );
         let rm = self.run_ix(m_ix);
         assert!(rm.program_result.is_ok(), "mm init_market {:?}", rm);
      }
   }

   /// Copy event/market PDA bytes from the default example MM and rewrite bumps/owner
   /// for `keys`. Extra MM copies load the same ELF under a different program id; CPI
   /// `init_event` then fails `InvalidSeeds` because the on-chain PDA check uses the
   /// runtime `program_id` while the CreateAccount signer seeds still have to match
   /// that copy. Cloning after a successful `init_program` is enough for quote/fill.
   fn clone_oracle_accounts_from_default(
      &mut self,
      keys: &MmKeys,
      markets: &[(MarketId, &[u8])],
   ) {
      use spamm_aggregator::state::other::MM_MARKET_DATA_PDA_BUMP_OFFSET;
      use spamm_aggregator::state::EVENT_STATE_BUMP_OFFSET;
      let honest = MmKeys::default_mm();
      let mut seen = std::collections::HashSet::new();
      for (mid, oracle_body) in markets {
         let eid = mid.event_id;
         let key = (eid.event, eid.league, eid.sport as u8);
         if seen.insert(key) {
            let e_wire = eid.as_wire_bytes();
            let (es_pk, es_bump) =
               Pubkey::find_program_address(&[b"event_state", e_wire.as_slice()], &keys.program_id);
            let mut es_data = self
               .get_account(&honest.event_state(&eid))
               .expect("bootstrap default MM before extra MM copies")
               .data
               .clone();
            es_data[EVENT_STATE_BUMP_OFFSET] = es_bump;
            self.upsert(
               es_pk,
               Account {
                  lamports: 10_000_000,
                  data: es_data,
                  owner: keys.program_id,
                  executable: false,
                  rent_epoch: 0,
               },
            );
         }
         let (md_pk, md_bump) = {
            let w = market_id_wire_bytes(mid);
            let (body, operator) = spamm_aggregator::state::market_id_pda_seed_parts(&w);
            Pubkey::find_program_address(&[b"market_data", body, operator], &keys.program_id)
         };
         let mut md = self
            .get_account(&honest.market_data(mid))
            .expect("bootstrap default MM before extra MM copies")
            .data
            .clone();
         md[MM_MARKET_DATA_PDA_BUMP_OFFSET] = md_bump;
         if md.len() >= 6 + oracle_body.len() {
            md[6..6 + oracle_body.len()].copy_from_slice(oracle_body);
         }
         self.upsert(
            md_pk,
            Account {
               lamports: 10_000_000,
               data: md,
               owner: keys.program_id,
               executable: false,
               rent_epoch: 0,
            },
         );
      }
   }

   pub fn patch_event_state_sequence_at(&mut self, keys: &MmKeys, eid: &EventId, sequence: u16) {
      let pk = keys.event_state(eid);
      let mut acct = self
         .get_account(&pk)
         .unwrap_or_else(|| panic!("patch_event_state_sequence: missing event state {pk}"))
         .clone();
      if acct.data.len() < EVENT_STATE_HEADER_LEN {
         panic!(
            "patch_event_state_sequence: event_state len {} < header {}",
            acct.data.len(),
            EVENT_STATE_HEADER_LEN
         );
      }
      let header = &mut acct.data[..EVENT_STATE_HEADER_LEN];
      let zc = <EventStateData as ZeroPodFixed>::from_bytes_mut(header).unwrap_or_else(
         |e| panic!("patch_event_state_sequence: invalid event_state wire {e:?}"),
      );
      zc.sequence.set(sequence);
      self.upsert(pk, acct);
   }

   pub fn register_mm_metas_for(keys: &MmKeys) -> Vec<AccountMeta> {
      let sys_pk = keyed_account_for_system_program().0;
      vec![
         AccountMeta::new(keys.admin, true),
         AccountMeta::new_readonly(keys.program_id, false),
         AccountMeta::new_readonly(keys.config, false),
         AccountMeta::new(keys.encumbrance(), false),
         AccountMeta::new(keys.liability_ata(), false),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new(mm_list_pda(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
         AccountMeta::new_readonly(associated_token::ID, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(sys_pk, false),
         AccountMeta::new_readonly(keys.collateral_ata(), false),
         AccountMeta::new_readonly(keys.quote_buf, false),
         AccountMeta::new_readonly(keys.parlay_buf, false),
      ]
   }

   pub fn register_mm_execute_for(&mut self, keys: &MmKeys) -> InstructionResult {
      self.upsert(keys.encumbrance(), system_owned_empty());
      self.upsert(keys.liability_ata(), system_owned_empty());
      let reg = self.agg_ix(2, vec![], Self::register_mm_metas_for(keys));
      self.run_ix(reg)
   }

   /// Init + register an extra copy of the example MM (aggregator already bootstrapped).
   pub fn bootstrap_extra_mm(&mut self, keys: &MmKeys, markets: &[(MarketId, &[u8])]) {
      self.prepare_mm_keys(keys, markets);
      let rr = self.register_mm_execute_for(keys);
      assert!(rr.program_result.is_ok(), "register extra mm {:?}", rr);
      self.patch_spl_token_balance(keys.collateral_ata(), MM_COLLATERAL_TOKENS);
   }

   /// Fabricate config / buffers / oracle PDAs for the adversarial MM, then register.
   /// Copies layout from the already-bootstrapped example MM (call `bootstrap_*` first).
   pub fn bootstrap_adversarial_mm(&mut self, markets: &[(MarketId, &[u8])]) {
      use spamm_aggregator::state::mm_account_config::{
         MM_ACCOUNT_CONFIG_DISCRIMINATOR, MM_CONFIG_PDA_ADMIN_OFFSET, MM_CONFIG_PDA_BUMP_OFFSET,
      };
      use spamm_aggregator::state::other::MM_MARKET_DATA_PDA_BUMP_OFFSET;
      use spamm_aggregator::state::{
         MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR, MM_PARLAY_QUOTE_BUFFER_LEN, MM_QUOTE_BUFFER_DISCRIMINATOR,
         MM_QUOTE_BUFFER_LEN, EVENT_STATE_BUMP_OFFSET,
      };
      let keys = MmKeys::adversarial();
      let honest = MmKeys::default_mm();
      self.upsert(keys.admin, rich_signer_account());
      let (cfg_pk, cfg_bump) = Pubkey::find_program_address(&[b"config"], &keys.program_id);
      assert_eq!(cfg_pk, keys.config);
      let mut cfg_data = self
         .get_account(&honest.config)
         .expect("bootstrap example MM before adversarial")
         .data
         .clone();
      cfg_data[0] = MM_ACCOUNT_CONFIG_DISCRIMINATOR;
      cfg_data[MM_CONFIG_PDA_BUMP_OFFSET] = cfg_bump;
      let admin_off = MM_CONFIG_PDA_ADMIN_OFFSET;
      cfg_data[admin_off..admin_off + 32].copy_from_slice(keys.admin.as_ref());
      self.upsert(
         keys.config,
         Account {
            lamports: 10_000_000,
            data: cfg_data,
            owner: keys.program_id,
            executable: false,
            rent_epoch: 0,
         },
      );
      let mut q = vec![0u8; MM_QUOTE_BUFFER_LEN];
      q[0] = MM_QUOTE_BUFFER_DISCRIMINATOR;
      self.upsert(
         keys.quote_buf,
         Account {
            lamports: 10_000_000,
            data: q,
            owner: keys.program_id,
            executable: false,
            rent_epoch: 0,
         },
      );
      let mut p = vec![0u8; MM_PARLAY_QUOTE_BUFFER_LEN];
      p[0] = MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR;
      self.upsert(
         keys.parlay_buf,
         Account {
            lamports: 10_000_000,
            data: p,
            owner: keys.program_id,
            executable: false,
            rent_epoch: 0,
         },
      );
      let tok = token::create_account_for_token_account(TokenAccount {
         mint: mint_pubkey(),
         owner: keys.config,
         amount: MM_COLLATERAL_TOKENS,
         delegate: COption::None,
         state: AccountState::Initialized,
         is_native: COption::None,
         delegated_amount: 0,
         close_authority: COption::None,
      });
      self.upsert(keys.collateral_ata(), tok);

      let mut seen = std::collections::HashSet::new();
      for (mid, _) in markets {
         let eid = mid.event_id;
         let key = (eid.event, eid.league, eid.sport as u8);
         if seen.insert(key) {
            let e_wire = eid.as_wire_bytes();
            let (es_pk, es_bump) =
               Pubkey::find_program_address(&[b"event_state", e_wire.as_slice()], &keys.program_id);
            let mut es_data = self
               .get_account(&honest.event_state(&eid))
               .expect("honest event_state")
               .data
               .clone();
            es_data[EVENT_STATE_BUMP_OFFSET] = es_bump;
            self.upsert(
               es_pk,
               Account {
                  lamports: 10_000_000,
                  data: es_data,
                  owner: keys.program_id,
                  executable: false,
                  rent_epoch: 0,
               },
            );
         }
         let (md_pk, md_bump) = {
            let w = market_id_wire_bytes(mid);
            let (body, operator) = spamm_aggregator::state::market_id_pda_seed_parts(&w);
            Pubkey::find_program_address(&[b"market_data", body, operator], &keys.program_id)
         };
         let mut md = self
            .get_account(&honest.market_data(mid))
            .expect("honest market_data")
            .data
            .clone();
         md[MM_MARKET_DATA_PDA_BUMP_OFFSET] = md_bump;
         self.upsert(
            md_pk,
            Account {
               lamports: 10_000_000,
               data: md,
               owner: keys.program_id,
               executable: false,
               rent_epoch: 0,
            },
         );
      }
      let rr = self.register_mm_execute_for(&keys);
      assert!(rr.program_result.is_ok(), "register adversarial mm {:?}", rr);
   }
}
