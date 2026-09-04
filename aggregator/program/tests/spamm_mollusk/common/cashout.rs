//! Instruction builders for cashout fill / claim / revert / proxy paths.
//!
//! Rebuild the MM SBF (`cargo build-sbf --arch v3` from `market_maker/program`) so discs
//! 140–145 (`get_cashout_quote*` / `fill_cashout_*`) are present; tests load
//! `market_maker/program/target/deploy/spamm_market_maker.so`.

use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use mollusk_svm_programs_token::{associated_token, token};
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use spamm_aggregator::constants::{MAX_PARLAY_LEGS, MAX_RFQ_PARLAY_LEGS};
use spamm_aggregator::instructions::{
   FillCashoutIxData, FillParlayCashoutIxData, FillRfqCashoutIxData, FillRfqParlayCashoutIxData,
   CLAIM_CASHOUT_ESCROW_IX_DISCRIMINATOR, FILL_CASHOUT_IX_DATA_LEN, FILL_CASHOUT_IX_DISCRIMINATOR,
   FILL_PARLAY_CASHOUT_IX_DISCRIMINATOR, FILL_RFQ_CASHOUT_IX_DATA_LEN,
   FILL_RFQ_CASHOUT_IX_DISCRIMINATOR, FILL_RFQ_PARLAY_CASHOUT_IX_DISCRIMINATOR,
   FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN, GET_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR,
   GET_PARLAY_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR, REVERT_CASHOUT_IX_DISCRIMINATOR,
   CASHOUT_SNAPSHOT_LEN, FILL_PARLAY_CASHOUT_IX_HEADER_LEN,
};
use spamm_aggregator::state::{CashoutSnapshot, EventGameState, MarketId};

use super::fill::bet_token_ata;
use super::fixtures::*;

/// Fixed accounts before the first MM group on `fill_cashout` (through `clock_sysvar`).
pub const FILL_CASHOUT_MM_GROUP_OFFSET: usize = 18;
/// `fill_cashout` accounts per MM after the fixed prefix.
pub const FILL_CASHOUT_MM_ACCOUNTS: usize = 8;

fn system_program_id() -> Pubkey {
   mollusk_svm::program::keyed_account_for_system_program().0
}

/// Unused escrow slots for pregame (no delay).
pub fn cashout_escrow_placeholder() -> Pubkey {
   system_program_id()
}

