//! Instruction builders for fill paths.

use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use mollusk_svm_programs_token::{associated_token, token};
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use spamm_aggregator::instructions::{FillBetIxData, FillParlayIxData, FILL_BET_IX_DATA_LEN, FILL_PARLAY_IX_DATA_LEN};
use spamm_aggregator::state::{EventGameState, MarketId, ParlayLegTable, ParlayLegWire};

use super::fixtures::*;

/// Netting PDA slot on `fill_bet` when no netting account exists: system program (matches on-chain convention).
pub fn fill_bet_netting_placeholder() -> Pubkey {
   mollusk_svm::program::keyed_account_for_system_program().0
}

pub fn bet_token_ata(bet_pda: &Pubkey) -> Pubkey {
   spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
      bet_pda,
      &mint_pubkey(),
      &token::ID,
   )
}

pub fn fill_bet_metas_one_mm(
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   market: &MarketId,
   mm_netting: Pubkey,
) -> Vec<AccountMeta> {
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let eid = market.event_id;
   vec![
      AccountMeta::new(bet_feepayer(), true),
      AccountMeta::new_readonly(user(), true),
      AccountMeta::new(user_collateral_ata(), false),
      AccountMeta::new(bet_pda, false),
      AccountMeta::new(bet_ata, false),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(token::ID, false),
      AccountMeta::new_readonly(associated_token::ID, false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(INSTRUCTIONS_SYSVAR_ID, false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new(mm_config_pda(), false),
      AccountMeta::new_readonly(event_state_pda(&eid), false),
      AccountMeta::new(market_data_pda(market), false),
      AccountMeta::new(mm_quote_buffer_pda(), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new(mm_collateral_ata(), false),
      AccountMeta::new(mm_netting, false),
   ]
}

pub fn fill_bet_instruction(
   data: &FillBetIxData,
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   market: &MarketId,
   mm_netting: Pubkey,
) -> Instruction {
   let mut buf = vec![3u8];
   let mut payload = [0u8; FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut payload).expect("fill bet wire");
   buf.extend_from_slice(&payload);
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      fill_bet_metas_one_mm(bet_pda, bet_ata, market, mm_netting),
   )
}

/// One MM parlay path: `markets` order matches leg order in the instruction payload.
pub fn fill_parlay_metas(bet_pda: Pubkey, bet_ata: Pubkey, markets: &[MarketId]) -> Vec<AccountMeta> {
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let mut m = vec![
      AccountMeta::new(bet_feepayer(), true),
      AccountMeta::new_readonly(user(), true),
      AccountMeta::new(user_collateral_ata(), false),
      AccountMeta::new(bet_pda, false),
      AccountMeta::new(bet_ata, false),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(token::ID, false),
      AccountMeta::new_readonly(associated_token::ID, false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(INSTRUCTIONS_SYSVAR_ID, false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new(mm_config_pda(), false),
      AccountMeta::new(mm_parlay_quote_buffer_pda(), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new(mm_collateral_ata(), false),
   ];
   for mid in markets {
      m.push(AccountMeta::new(market_data_pda(mid), false));
      m.push(AccountMeta::new_readonly(event_state_pda(&mid.event_id), false));
   }
   m
}

pub fn fill_parlay_instruction(payload: &FillParlayIxData, bet_pda: Pubkey, bet_ata: Pubkey, markets: &[MarketId]) -> Instruction {
   let mut buf = vec![4u8];
   let mut wire = [0u8; FILL_PARLAY_IX_DATA_LEN];
   payload.write_wire(&mut wire).expect("parlay wire");
   buf.extend_from_slice(&wire);
   Instruction::new_with_bytes(agg_program_id(), &buf, fill_parlay_metas(bet_pda, bet_ata, markets))
}

pub fn parlay_leg(market_id: MarketId, side: u8, seq: u16, game_state: EventGameState) -> ParlayLegWire {
   ParlayLegWire {
      market_id,
      side,
      event_state_sequence: seq,
      event_game_state: game_state,
   }
}

pub fn parlay_table(legs: &[ParlayLegWire]) -> ParlayLegTable {
   assert!(!legs.is_empty(), "at least one leg");
   let pad = *legs.last().unwrap();
   let g = |i: usize| legs.get(i).copied().unwrap_or(pad);
   ParlayLegTable {
      leg_0: g(0),
      leg_1: g(1),
      leg_2: g(2),
      leg_3: g(3),
      leg_4: g(4),
   }
}
