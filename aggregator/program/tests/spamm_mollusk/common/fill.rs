//! Instruction builders for fill paths.

use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use mollusk_svm_programs_token::{associated_token, token};

use spamm_aggregator::instructions::{
   FillBetIxData, FillParlayIxData, FillRfqBetIxData, FillRfqParlayIxData, FILL_BET_IX_DATA_LEN,
   FILL_BET_IX_DISCRIMINATOR, FILL_PARLAY_IX_DISCRIMINATOR, FILL_RFQ_BET_IX_DATA_LEN,
   FILL_RFQ_BET_IX_DISCRIMINATOR, FILL_RFQ_PARLAY_IX_DISCRIMINATOR, GRADE_PARLAY_IX_DISCRIMINATOR,
};
use spamm_aggregator::constants::{MAX_PARLAY_LEGS, MAX_RFQ_PARLAY_LEGS};
use spamm_aggregator::state::{EventGameState, MarketId, ParlayLegQuoted, ParlayLegSel};

use super::fixtures::*;
use super::mm_keys::MmKeys;

/// Fixed accounts before the first MM group on `fill_bet` / `fill_parlay` (through `clock_sysvar`).
pub const FILL_MM_GROUP_OFFSET: usize = 12;
/// `fill_bet` accounts per MM after the fixed prefix.
pub const FILL_BET_MM_ACCOUNTS: usize = 9;

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
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new(mm_config_pda(), false),
      AccountMeta::new(event_state_pda(&eid), false),
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
   let mut buf = vec![FILL_BET_IX_DISCRIMINATOR];
   let mut payload = [0u8; FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut payload).expect("fill bet wire");
   buf.extend_from_slice(&payload);
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      fill_bet_metas_one_mm(bet_pda, bet_ata, market, mm_netting),
   )
}

pub fn fill_bet_fixed_metas(bet_pda: Pubkey, bet_ata: Pubkey) -> Vec<AccountMeta> {
   fill_bet_fixed_metas_for(user(), user_collateral_ata(), bet_pda, bet_ata)
}

pub fn fill_bet_fixed_metas_for(
   user_pk: Pubkey,
   user_ata: Pubkey,
   bet_pda: Pubkey,
   bet_ata: Pubkey,
) -> Vec<AccountMeta> {
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   vec![
      AccountMeta::new(bet_feepayer(), true),
      AccountMeta::new_readonly(user_pk, true),
      AccountMeta::new(user_ata, false),
      AccountMeta::new(bet_pda, false),
      AccountMeta::new(bet_ata, false),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(token::ID, false),
      AccountMeta::new_readonly(associated_token::ID, false),
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
   ]
}

pub fn fill_bet_instruction_mms(
   data: &FillBetIxData,
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   groups: &[(&MmKeys, Pubkey)],
   market: &MarketId,
) -> Instruction {
   fill_bet_instruction_mms_for(user(), user_collateral_ata(), data, bet_pda, bet_ata, groups, market)
}

pub fn fill_bet_instruction_mms_for(
   user_pk: Pubkey,
   user_ata: Pubkey,
   data: &FillBetIxData,
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   groups: &[(&MmKeys, Pubkey)],
   market: &MarketId,
) -> Instruction {
   let mut metas = fill_bet_fixed_metas_for(user_pk, user_ata, bet_pda, bet_ata);
   for (keys, netting) in groups {
      metas.extend(keys.fill_bet_group(market, *netting));
   }
   let mut buf = vec![FILL_BET_IX_DISCRIMINATOR];
   let mut payload = [0u8; FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut payload).expect("fill bet wire");
   buf.extend_from_slice(&payload);
   Instruction::new_with_bytes(agg_program_id(), &buf, metas)
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
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(sys, false),
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

pub fn fill_parlay_instruction(payload: &FillParlayIxData, bet_pda: Pubkey, bet_ata: Pubkey, markets: &[MarketId]) -> Instruction {
   fill_parlay_instruction_for(MmKeys::default_mm(), payload, bet_pda, bet_ata, markets)
}

pub fn fill_parlay_instruction_for(
   keys: MmKeys,
   payload: &FillParlayIxData,
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   markets: &[MarketId],
) -> Instruction {
   let mut m = fill_bet_fixed_metas(bet_pda, bet_ata);
   m.extend(keys.fill_parlay_group());
   for mid in markets {
      m.push(AccountMeta::new_readonly(keys.market_data(mid), false));
      m.push(AccountMeta::new_readonly(keys.event_state(&mid.event_id), false));
   }
   let n = payload.num_legs as usize;
   let wire_len = FillParlayIxData::wire_len(n);
   let mut wire = vec![0u8; wire_len];
   payload.write_wire(&mut wire).expect("parlay wire");
   let mut buf = vec![FILL_PARLAY_IX_DISCRIMINATOR];
   buf.extend_from_slice(&wire);
   Instruction::new_with_bytes(agg_program_id(), &buf, m)
}


pub fn fill_rfq_bet_metas(
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
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new(mm_config_pda(), false),
      AccountMeta::new(event_state_pda(&eid), false),
      AccountMeta::new(market_data_pda(market), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new(mm_collateral_ata(), false),
      AccountMeta::new(mm_netting, false),
   ]
}

pub fn fill_rfq_bet_instruction(
   data: &FillRfqBetIxData,
   signature: &[u8; 64],
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   market: &MarketId,
   mm_netting: Pubkey,
) -> Instruction {
   let mut buf = vec![FILL_RFQ_BET_IX_DISCRIMINATOR];
   let mut payload = [0u8; FILL_RFQ_BET_IX_DATA_LEN];
   data.write_wire_with_signature(signature, &mut payload)
      .expect("fill rfq bet wire");
   buf.extend_from_slice(&payload);
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      fill_rfq_bet_metas(bet_pda, bet_ata, market, mm_netting),
   )
}

