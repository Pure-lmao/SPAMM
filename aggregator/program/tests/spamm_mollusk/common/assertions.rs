//! Decode account state after Mollusk runs for stronger assertions.

use solana_account::Account;
use solana_pubkey::Pubkey;
use solana_program_pack::Pack;
use spl_token_interface::state::Account as TokenAccount;

use spamm_aggregator::constants::ODDS_SCALE;
use spamm_aggregator::helpers::{calc_potential_profit, calc_potential_payout};
use spamm_aggregator::state::account_bet::{BetAccountData, BetResult};
use spamm_aggregator::state::account_netting::NETTING_ACCOUNT_ALLOC_LEN;
use spamm_aggregator::state::account_parlay_bet::{ParlayBetAccountData, PARLAY_BET_ACCOUNT_DISCRIMINATOR};
use spamm_aggregator::state::other::{
   CONFIG_PDA_AUTHORITY_OFFSET, CONFIG_PDA_DISCRIMINATOR, CONFIG_PDA_LEN, CONFIG_PDA_STATUS_OFFSET,
   MM_ENCUMBRANCE_PDA_DISCRIMINATOR, MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, MM_ENCUMBRANCE_PDA_LEN,
   MM_LIST_HEADER_LEN, MM_LIST_PDA_DISCRIMINATOR, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET,
};
use spamm_aggregator::state::{EventId, MarketId, NETTING_HEADER_LEN, NETTING_LINE_LEN, NETTING_PDA_DISCRIMINATOR};

/// First `i64` header liability (`home`) after `discriminator` + `bump` + wire `EventId`.
const NETTING_HEADER_HOME_OFFSET: usize = 2 + EventId::WIRE_SIZE;

use super::env::Env;
use super::fixtures::{
   agg_program_id, encumbrance_pda, mm_program_id, user_collateral_ata,
};

pub fn decode_bet(env: &Env, bet_pda: &Pubkey) -> BetAccountData {
   let acct = env.get_account(bet_pda).unwrap_or_else(|| panic!("missing bet account {bet_pda}"));
   BetAccountData::decode(&acct.data).expect("decode BetAccountData")
}

pub fn decode_parlay_bet(env: &Env, bet_pda: &Pubkey) -> ParlayBetAccountData {
   let acct = env
      .get_account(bet_pda)
      .unwrap_or_else(|| panic!("missing parlay bet account {bet_pda}"));
   ParlayBetAccountData::decode(&acct.data).expect("decode ParlayBetAccountData")
}

pub fn read_encumbrance(env: &Env, enc_pda: &Pubkey) -> i64 {
   let acct = env.get_account(enc_pda).unwrap_or_else(|| panic!("missing encumbrance {enc_pda}"));
   assert_eq!(
      acct.data.len(),
      MM_ENCUMBRANCE_PDA_LEN,
      "encumbrance data len"
   );
   i64::from_le_bytes(
      acct.data[MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET..MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET + 8]
         .try_into()
         .unwrap(),
   )
}

pub fn read_token_balance(env: &Env, ata: &Pubkey) -> u64 {
   let acct = env.get_account(ata).unwrap_or_else(|| panic!("missing token account {ata}"));
   TokenAccount::unpack_from_slice(&acct.data)
      .expect("unpack token account")
      .amount
}

pub fn assert_account_closed_or_system_empty(env: &Env, pk: &Pubkey) {
   let acct = env.get_account(pk).unwrap_or_else(|| panic!("missing account {pk}"));
   assert!(
      acct.data.is_empty() && acct.owner == solana_sdk_ids::system_program::ID,
      "expected closed/system-empty account {pk}: owner={:?} data_len={}",
      acct.owner,
      acct.data.len()
   );
}

/// Config PDA must exist and match initialisation layout.
pub fn read_config_authority_status(env: &Env, config_pda: &Pubkey) -> (Pubkey, u8) {
   let acct = env.get_account(config_pda).unwrap_or_else(|| panic!("missing config {config_pda}"));
   assert_eq!(acct.data.len(), CONFIG_PDA_LEN);
   assert_eq!(acct.data[0], CONFIG_PDA_DISCRIMINATOR);
   let status = acct.data[CONFIG_PDA_STATUS_OFFSET];
   let authority = Pubkey::new_from_array(
      acct.data[CONFIG_PDA_AUTHORITY_OFFSET..CONFIG_PDA_AUTHORITY_OFFSET + 32]
         .try_into()
         .unwrap(),
   );
   (authority, status)
}

