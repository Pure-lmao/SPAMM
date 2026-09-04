//! Deterministic pubkeys / domain values (matches on-chain layouts).

use solana_instruction::AccountMeta;
use solana_pubkey::Pubkey;
use solana_sdk_ids::sysvar::clock;
use solana_sdk_ids::sysvar::rent;
use spamm_aggregator::state::{EventId, MarketId, Sport};

/// Aggregator program id (`spamm_aggregator::constants::ID`).
pub fn agg_program_id() -> Pubkey {
   Pubkey::new_from_array([
      0x47, 0x9f, 0x3b, 0x4d, 0x99, 0x66, 0x4a, 0x69, 0x1f, 0x03, 0x08, 0x28, 0x72, 0x9c, 0x0f, 0x85,
      0x48, 0xd3, 0x06, 0x11, 0xc1, 0x83, 0xac, 0xcf, 0x87, 0x3d, 0xb1, 0x15, 0x39, 0x0f, 0x95, 0x74,
   ])
}

pub fn config_pda() -> Pubkey {
   Pubkey::new_from_array([
      0x08, 0x5a, 0xc2, 0xf2, 0xfb, 0xd0, 0x2d, 0x00, 0x41, 0x76, 0x8a, 0xca, 0xda, 0x07, 0x38, 0x10,
      0x53, 0x47, 0x4e, 0xe5, 0x39, 0x9b, 0xeb, 0x98, 0x29, 0x2f, 0x2b, 0x43, 0x8d, 0x6a, 0x75, 0xfb,
   ])
}

pub fn mm_list_pda() -> Pubkey {
   Pubkey::new_from_array([
      0xcf, 0x85, 0x07, 0x53, 0x14, 0xaa, 0xf5, 0xd8, 0x36, 0x0e, 0xb6, 0x31, 0x6e, 0x55, 0x1d, 0x57,
      0x31, 0x9d, 0xc8, 0xc7, 0x00, 0x63, 0x2a, 0x22, 0xa0, 0x08, 0x36, 0xbc, 0x97, 0xb4, 0x4c, 0x6c,
   ])
}

pub fn mint_pubkey() -> Pubkey {
   // Must match `spamm_aggregator::constants::MINT` (cluster-specific USDC).
   Pubkey::new_from_array(*spamm_aggregator::constants::MINT.as_array())
}

pub fn init_program_ix_data() -> Vec<u8> {
   vec![]
}

/// Metas for aggregator `init_program` (router disc `0`); pair with [`init_program_ix_data`].
pub fn init_program_account_metas(admin: Pubkey, admin_signer: bool, system_program: Pubkey) -> Vec<AccountMeta> {
   vec![
      AccountMeta::new(admin, admin_signer),
      AccountMeta::new(config_pda(), false),
      AccountMeta::new(mm_list_pda(), false),
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(system_program, false),
   ]
}

// --- Example MM (pinned addresses from `market_maker/program/src/constants.rs`) ---

pub fn mm_program_id() -> Pubkey {
   Pubkey::new_from_array([
      0xb9, 0x4d, 0xc0, 0x61, 0x1a, 0x34, 0x2b, 0xea, 0x68, 0x64, 0x8b, 0x00, 0x11, 0xb1, 0x7b, 0x3b,
      0x7b, 0xb6, 0xd6, 0xdf, 0x18, 0x8b, 0x84, 0x90, 0xa7, 0xf8, 0x71, 0xab, 0x9c, 0x93, 0xd1, 0xbf,
   ])
}

pub fn mm_config_pda() -> Pubkey {
   Pubkey::new_from_array([
      0xbf, 0x14, 0xb9, 0x9c, 0xa8, 0xdb, 0x0c, 0x96, 0xc8, 0x9a, 0x0b, 0x7f, 0x66, 0xce, 0xad, 0xc6,
      0xfd, 0x25, 0x3c, 0x4a, 0x6a, 0x60, 0x57, 0x89, 0x9d, 0x0b, 0x3d, 0x6b, 0x2c, 0x50, 0x99, 0xd4,
   ])
}

pub fn mm_quote_buffer_pda() -> Pubkey {
   Pubkey::new_from_array([
      0x1b, 0xc6, 0xd3, 0x95, 0x21, 0xea, 0xf0, 0x6c, 0x8b, 0x5c, 0x87, 0x81, 0xed, 0xf8, 0xd0, 0xb4,
      0x28, 0x89, 0x3d, 0x44, 0xc7, 0x8c, 0x64, 0x64, 0xe1, 0x41, 0x31, 0x44, 0x52, 0x49, 0xb5, 0xc5,
   ])
}