pub fn fill_rfq_bet_instruction_for(
   keys: &MmKeys,
   data: &FillRfqBetIxData,
   signature: &[u8; 64],
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   market: &MarketId,
   mm_netting: Pubkey,
) -> Instruction {
   let mut metas = fill_bet_fixed_metas(bet_pda, bet_ata);
   metas.extend(keys.fill_rfq_bet_group(market, mm_netting));
   let mut buf = vec![FILL_RFQ_BET_IX_DISCRIMINATOR];
   let mut payload = [0u8; FILL_RFQ_BET_IX_DATA_LEN];
   data.write_wire_with_signature(signature, &mut payload)
      .expect("fill rfq bet wire");
   buf.extend_from_slice(&payload);
   Instruction::new_with_bytes(agg_program_id(), &buf, metas)
}

pub fn fill_rfq_parlay_metas(bet_pda: Pubkey, bet_ata: Pubkey) -> Vec<AccountMeta> {
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
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
      AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      AccountMeta::new_readonly(mm_program_id(), false),
      AccountMeta::new(mm_config_pda(), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new(mm_collateral_ata(), false),
   ]
}

pub fn fill_rfq_parlay_instruction(
   payload: &FillRfqParlayIxData,
   signature: &[u8; 64],
   bet_pda: Pubkey,
   bet_ata: Pubkey,
) -> Instruction {
   let n = payload.num_legs as usize;
   let wire_len = FillRfqParlayIxData::wire_len(n);
   let mut wire = vec![0u8; wire_len];
   payload
      .write_wire_with_signature(signature, &mut wire)
      .expect("fill rfq parlay wire");
   let mut buf = vec![FILL_RFQ_PARLAY_IX_DISCRIMINATOR];
   buf.extend_from_slice(&wire);
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      fill_rfq_parlay_metas(bet_pda, bet_ata),
   )
}

pub fn parlay_leg(market_id: MarketId, side: u8, seq: u16, game_state: EventGameState) -> ParlayLegSel {
   ParlayLegSel {
      market_id,
      side,
      event_state_sequence: seq,
      event_game_state: game_state,
   }
}

/// Pack live legs into a fixed `fill_parlay` / get-quote buffer array (unused slots are placeholders).
pub fn parlay_legs_fill(legs: &[ParlayLegSel]) -> Box<[ParlayLegSel; MAX_PARLAY_LEGS]> {
   assert!(legs.len() <= MAX_PARLAY_LEGS, "too many legs for fill_parlay");
   let mut out = [ParlayLegSel::placeholder(); MAX_PARLAY_LEGS];
   out[..legs.len()].copy_from_slice(legs);
   Box::new(out)
}

/// Pack live legs into a fixed RFQ parlay ix / bet PDA array (unused slots are placeholders).
pub fn parlay_legs_rfq(legs: &[ParlayLegQuoted]) -> [ParlayLegQuoted; MAX_RFQ_PARLAY_LEGS] {
   assert!(legs.len() <= MAX_RFQ_PARLAY_LEGS, "too many legs for RFQ parlay");
   let mut out = [ParlayLegQuoted::placeholder(); MAX_RFQ_PARLAY_LEGS];
   out[..legs.len()].copy_from_slice(legs);
   out
}

/// Build a `grade_parlay` mask (`255` = skip leg); length equals `num_legs` (no padding).
pub fn grade_parlay_leg_mask(leg_grades: &[u8]) -> Vec<u8> {
   leg_grades.to_vec()
}

pub fn grade_parlay_instruction(
   mask: &[u8],
   bet: Pubkey,
   authority: Pubkey,
) -> Instruction {
   Instruction::new_with_bytes(
      agg_program_id(),
      &[GRADE_PARLAY_IX_DISCRIMINATOR]
         .into_iter()
         .chain(mask.iter().copied())
         .collect::<Vec<_>>(),
      vec![
         AccountMeta::new(authority, true),
         AccountMeta::new_readonly(config_pda(), false),
         AccountMeta::new(bet, false),
      ],
   )
}