pub fn fill_cashout_metas_one_mm(
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
   market: &MarketId,
) -> Vec<AccountMeta> {
   let sys = system_program_id();
   let eid = market.event_id;
   let escrow_pda_meta = if escrow_pda == sys {
      AccountMeta::new_readonly(sys, false)
   } else {
      AccountMeta::new(escrow_pda, false)
   };
   let escrow_ata_meta = if escrow_ata == sys {
      AccountMeta::new_readonly(sys, false)
   } else {
      AccountMeta::new(escrow_ata, false)
   };
   vec![
      AccountMeta::new(bet_feepayer(), true),
      AccountMeta::new(bet_feepayer(), false),
      AccountMeta::new_readonly(user(), true),
      AccountMeta::new(user_collateral_ata(), false),
      AccountMeta::new(bet_pda, false),
      AccountMeta::new(bet_ata, false),
      AccountMeta::new(cashout_pda, false),
      AccountMeta::new(cashout_ata, false),
      escrow_pda_meta,
      escrow_ata_meta,
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(token::ID, false),
      AccountMeta::new_readonly(associated_token::ID, false),
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(INSTRUCTIONS_SYSVAR_ID, false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new(mm_config_pda(), false),
      AccountMeta::new(event_state_pda(&eid), false),
      AccountMeta::new(market_data_pda(market), false),
      AccountMeta::new(mm_quote_buffer_pda(), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new(mm_collateral_ata(), false),
   ]
}

pub fn fill_cashout_instruction(
   data: &FillCashoutIxData,
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
   market: &MarketId,
) -> Instruction {
   let mut buf = vec![FILL_CASHOUT_IX_DISCRIMINATOR];
   let mut payload = [0u8; FILL_CASHOUT_IX_DATA_LEN];
   data.write_wire(&mut payload).expect("fill cashout wire");
   buf.extend_from_slice(&payload);
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      fill_cashout_metas_one_mm(
         bet_pda,
         bet_ata,
         cashout_pda,
         cashout_ata,
         escrow_pda,
         escrow_ata,
         market,
      ),
   )
}

pub fn fill_parlay_cashout_metas(
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
   markets: &[MarketId],
) -> Vec<AccountMeta> {
   let sys = system_program_id();
   let escrow_pda_meta = if escrow_pda == sys {
      AccountMeta::new_readonly(sys, false)
   } else {
      AccountMeta::new(escrow_pda, false)
   };
   let escrow_ata_meta = if escrow_ata == sys {
      AccountMeta::new_readonly(sys, false)
   } else {
      AccountMeta::new(escrow_ata, false)
   };
   let mut m = vec![
      AccountMeta::new(bet_feepayer(), true),
      AccountMeta::new(bet_feepayer(), false),
      AccountMeta::new_readonly(user(), true),
      AccountMeta::new(user_collateral_ata(), false),
      AccountMeta::new(bet_pda, false),
      AccountMeta::new(bet_ata, false),
      AccountMeta::new(cashout_pda, false),
      AccountMeta::new(cashout_ata, false),
      escrow_pda_meta,
      escrow_ata_meta,
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(token::ID, false),
      AccountMeta::new_readonly(associated_token::ID, false),
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(INSTRUCTIONS_SYSVAR_ID, false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new(mm_config_pda(), false),
      AccountMeta::new(mm_parlay_quote_buffer_pda(), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new(mm_collateral_ata(), false),
   ];
   for mid in markets {
      m.push(AccountMeta::new_readonly(market_data_pda(mid), false));
      m.push(AccountMeta::new_readonly(event_state_pda(&mid.event_id), false));
   }
   m
}

pub fn fill_parlay_cashout_instruction(
   payload: &FillParlayCashoutIxData,
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
   markets: &[MarketId],
) -> Instruction {
   let n = payload.num_legs as usize;
   let wire_len = FILL_PARLAY_CASHOUT_IX_HEADER_LEN + n * CASHOUT_SNAPSHOT_LEN;
   let mut wire = vec![0u8; wire_len];
   payload.write_wire(&mut wire).expect("parlay cashout wire");
   let mut buf = vec![FILL_PARLAY_CASHOUT_IX_DISCRIMINATOR];
   buf.extend_from_slice(&wire);
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      fill_parlay_cashout_metas(
         bet_pda,
         bet_ata,
         cashout_pda,
         cashout_ata,
         escrow_pda,
         escrow_ata,
         markets,
      ),
   )
}

pub fn fill_rfq_cashout_metas(
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
   market: &MarketId,
) -> Vec<AccountMeta> {
   let sys = system_program_id();
   let eid = market.event_id;
   let escrow_pda_meta = if escrow_pda == sys {
      AccountMeta::new_readonly(sys, false)
   } else {
      AccountMeta::new(escrow_pda, false)
   };
   let escrow_ata_meta = if escrow_ata == sys {
      AccountMeta::new_readonly(sys, false)
   } else {
      AccountMeta::new(escrow_ata, false)
   };
   vec![
      AccountMeta::new(bet_feepayer(), true),
      AccountMeta::new(bet_feepayer(), false),
      AccountMeta::new_readonly(user(), true),
      AccountMeta::new(user_collateral_ata(), false),
      AccountMeta::new(bet_pda, false),
      AccountMeta::new(bet_ata, false),
      AccountMeta::new(cashout_pda, false),
      AccountMeta::new(cashout_ata, false),
      escrow_pda_meta,
      escrow_ata_meta,
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(token::ID, false),
      AccountMeta::new_readonly(associated_token::ID, false),
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(INSTRUCTIONS_SYSVAR_ID, false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new(mm_config_pda(), false),
      AccountMeta::new(event_state_pda(&eid), false),
      AccountMeta::new(market_data_pda(market), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new(mm_collateral_ata(), false),
   ]
}

pub fn fill_rfq_cashout_instruction(
   data: &FillRfqCashoutIxData,
   signature: &[u8; 64],
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
   market: &MarketId,
) -> Instruction {
   let mut buf = vec![FILL_RFQ_CASHOUT_IX_DISCRIMINATOR];
   let mut payload = [0u8; FILL_RFQ_CASHOUT_IX_DATA_LEN];
   data.write_wire_with_signature(signature, &mut payload)
      .expect("fill rfq cashout wire");
   buf.extend_from_slice(&payload);
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      fill_rfq_cashout_metas(
         bet_pda,
         bet_ata,
         cashout_pda,
         cashout_ata,
         escrow_pda,
         escrow_ata,
         market,
      ),
   )
}

pub fn fill_rfq_parlay_cashout_metas(
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
   markets: &[MarketId],
) -> Vec<AccountMeta> {
   let sys = system_program_id();
   let escrow_pda_meta = if escrow_pda == sys {
      AccountMeta::new_readonly(sys, false)
   } else {
      AccountMeta::new(escrow_pda, false)
   };
   let escrow_ata_meta = if escrow_ata == sys {
      AccountMeta::new_readonly(sys, false)
   } else {
      AccountMeta::new(escrow_ata, false)
   };
   let m = vec![
      AccountMeta::new(bet_feepayer(), true),
      AccountMeta::new(bet_feepayer(), false),
      AccountMeta::new_readonly(user(), true),
      AccountMeta::new(user_collateral_ata(), false),
      AccountMeta::new(bet_pda, false),
      AccountMeta::new(bet_ata, false),
      AccountMeta::new(cashout_pda, false),
      AccountMeta::new(cashout_ata, false),
      escrow_pda_meta,
      escrow_ata_meta,
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(token::ID, false),
      AccountMeta::new_readonly(associated_token::ID, false),
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(INSTRUCTIONS_SYSVAR_ID, false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new(mm_config_pda(), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new(mm_collateral_ata(), false),
   ];
   let _ = markets;
   m
}

pub fn fill_rfq_parlay_cashout_instruction(
   data: &FillRfqParlayCashoutIxData,
   signature: &[u8; 64],
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
   markets: &[MarketId],
) -> Instruction {
   let n = data.num_legs as usize;
   let mut payload = vec![0u8; FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN + n * CASHOUT_SNAPSHOT_LEN + 64];
   data.write_wire_with_signature(signature, &mut payload)
      .expect("fill rfq parlay cashout wire");
   let mut buf = vec![FILL_RFQ_PARLAY_CASHOUT_IX_DISCRIMINATOR];
   buf.extend_from_slice(&payload);
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      fill_rfq_parlay_cashout_metas(
         bet_pda,
         bet_ata,
         cashout_pda,
         cashout_ata,
         escrow_pda,
         escrow_ata,
         markets,
      ),
   )
}

pub fn claim_cashout_escrow_metas(
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
   original_bet_pda: Pubkey,
   original_bet_ata: Pubkey,
   cashout_pda: Pubkey,
) -> Vec<AccountMeta> {
   let sys = system_program_id();
   vec![
      AccountMeta::new(bet_feepayer(), true),
      AccountMeta::new(bet_feepayer(), false),
      AccountMeta::new(bet_feepayer(), false),
      AccountMeta::new_readonly(user(), false),
      AccountMeta::new(user_collateral_ata(), false),
      AccountMeta::new(escrow_pda, false),
      AccountMeta::new(escrow_ata, false),
      AccountMeta::new(original_bet_pda, false),
      AccountMeta::new(original_bet_ata, false),
      AccountMeta::new_readonly(cashout_pda, false),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(token::ID, false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
   ]
}

pub fn claim_cashout_escrow_instruction(
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
   original_bet_pda: Pubkey,
   original_bet_ata: Pubkey,
   cashout_pda: Pubkey,
) -> Instruction {
   Instruction::new_with_bytes(
      agg_program_id(),
      &[CLAIM_CASHOUT_ESCROW_IX_DISCRIMINATOR],
      claim_cashout_escrow_metas(
         escrow_pda,
         escrow_ata,
         original_bet_pda,
         original_bet_ata,
         cashout_pda,
      ),
   )
}

pub fn revert_cashout_metas(
   original_bet_pda: Pubkey,
   original_bet_ata: Pubkey,
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
) -> Vec<AccountMeta> {
   let sys = system_program_id();
   vec![
      AccountMeta::new(bet_feepayer(), true),
      AccountMeta::new(bet_feepayer(), false),
      AccountMeta::new_readonly(user(), false),
      AccountMeta::new(user_collateral_ata(), false),
      AccountMeta::new(original_bet_pda, false),
      AccountMeta::new(original_bet_ata, false),
      AccountMeta::new(cashout_pda, false),
      AccountMeta::new(cashout_ata, false),
      AccountMeta::new(escrow_pda, false),
      AccountMeta::new(escrow_ata, false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new_readonly(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(token::ID, false),
      AccountMeta::new_readonly(sys, false),
   ]
}

pub fn revert_cashout_instruction(
   original_bet_pda: Pubkey,
   original_bet_ata: Pubkey,
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   escrow_pda: Pubkey,
   escrow_ata: Pubkey,
) -> Instruction {
   Instruction::new_with_bytes(
      agg_program_id(),
      &[REVERT_CASHOUT_IX_DISCRIMINATOR],
      revert_cashout_metas(
         original_bet_pda,
         original_bet_ata,
         cashout_pda,
         cashout_ata,
         escrow_pda,
         escrow_ata,
      ),
   )
}

pub fn get_cashout_quote_proxy_metas(bet_pda: Pubkey, market: &MarketId) -> Vec<AccountMeta> {
   let eid = market.event_id;
   vec![
      AccountMeta::new_readonly(user(), false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      AccountMeta::new_readonly(bet_pda, false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new_readonly(event_state_pda(&eid), false),
      AccountMeta::new_readonly(market_data_pda(market), false),
      AccountMeta::new(mm_quote_buffer_pda(), false),
   ]
}

pub fn get_cashout_quote_proxy_instruction(
   data: &FillCashoutIxData,
   bet_pda: Pubkey,
   market: &MarketId,
) -> Instruction {
   let mut buf = vec![GET_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR];
   let mut payload = [0u8; FILL_CASHOUT_IX_DATA_LEN];
   data.write_wire(&mut payload).expect("fill cashout wire");
   buf.extend_from_slice(&payload);
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      get_cashout_quote_proxy_metas(bet_pda, market),
   )
}

pub fn get_parlay_cashout_quote_proxy_metas(
   bet_pda: Pubkey,
   markets: &[MarketId],
) -> Vec<AccountMeta> {
   let mut m = vec![
      AccountMeta::new_readonly(user(), false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      AccountMeta::new_readonly(bet_pda, false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new(mm_parlay_quote_buffer_pda(), false),
   ];
   for mid in markets {
      m.push(AccountMeta::new_readonly(market_data_pda(mid), false));
      m.push(AccountMeta::new_readonly(event_state_pda(&mid.event_id), false));
   }
   m
}

pub fn get_parlay_cashout_quote_proxy_instruction(
   payload: &FillParlayCashoutIxData,
   bet_pda: Pubkey,
   markets: &[MarketId],
) -> Instruction {
   let n = payload.num_legs as usize;
   let wire_len = FILL_PARLAY_CASHOUT_IX_HEADER_LEN + n * CASHOUT_SNAPSHOT_LEN;
   let mut wire = vec![0u8; wire_len];
   payload.write_wire(&mut wire).expect("parlay cashout wire");
   let mut buf = vec![GET_PARLAY_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR];
   buf.extend_from_slice(&wire);
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      get_parlay_cashout_quote_proxy_metas(bet_pda, markets),
   )
}

/// Decode packed `get_cashout_quote_proxy` / parlay cashout proxy return (`ProxyCashoutQuoteData`).
pub fn decode_proxy_cashout_quote_return(data: &[u8]) -> Vec<(Pubkey, u64)> {
   use spamm_aggregator::constants::{ADDRESS_LEN, U64_LEN};
   use spamm_aggregator::state::PROXY_CASHOUT_QUOTE_DATA_LEN;
   assert!(
      data.len() % PROXY_CASHOUT_QUOTE_DATA_LEN == 0,
      "proxy cashout return len {} not multiple of {}",
      data.len(),
      PROXY_CASHOUT_QUOTE_DATA_LEN
   );
   let mut out = Vec::new();
   for chunk in data.chunks_exact(PROXY_CASHOUT_QUOTE_DATA_LEN) {
      let mm = Pubkey::new_from_array(chunk[0..ADDRESS_LEN].try_into().unwrap());
      let max_payment = u64::from_le_bytes(chunk[ADDRESS_LEN..ADDRESS_LEN + U64_LEN].try_into().unwrap());
      out.push((mm, max_payment));
   }
   out
}

/// Fair cash ≈ `amount * ODDS_SCALE / odds` capped at `payout - 1` (matches example MM).
pub fn expected_cashout_payment(amount: u64, payout: u64, odds_scaled: u32) -> u64 {
   use spamm_aggregator::constants::ODDS_SCALE;
   let fair = ((amount as u128)
      .saturating_mul(ODDS_SCALE)
      .checked_div(odds_scaled as u128).unwrap_or(0)) as u64;
   let cap = payout.saturating_sub(1);
   core::cmp::min(fair, cap)
}

pub fn parlay_cashout_snapshots(
   num_legs: u8,
   sequence: u16,
) -> [CashoutSnapshot; MAX_PARLAY_LEGS] {
   let mut out = [CashoutSnapshot::zeroed(); MAX_PARLAY_LEGS];
   for i in 0..num_legs as usize {
      out[i] = CashoutSnapshot {
         event_state_sequence: sequence,
         event_game_state: EventGameState::zeroed(),
      };
   }
   out
}

pub fn rfq_parlay_cashout_snapshots(
   num_legs: u8,
   sequence: u16,
) -> [CashoutSnapshot; MAX_RFQ_PARLAY_LEGS] {
   let mut out = [CashoutSnapshot::zeroed(); MAX_RFQ_PARLAY_LEGS];
   for i in 0..num_legs as usize {
      out[i] = CashoutSnapshot {
         event_state_sequence: sequence,
         event_game_state: EventGameState::zeroed(),
      };
   }
   out
}

/// Upsert empty cashout + escrow PDAs/ATAs for a fill (escrow may be system placeholder).
pub fn upsert_cashout_accounts(
   env: &mut super::env::Env,
   cashout_pda: Pubkey,
   escrow_pda: Pubkey,
) {
   env.upsert(cashout_pda, super::env::system_owned_empty());
   env.upsert(bet_token_ata(&cashout_pda), super::env::system_owned_empty());
   if escrow_pda != system_program_id() {
      env.upsert(escrow_pda, super::env::system_owned_empty());
      env.upsert(bet_token_ata(&escrow_pda), super::env::system_owned_empty());
   }
}

/// Credit extra tokens onto the MM liability ATA (free collateral above encumbrance).
pub fn credit_liability_free(env: &mut super::env::Env, extra: u64) {
   let ata = liability_token_ata();
   let before = super::read_token_balance(env, &ata);
   env.patch_spl_token_balance(ata, before.saturating_add(extra));
}

pub fn mm_quote_buffer_is_used(env: &super::env::Env) -> u8 {
   use spamm_aggregator::state::MMQuoteBuffer;
   let acct = env.get_account(&mm_quote_buffer_pda()).expect("quote buffer");
   acct.data[MMQuoteBuffer::IS_USED_OFFSET]
}

pub fn mm_parlay_quote_buffer_is_used(env: &super::env::Env) -> u8 {
   use spamm_aggregator::state::MMParlayQuoteBuffer;
   let acct = env
      .get_account(&mm_parlay_quote_buffer_pda())
      .expect("parlay quote buffer");
   acct.data[MMParlayQuoteBuffer::IS_USED_OFFSET]
}
