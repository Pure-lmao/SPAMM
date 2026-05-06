//! Settle instruction metas.

use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use mollusk_svm_programs_token::token;

use super::fixtures::*;

fn system_program_id() -> Pubkey {
   solana_sdk_ids::system_program::ID
}

/// Single filler + four unused filler slots (`system` placeholders).
pub fn settle_bet_metas(bet_pda: Pubkey, bet_ata: Pubkey) -> Vec<AccountMeta> {
   let sys = system_program_id();
   let tok = token::ID;
   let mm = mm_program_id();
   let mut m = vec![
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
      AccountMeta::new(mm_collateral_ata(), false),
   ];
   for _ in 0..4 {
      for _ in 0..5 {
         m.push(AccountMeta::new_readonly(sys, false));
      }
   }
   m
}

pub fn settle_bet_instruction(bet_pda: Pubkey, bet_ata: Pubkey) -> Instruction {
   Instruction::new_with_bytes(agg_program_id(), &[6u8], settle_bet_metas(bet_pda, bet_ata))
}

pub fn settle_parlay_metas(bet_pda: Pubkey, bet_ata: Pubkey) -> Vec<AccountMeta> {
   let tok = token::ID;
   let mm = mm_program_id();
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
      AccountMeta::new(mm_collateral_ata(), false),
   ]
}

pub fn settle_parlay_instruction(bet_pda: Pubkey, bet_ata: Pubkey) -> Instruction {
   Instruction::new_with_bytes(agg_program_id(), &[7u8], settle_parlay_metas(bet_pda, bet_ata))
}