pub fn read_mm_list_tail(env: &Env, mm_list_pda: &Pubkey) -> (u16, Vec<Pubkey>) {
   let acct = env
      .get_account(mm_list_pda)
      .unwrap_or_else(|| panic!("missing mm_list {mm_list_pda}"));
   assert!(acct.data.len() >= MM_LIST_HEADER_LEN);
   assert_eq!(acct.data[0], MM_LIST_PDA_DISCRIMINATOR);
   let n = u16::from_le_bytes([
      acct.data[MM_LIST_PDA_NUMBER_OF_MMS_OFFSET],
      acct.data[MM_LIST_PDA_NUMBER_OF_MMS_OFFSET + 1],
   ]);
   let expected_len = MM_LIST_HEADER_LEN + (n as usize) * 32;
   assert_eq!(
      acct.data.len(),
      expected_len,
      "mm_list length mismatch"
   );
   let mut addrs = Vec::with_capacity(n as usize);
   for i in 0..(n as usize) {
      let off = MM_LIST_HEADER_LEN + i * 32;
      addrs.push(Pubkey::new_from_array(acct.data[off..off + 32].try_into().unwrap()));
   }
   (n, addrs)
}

pub fn assert_encumbrance_discriminator(env: &Env, enc: &Pubkey) {
   let acct = env.get_account(enc).unwrap_or_else(|| panic!("missing enc {enc}"));
   assert_eq!(acct.data.len(), MM_ENCUMBRANCE_PDA_LEN);
   assert_eq!(acct.owner, agg_program_id());
   assert_eq!(acct.data[0], MM_ENCUMBRANCE_PDA_DISCRIMINATOR);
}

/// Header + line count from netting PDA (must be initialised).
pub fn read_netting_lines_snapshot(env: &Env, netting_pda: &Pubkey) -> (u8, Vec<(u8, u16)>) {
   let acct = env
      .get_account(netting_pda)
      .unwrap_or_else(|| panic!("missing netting {netting_pda}"));
   assert!(acct.data.len() >= NETTING_HEADER_LEN);
   assert_eq!(acct.data[0], NETTING_PDA_DISCRIMINATOR);
   let n = acct.data[NETTING_HEADER_LEN - 1];
   let mut lines = Vec::with_capacity(n as usize);
   let lines_start = NETTING_HEADER_LEN;
   for i in 0..(n as usize) {
      let off = lines_start + i * NETTING_LINE_LEN;
      let period = acct.data[off];
      let mkt = u16::from_le_bytes(acct.data[off + 1..off + 3].try_into().unwrap());
      lines.push((period, mkt));
   }
   (n, lines)
}

/// Soccer 1X2 header liabilities (`home` / `away` / `draw`, wire order) plus sorted line rows with outcomes.
pub fn read_netting_soccer_header_and_lines(
   env: &Env,
   netting_pda: &Pubkey,
) -> ([i64; 3], Vec<(u8, u16, i64, i64)>) {
   let acct = env
      .get_account(netting_pda)
      .unwrap_or_else(|| panic!("missing netting {netting_pda}"));
   assert_eq!(
      acct.data.len(),
      NETTING_ACCOUNT_ALLOC_LEN,
      "netting alloc len"
   );
   assert_eq!(acct.data[0], NETTING_PDA_DISCRIMINATOR);
   let mut ft = [0i64; 3];
   for (i, slot) in ft.iter_mut().enumerate() {
      let off = NETTING_HEADER_HOME_OFFSET + i * 8;
      *slot = i64::from_le_bytes(acct.data[off..off + 8].try_into().unwrap());
   }
   let n = acct.data[NETTING_HEADER_LEN - 1];
   let mut out = Vec::with_capacity(n as usize);
   let lines_start = NETTING_HEADER_LEN;
   for i in 0..(n as usize) {
      let off = lines_start + i * NETTING_LINE_LEN;
      let period = acct.data[off];
      let mkt = u16::from_le_bytes(acct.data[off + 1..off + 3].try_into().unwrap());
      let o0 = i64::from_le_bytes(acct.data[off + 3..off + 11].try_into().unwrap());
      let o1 = i64::from_le_bytes(acct.data[off + 11..off + 19].try_into().unwrap());
      out.push((period, mkt, o0, o1));
   }
   (ft, out)
}