pub fn mm_parlay_quote_buffer_pda() -> Pubkey {
   Pubkey::new_from_array([
      0x1b, 0x59, 0x8c, 0x7c, 0x67, 0x68, 0x53, 0x7e, 0x19, 0xb3, 0x5c, 0x0e, 0xe6, 0xea, 0x75, 0x70,
      0xd1, 0x23, 0x85, 0x78, 0xd3, 0x0e, 0x7f, 0x25, 0xa3, 0x43, 0x90, 0x4e, 0x00, 0xda, 0xd9, 0x5f,
   ])
}

// --- Test actors (deterministic; not necessarily on-curve) ---

pub fn clock_sysvar_pubkey() -> Pubkey {
   clock::id()
}

pub fn rent_sysvar_pubkey() -> Pubkey {
   rent::id()
}

pub fn admin() -> Pubkey {
   Pubkey::new_from_array([0xA1; 32])
}

pub fn mm_admin() -> Pubkey {
   Pubkey::new_from_array([0xA2; 32])
}

pub fn user() -> Pubkey {
   Pubkey::new_from_array([0xA3; 32])
}

pub fn bet_feepayer() -> Pubkey {
   Pubkey::new_from_array([0xA4; 32])
}

pub fn wrong_signer() -> Pubkey {
   Pubkey::new_from_array([0xEE; 32])
}

/// Second pubkey stored in `mm_list` when testing removal of the first entry (not a registered MM).
pub fn mm_list_peer_program() -> Pubkey {
   Pubkey::new_from_array([0xBB; 32])
}

// --- Event / market ids (plan) ---

pub fn event_id_soccer() -> EventId {
   EventId {
      event: 1,
      league: 100,
      sport: Sport::Soccer,
   }
}

/// Distinct soccer `EventId` for a second leg (`get_quote_parlay` requires unique events).
pub fn event_id_soccer_b() -> EventId {
   EventId {
      event: 3,
      league: 100,
      sport: Sport::Soccer,
   }
}

pub fn event_id_soccer_c() -> EventId {
   EventId {
      event: 5,
      league: 100,
      sport: Sport::Soccer,
   }
}

pub fn event_id_soccer_d() -> EventId {
   EventId {
      event: 7,
      league: 100,
      sport: Sport::Soccer,
   }
}

pub fn event_id_soccer_e() -> EventId {
   EventId {
      event: 11,
      league: 100,
      sport: Sport::Soccer,
   }
}

/// Non-soccer event for moneyline (`period` 0, `mkt` 0) header netting tests.
pub fn event_id_basketball() -> EventId {
   EventId {
      event: 42,
      league: 200,
      sport: Sport::Basketball,
   }
}

/// Aggregator admin pubkey — also used as the deterministic test market operator.
pub fn market_operator() -> pinocchio::Address {
   pinocchio::Address::new_from_array(admin().to_bytes())
}

/// Packed `MarketId` wire bytes (matches on-chain `to_zc` layout).
pub fn market_id_wire_bytes(m: &MarketId) -> [u8; MarketId::WIRE_SIZE] {
   (*m).as_bytes()
}

pub fn market_data_pda(mid: &MarketId) -> Pubkey {
   let w = market_id_wire_bytes(mid);
   let (body, operator) = spamm_aggregator::state::market_id_pda_seed_parts(&w);
   Pubkey::find_program_address(&[b"market_data", body, operator], &mm_program_id()).0
}

/// Pregame two-outcome moneyline (`period` 0, `mkt` 0) — nets via netting PDA header on non-soccer sports.
pub fn market_ml_pregame(eid: EventId) -> MarketId {
   MarketId {
      event_id: eid,
      player: 0,
      mkt: 0,
      period: 0,
      is_pregame: true,
      operator: market_operator(),
   }
}

/// Scaled odds for decimal 1.9 (`ODDS_SCALE` = 10_000).
pub const ODDS_1_9_SCALED: u32 = 19_000;

/// $10 USDC stake (6 decimals).
pub const STAKE_10_USDC: u64 = 10_000_000;

/// MM profit liability on $10 @ 1.9 (one side).
pub const LIABILITY_9_USDC: u64 = 9_000_000;

pub fn market_spread_pregame(eid: EventId) -> MarketId {
   MarketId {
      event_id: eid,
      player: 0,
      mkt: 400,
      period: 1,
      is_pregame: true,
      operator: market_operator(),
   }
}

