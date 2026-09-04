//! Settle instruction metas.

use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use mollusk_svm_programs_token::token;
use spamm_aggregator::instructions::{SETTLE_BET_IX_DISCRIMINATOR, SETTLE_PARLAY_IX_DISCRIMINATOR};

use super::fixtures::*;

fn system_program_id() -> Pubkey {
   solana_sdk_ids::system_program::ID
}

fn settle_escrow_and_dest(owner: &Pubkey, ticket_id: u64) -> (AccountMeta, AccountMeta) {
   (
      AccountMeta::new_readonly(cashout_escrow_pda_for(owner, ticket_id), false),
      AccountMeta::new_readonly(user(), false),
   )
}

/// Single live filler group (no unused system-program placeholder slots).
/// Last filler account is the netting PDA (writable) or the system program (unnetted).
pub fn settle_bet_metas(bet_pda: Pubkey, bet_ata: Pubkey, ticket_id: u64) -> Vec<AccountMeta> {
   settle_bet_metas_with_netting(bet_pda, bet_ata, ticket_id, system_program_id())
}

pub fn settle_bet_metas_with_netting(
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   ticket_id: u64,
   netting_pda: Pubkey,
) -> Vec<AccountMeta> {
   let sys = system_program_id();
   let tok = token::ID;
   let mm = mm_program_id();
   let netting_meta = if netting_pda == sys {
      AccountMeta::new_readonly(sys, false)
   } else {
      AccountMeta::new(netting_pda, false)
   };
   let (escrow, dest_enc) = settle_escrow_and_dest(&user(), ticket_id);
   vec![
      AccountMeta::new(user(), true),
      AccountMeta::new(bet_pda, false),
      AccountMeta::new(bet_ata, false),
      AccountMeta::new(bet_feepayer(), false),
      AccountMeta::new_readonly(user(), false),
      AccountMeta::new(user_collateral_ata(), false),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(tok, false),
      escrow,
      dest_enc,
      AccountMeta::new_readonly(mm, false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      netting_meta,
   ]
}

pub fn settle_bet_instruction(bet_pda: Pubkey, bet_ata: Pubkey, ticket_id: u64) -> Instruction {
   Instruction::new_with_bytes(
      agg_program_id(),
      &[SETTLE_BET_IX_DISCRIMINATOR],
      settle_bet_metas(bet_pda, bet_ata, ticket_id),
   )
}

pub fn settle_bet_instruction_with_netting(
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   ticket_id: u64,
   netting_pda: Pubkey,
) -> Instruction {
   Instruction::new_with_bytes(
      agg_program_id(),
      &[SETTLE_BET_IX_DISCRIMINATOR],
      settle_bet_metas_with_netting(bet_pda, bet_ata, ticket_id, netting_pda),
   )
}

pub fn settle_parlay_metas(bet_pda: Pubkey, bet_ata: Pubkey, ticket_id: u64) -> Vec<AccountMeta> {
   let tok = token::ID;
   let mm = mm_program_id();
   let (escrow, dest_enc) = settle_escrow_and_dest(&user(), ticket_id);
   vec![
      AccountMeta::new(user(), true),
      AccountMeta::new(bet_pda, false),
      AccountMeta::new(bet_ata, false),
      AccountMeta::new(bet_feepayer(), false),
      AccountMeta::new_readonly(user(), false),
      AccountMeta::new(user_collateral_ata(), false),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(tok, false),
      AccountMeta::new_readonly(mm, false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      escrow,
      dest_enc,
   ]
}

pub fn settle_parlay_instruction(bet_pda: Pubkey, bet_ata: Pubkey, ticket_id: u64) -> Instruction {
   Instruction::new_with_bytes(
      agg_program_id(),
      &[SETTLE_PARLAY_IX_DISCRIMINATOR],
      settle_parlay_metas(bet_pda, bet_ata, ticket_id),
   )
}

/// Settle a single-bet **cashout** ticket: owner is the filling MM program id.
/// `user_ata` is the MM **liability** ATA (F7), not an ATA owned by the MM program id.
pub fn settle_cashout_metas(
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   orig_bet_id: u64,
) -> Vec<AccountMeta> {
   let sys = system_program_id();
   let tok = token::ID;
   let mm = mm_program_id();
   vec![
      AccountMeta::new(user(), true),
      AccountMeta::new(cashout_pda, false),
      AccountMeta::new(cashout_ata, false),
      AccountMeta::new(bet_feepayer(), false),
      AccountMeta::new_readonly(mm, false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new_readonly(config_pda(), false),
      AccountMeta::new_readonly(mint_pubkey(), false),
      AccountMeta::new_readonly(tok, false),
      AccountMeta::new_readonly(cashout_escrow_pda_for(&user(), orig_bet_id), false),
      AccountMeta::new_readonly(encumbrance_pda(), false),
      AccountMeta::new_readonly(mm, false),
      AccountMeta::new_readonly(mm_config_pda(), false),
      AccountMeta::new(encumbrance_pda(), false),
      AccountMeta::new(liability_token_ata(), false),
      AccountMeta::new_readonly(sys, false),
   ]
}

pub fn settle_cashout_instruction(
   cashout_pda: Pubkey,
   cashout_ata: Pubkey,
   orig_bet_id: u64,
) -> Instruction {
   Instruction::new_with_bytes(
      agg_program_id(),
      &[SETTLE_BET_IX_DISCRIMINATOR],
      settle_cashout_metas(cashout_pda, cashout_ata, orig_bet_id),
   )
}