pub fn assert_netting_pda_initialized(env: &Env, netting_pda: &Pubkey, expected_event_id: &EventId) {
   let acct = env
      .get_account(netting_pda)
      .unwrap_or_else(|| panic!("missing netting {netting_pda}"));
   assert_eq!(acct.owner, agg_program_id(), "netting owner");
   assert_eq!(
      acct.data.len(),
      NETTING_ACCOUNT_ALLOC_LEN,
      "netting space"
   );
   assert_eq!(acct.data[0], NETTING_PDA_DISCRIMINATOR);
   let wire = expected_event_id.as_wire_bytes();
   let ev_end = 2 + EventId::WIRE_SIZE;
   assert_eq!(&acct.data[2..ev_end], wire.as_slice(), "netting event_id");
   assert_eq!(acct.data[NETTING_HEADER_LEN - 1], 0, "number_of_lines");
   let home = i64::from_le_bytes(
      acct.data[NETTING_HEADER_HOME_OFFSET..NETTING_HEADER_HOME_OFFSET + 8]
         .try_into()
         .unwrap(),
   );
   let away = i64::from_le_bytes(
      acct.data[NETTING_HEADER_HOME_OFFSET + 8..NETTING_HEADER_HOME_OFFSET + 16]
         .try_into()
         .unwrap(),
   );
   let draw = i64::from_le_bytes(
      acct.data[NETTING_HEADER_HOME_OFFSET + 16..NETTING_HEADER_HOME_OFFSET + 24]
         .try_into()
         .unwrap(),
   );
   assert_eq!(home, 0);
   assert_eq!(away, 0);
   assert_eq!(draw, 0);
}

/// Token + encumbrance checks after a single-MM `fill_bet` with full fill from one quote.
pub fn assert_fill_bet_single_mm_economics(
   env: &Env,
   bet_pda: &Pubkey,
   bet_ata: &Pubkey,
   expected_market: MarketId,
   user_collateral_pre: u64,
   enc_pre: i64,
   odds_scaled: u32,
) {
   let b = decode_bet(env, bet_pda);
   assert!(b.market_id.eq(&expected_market));
   let exp_payout = calc_potential_payout(b.amount, odds_scaled).expect("payout calc");
   assert_eq!(b.payout, exp_payout);
   assert_eq!(b.filler_0.amount, b.amount);
   assert_eq!(b.filler_0.odds_scaled, odds_scaled);
   assert!(!b.filler_0.is_potentially_netted);
   let exp_profit = calc_potential_profit(b.amount, odds_scaled).expect("profit calc");
   assert_eq!(b.filler_0.encumbrance_delta, exp_profit as i64);

   assert_eq!(
      read_token_balance(env, &user_collateral_ata()),
      user_collateral_pre.saturating_sub(b.amount)
   );
   assert_eq!(read_token_balance(env, bet_ata), b.amount);
   assert_eq!(
      read_encumbrance(env, &encumbrance_pda()),
      enc_pre + b.filler_0.encumbrance_delta
   );
}

pub fn assert_bet_after_fill(
   env: &Env,
   bet_pda: &Pubkey,
   expected_amount: u64,
   expected_side: u8,
) {
   let b = decode_bet(env, bet_pda);
   assert!(matches!(b.result, BetResult::Pending));
   assert_eq!(b.amount, expected_amount);
   assert_eq!(b.side, expected_side);
   let mut mmaddr = [0u8; 32];
   mmaddr.copy_from_slice(b.filler_0.mm_address.as_ref());
   assert_eq!(Pubkey::new_from_array(mmaddr), mm_program_id());
}

/// Uniform per-leg `odds_scaled` (e.g. 20_000) combined for `n` legs.
pub fn uniform_parlay_combined_odds(leg_odds: u32, n: usize) -> u32 {
   let mut p: u128 = ODDS_SCALE;
   for _ in 0..n {
      p = p
         .saturating_mul(leg_odds as u128)
         .saturating_div(ODDS_SCALE);
   }
   p.min(u32::MAX as u128) as u32
}

/// After a successful `fill_parlay`, check parlay bet fields, MM filler, and encumbrance delta.
pub fn assert_parlay_after_fill(
   env: &Env,
   bet_pda: &Pubkey,
   enc_pda: &Pubkey,
   enc_before: i64,
   expected_amount: u64,
   num_legs: u8,
   combined_odds_scaled: u32,
) {
   let p = decode_parlay_bet(env, bet_pda);
   assert_eq!(p.discriminator, PARLAY_BET_ACCOUNT_DISCRIMINATOR);
   assert!(matches!(p.result, BetResult::Pending));
   assert_eq!(p.amount, expected_amount);
   assert_eq!(p.num_legs, num_legs);
   let exp_payout = calc_potential_payout(expected_amount, combined_odds_scaled).expect("payout");
   let exp_profit = calc_potential_profit(expected_amount, combined_odds_scaled).expect("profit");
   assert_eq!(p.payout, exp_payout);
   let mut fa = [0u8; 32];
   fa.copy_from_slice(p.filler_address.as_ref());
   assert_eq!(Pubkey::new_from_array(fa), mm_program_id());
   assert_eq!(
      read_encumbrance(env, enc_pda),
      enc_before + exp_profit as i64
   );
}

pub fn clone_account_stub() -> Account {
   Account {
      lamports: 1,
      data: vec![],
      owner: solana_sdk_ids::bpf_loader_upgradeable::id(),
      executable: true,
      rent_epoch: 0,
   }
}