pub fn market_soccer_ft_pregame(eid: EventId) -> MarketId {
   MarketId {
      event_id: eid,
      player: 0,
      mkt: 1,
      period: 1,
      is_pregame: true,
      operator: market_operator(),
   }
}

/// Two-outcome oracle body: `u32` scaled odds per side (LE).
pub fn oracle_body_two_outcome(odds_a: u32, odds_b: u32) -> [u8; 8] {
   let mut b = [0u8; 8];
   b[0..4].copy_from_slice(&odds_a.to_le_bytes());
   b[4..8].copy_from_slice(&odds_b.to_le_bytes());
   b
}

/// Three-outcome body: `u32` scaled odds in wire order **home, away, draw** (LE).
pub fn oracle_body_three_outcome(home: u32, away: u32, draw: u32) -> [u8; 12] {
   let mut out = [0u8; 12];
   out[0..4].copy_from_slice(&home.to_le_bytes());
   out[4..8].copy_from_slice(&away.to_le_bytes());
   out[8..12].copy_from_slice(&draw.to_le_bytes());
   out
}

pub const BET_ID_BASIC: u64 = 1;
pub const BET_ID_NET_A: u64 = 2;
pub const BET_ID_NET_B: u64 = 3;
pub const BET_ID_PARLAY: u64 = 4;

pub fn mm_collateral_ata() -> Pubkey {
   spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
      &mm_config_pda(),
      &mint_pubkey(),
      &mollusk_svm_programs_token::token::ID,
   )
}

pub fn user_collateral_ata() -> Pubkey {
   spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
      &user(),
      &mint_pubkey(),
      &mollusk_svm_programs_token::token::ID,
   )
}

pub fn encumbrance_pda() -> Pubkey {
   Pubkey::find_program_address(
      &[b"encumbrance", mm_program_id().as_ref()],
      &agg_program_id(),
   )
   .0
}

pub fn liability_token_ata() -> Pubkey {
   let enc = encumbrance_pda();
   spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
      &enc,
      &mint_pubkey(),
      &mollusk_svm_programs_token::token::ID,
   )
}

pub fn netting_pda_for_event(eid: &EventId) -> Pubkey {
   let e = eid.as_wire_bytes();
   Pubkey::find_program_address(
      &[b"netting", mm_program_id().as_ref(), e.as_slice()],
      &agg_program_id(),
   )
   .0
}

pub fn event_state_pda(eid: &EventId) -> Pubkey {
   let e = eid.as_wire_bytes();
   Pubkey::find_program_address(&[b"event_state", e.as_slice()], &mm_program_id()).0
}

pub fn bet_pda_for(user_pk: &Pubkey, bet_id: u64) -> Pubkey {
   Pubkey::find_program_address(
      &[b"bet", user_pk.as_ref(), &bet_id.to_le_bytes()],
      &agg_program_id(),
   )
   .0
}

pub fn parlay_bet_pda_for(user_pk: &Pubkey, bet_id: u64) -> Pubkey {
   Pubkey::find_program_address(
      &[b"parlay", user_pk.as_ref(), &bet_id.to_le_bytes()],
      &agg_program_id(),
   )
   .0
}

/// Cashout ticket PDA: `["cashout", filling_mm, cashout_id_le]`.
pub fn cashout_pda_for(filling_mm: &Pubkey, cashout_id: u64) -> Pubkey {
   Pubkey::find_program_address(
      &[b"cashout", filling_mm.as_ref(), &cashout_id.to_le_bytes()],
      &agg_program_id(),
   )
   .0
}

/// Parlay cashout ticket PDA: `["cashout_parlay", filling_mm, cashout_id_le]`.
pub fn cashout_parlay_pda_for(filling_mm: &Pubkey, cashout_id: u64) -> Pubkey {
   Pubkey::find_program_address(
      &[b"cashout_parlay", filling_mm.as_ref(), &cashout_id.to_le_bytes()],
      &agg_program_id(),
   )
   .0
}

/// Live cashout escrow PDA: `["cashout_escrow", user, orig_bet_id_le]`.
pub fn cashout_escrow_pda_for(owner: &Pubkey, orig_bet_id: u64) -> Pubkey {
   Pubkey::find_program_address(
      &[b"cashout_escrow", owner.as_ref(), &orig_bet_id.to_le_bytes()],
      &agg_program_id(),
   )
   .0
}

/// Always six accounts: admin, mm program, mm config, netting PDA, rent, system.
pub fn add_line_account_metas(np: Pubkey) -> Vec<AccountMeta> {
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
   ]
}
