//! Freebet issuer / fill / settle Mollusk builders.

use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

use mollusk_svm_programs_token::{associated_token, token};

use spamm_aggregator::instructions::{
   FillBetIxData, FillParlayIxData, FillRfqBetIxData, FillRfqParlayIxData, FILL_BET_IX_DATA_LEN,
   FILL_RFQ_BET_IX_DATA_LEN, FREEBET_FILL_BET_IX_DISCRIMINATOR, FREEBET_FILL_PARLAY_IX_DISCRIMINATOR,
   FREEBET_FILL_RFQ_BET_IX_DISCRIMINATOR, FREEBET_FILL_RFQ_PARLAY_IX_DISCRIMINATOR,
   INIT_FREEBET_ISSUER_IX_DISCRIMINATOR, ISSUE_FREEBET_IX_DISCRIMINATOR, ISSUE_FREEBET_IX_HEADER_LEN,
   IssueFreebetIxData, REMOVE_FREEBET_ISSUER_IX_DISCRIMINATOR, REVOKE_FREEBET_IX_DISCRIMINATOR,
   SETTLE_FREEBET_IX_DISCRIMINATOR, SETTLE_FREEBET_PARLAY_IX_DISCRIMINATOR,
   WITHDRAW_FREEBET_FUNDS_IX_DISCRIMINATOR,
};
use spamm_aggregator::constants::{ADDRESS_LEN, MAX_FREEBET_ALLOWED_MMS, MAX_FREEBET_ALLOWED_OPERATORS};
use spamm_aggregator::state::{
   FreebetAccountData, FreebetIssuer, MarketId, FREEBET_ISSUER_SEED, FREEBET_ACCOUNT_SEED,
};

use super::env::{rich_signer_account, system_owned_empty, Env, USER_COLLATERAL_TOKENS};
use super::fill::{
   fill_bet_metas_one_mm, fill_parlay_metas, fill_rfq_bet_metas, fill_rfq_parlay_metas,
};
use super::fixtures::*;
use super::settle::{settle_bet_metas, settle_parlay_metas};

pub const FREEBET_ID_BASIC: u32 = 7;
pub const FREEBET_EXPIRY: u32 = 1_000_000;

pub fn issuer_auth() -> Pubkey {
   Pubkey::new_from_array([0xA5; 32])
}

pub fn issuer_pda() -> Pubkey {
   Pubkey::find_program_address(&[FREEBET_ISSUER_SEED, issuer_auth().as_ref()], &agg_program_id()).0
}

pub fn issuer_ata() -> Pubkey {
   spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
      &issuer_pda(),
      &mint_pubkey(),
      &token::ID,
   )
}

pub fn issuer_auth_ata() -> Pubkey {
   spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
      &issuer_auth(),
      &mint_pubkey(),
      &token::ID,
   )
}

pub fn freebet_pda(freebet_id: u32) -> Pubkey {
   Pubkey::find_program_address(
      &[
         FREEBET_ACCOUNT_SEED,
         issuer_auth().as_ref(),
         &freebet_id.to_le_bytes(),
      ],
      &agg_program_id(),
   )
   .0
}

pub fn decode_issuer(env: &Env) -> FreebetIssuer {
   let acct = env
      .get_account(&issuer_pda())
      .unwrap_or_else(|| panic!("missing issuer pda"));
   FreebetIssuer::decode(&acct.data).expect("decode FreebetIssuer")
}

pub fn decode_freebet(env: &Env, freebet_id: u32) -> FreebetAccountData {
   let pk = freebet_pda(freebet_id);
   let acct = env
      .get_account(&pk)
      .unwrap_or_else(|| panic!("missing freebet {pk}"));
   FreebetAccountData::decode(&acct.data).expect("decode FreebetAccountData")
}

fn prefix_u32(disc: u8, id: u32, rest: &[u8]) -> Vec<u8> {
   let mut buf = Vec::with_capacity(1 + 4 + rest.len());
   buf.push(disc);
   buf.extend_from_slice(&id.to_le_bytes());
   buf.extend_from_slice(rest);
   buf
}

fn splice_freebet_accounts(mut metas: Vec<AccountMeta>, freebet_id: u32) -> Vec<AccountMeta> {
   metas.remove(2);
   metas.splice(
      2..2,
      [
         AccountMeta::new_readonly(issuer_pda(), false),
         AccountMeta::new(issuer_ata(), false),
         AccountMeta::new(freebet_pda(freebet_id), false),
      ],
   );
   metas
}

pub fn init_freebet_issuer_instruction() -> Instruction {
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   Instruction::new_with_bytes(
      agg_program_id(),
      &[INIT_FREEBET_ISSUER_IX_DISCRIMINATOR],
      vec![
         AccountMeta::new(issuer_auth(), true),
         AccountMeta::new(issuer_pda(), false),
         AccountMeta::new(issuer_ata(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
         AccountMeta::new_readonly(associated_token::ID, false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(sys, false),
      ],
   )
}

pub fn withdraw_freebet_funds_instruction(amount: u64) -> Instruction {
   let mut data = vec![WITHDRAW_FREEBET_FUNDS_IX_DISCRIMINATOR];
   data.extend_from_slice(&amount.to_le_bytes());
   Instruction::new_with_bytes(
      agg_program_id(),
      &data,
      vec![
         AccountMeta::new(issuer_auth(), true),
         AccountMeta::new_readonly(issuer_pda(), false),
         AccountMeta::new(issuer_ata(), false),
         AccountMeta::new(issuer_auth_ata(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
      ],
   )
}

pub fn remove_freebet_issuer_instruction() -> Instruction {
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   Instruction::new_with_bytes(
      agg_program_id(),
      &[REMOVE_FREEBET_ISSUER_IX_DISCRIMINATOR],
      vec![
         AccountMeta::new(issuer_auth(), true),
         AccountMeta::new(issuer_pda(), false),
         AccountMeta::new(issuer_ata(), false),
         AccountMeta::new(issuer_auth_ata(), false),
         AccountMeta::new_readonly(mint_pubkey(), false),
         AccountMeta::new_readonly(token::ID, false),
         AccountMeta::new_readonly(associated_token::ID, false),
         AccountMeta::new_readonly(sys, false),
      ],
   )
}

fn copy_addrs<const N: usize>(src: &[Pubkey]) -> [pinocchio::Address; N] {
   assert!(src.len() <= N);
   let mut out = [pinocchio::Address::default(); N];
   for (i, pk) in src.iter().enumerate() {
      out[i] = pinocchio::Address::new_from_array(pk.to_bytes());
   }
   out
}

pub fn issue_freebet_ix_data(
   freebet_id: u32,
   expiry: u32,
   amount: u64,
   min_odds_scaled: u32,
   max_odds_scaled: u32,
   min_legs: u8,
   allowed_mms: &[Pubkey],
   allowed_operators: &[Pubkey],
) -> Vec<u8> {
   let parsed = IssueFreebetIxData {
      freebet_id,
      expiry,
      amount,
      min_odds_scaled,
      max_odds_scaled,
      min_legs,
      num_mms: allowed_mms.len() as u8,
      num_operators: allowed_operators.len() as u8,
      allowed_mms: copy_addrs::<MAX_FREEBET_ALLOWED_MMS>(allowed_mms),
      allowed_operators: copy_addrs::<MAX_FREEBET_ALLOWED_OPERATORS>(allowed_operators),
   };
   let mut data = vec![
      0u8;
      ISSUE_FREEBET_IX_HEADER_LEN + allowed_mms.len() * ADDRESS_LEN + allowed_operators.len() * ADDRESS_LEN
   ];
   parsed.write_wire(&mut data).expect("issue freebet wire");
   data
}

pub fn issue_freebet_instruction(
   freebet_id: u32,
   expiry: u32,
   amount: u64,
   min_odds_scaled: u32,
   max_odds_scaled: u32,
   min_legs: u8,
   allowed_mms: &[Pubkey],
   allowed_operators: &[Pubkey],
) -> Instruction {
   let mut buf = vec![ISSUE_FREEBET_IX_DISCRIMINATOR];
   buf.extend_from_slice(&issue_freebet_ix_data(
      freebet_id,
      expiry,
      amount,
      min_odds_scaled,
      max_odds_scaled,
      min_legs,
      allowed_mms,
      allowed_operators,
   ));
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   Instruction::new_with_bytes(
      agg_program_id(),
      &buf,
      vec![
         AccountMeta::new(issuer_auth(), true),
         AccountMeta::new(issuer_pda(), false),
         AccountMeta::new_readonly(user(), false),
         AccountMeta::new(freebet_pda(freebet_id), false),
         AccountMeta::new_readonly(rent_sysvar_pubkey(), false),
         AccountMeta::new_readonly(sys, false),
         AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
      ],
   )
}

pub fn revoke_freebet_instruction(freebet_id: u32) -> Instruction {
   let mut data = vec![REVOKE_FREEBET_IX_DISCRIMINATOR];
   data.extend_from_slice(&freebet_id.to_le_bytes());
   Instruction::new_with_bytes(
      agg_program_id(),
      &data,
      vec![
         AccountMeta::new(issuer_auth(), true),
         AccountMeta::new(issuer_pda(), false),
         AccountMeta::new(freebet_pda(freebet_id), false),
      ],
   )
}

pub fn freebet_fill_bet_instruction(
   freebet_id: u32,
   data: &FillBetIxData,
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   market: &MarketId,
   mm_netting: Pubkey,
) -> Instruction {
   let mut payload = [0u8; FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut payload).expect("fill bet wire");
   Instruction::new_with_bytes(
      agg_program_id(),
      &prefix_u32(FREEBET_FILL_BET_IX_DISCRIMINATOR, freebet_id, &payload),
      splice_freebet_accounts(
         fill_bet_metas_one_mm(bet_pda, bet_ata, market, mm_netting),
         freebet_id,
      ),
   )
}

pub fn freebet_fill_parlay_instruction(
   freebet_id: u32,
   payload: &FillParlayIxData,
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   markets: &[MarketId],
) -> Instruction {
   let n = payload.num_legs as usize;
   let wire_len = FillParlayIxData::wire_len(n);
   let mut wire = vec![0u8; wire_len];
   payload.write_wire(&mut wire).expect("parlay wire");
   Instruction::new_with_bytes(
      agg_program_id(),
      &prefix_u32(FREEBET_FILL_PARLAY_IX_DISCRIMINATOR, freebet_id, &wire),
      splice_freebet_accounts(fill_parlay_metas(bet_pda, bet_ata, markets), freebet_id),
   )
}

pub fn freebet_fill_rfq_bet_instruction(
   freebet_id: u32,
   data: &FillRfqBetIxData,
   signature: &[u8; 64],
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   market: &MarketId,
   mm_netting: Pubkey,
) -> Instruction {
   let mut payload = [0u8; FILL_RFQ_BET_IX_DATA_LEN];
   data.write_wire_with_signature(signature, &mut payload)
      .expect("fill rfq bet wire");
   Instruction::new_with_bytes(
      agg_program_id(),
      &prefix_u32(FREEBET_FILL_RFQ_BET_IX_DISCRIMINATOR, freebet_id, &payload),
      splice_freebet_accounts(
         fill_rfq_bet_metas(bet_pda, bet_ata, market, mm_netting),
         freebet_id,
      ),
   )
}

pub fn freebet_fill_rfq_parlay_instruction(
   freebet_id: u32,
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
   Instruction::new_with_bytes(
      agg_program_id(),
      &prefix_u32(FREEBET_FILL_RFQ_PARLAY_IX_DISCRIMINATOR, freebet_id, &wire),
      splice_freebet_accounts(fill_rfq_parlay_metas(bet_pda, bet_ata), freebet_id),
   )
}

pub fn settle_freebet_instruction(bet_pda: Pubkey, bet_ata: Pubkey, freebet_id: u32) -> Instruction {
   let mut metas = settle_bet_metas(bet_pda, bet_ata, 0);
   // settle_freebet has its own account list (no cashout escrow / dest encumbrance).
   metas.remove(10);
   metas.remove(9);
   metas.splice(
      6..6,
      [
         AccountMeta::new(issuer_auth(), false),
         AccountMeta::new(issuer_pda(), false),
         AccountMeta::new(issuer_ata(), false),
         AccountMeta::new(freebet_pda(freebet_id), false),
      ],
   );
   metas.insert(
      13,
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
   );
   Instruction::new_with_bytes(
      agg_program_id(),
      &[SETTLE_FREEBET_IX_DISCRIMINATOR],
      metas,
   )
}

pub fn settle_freebet_parlay_instruction(
   bet_pda: Pubkey,
   bet_ata: Pubkey,
   ticket_id: u64,
   freebet_id: u32,
) -> Instruction {
   let mut metas = settle_parlay_metas(bet_pda, bet_ata, ticket_id);
   metas.truncate(metas.len().saturating_sub(2));
   metas.splice(
      6..6,
      [
         AccountMeta::new(issuer_auth(), false),
         AccountMeta::new(issuer_pda(), false),
         AccountMeta::new(issuer_ata(), false),
         AccountMeta::new(freebet_pda(freebet_id), false),
      ],
   );
   metas.insert(
      13,
      AccountMeta::new_readonly(clock_sysvar_pubkey(), false),
   );
   Instruction::new_with_bytes(
      agg_program_id(),
      &[SETTLE_FREEBET_PARLAY_IX_DISCRIMINATOR],
      metas,
   )
}

/// Init issuer + fund ATA + issue an open freebet for `user()`.
pub fn bootstrap_issued_freebet(
   env: &mut Env,
   freebet_id: u32,
   amount: u64,
   min_odds_scaled: u32,
   max_odds_scaled: u32,
   min_legs: u8,
   allowed_mms: &[Pubkey],
   allowed_operators: &[Pubkey],
) {
   env.upsert(issuer_auth(), rich_signer_account());
   env.upsert(issuer_pda(), system_owned_empty());
   env.upsert(issuer_ata(), system_owned_empty());
   env.upsert(freebet_pda(freebet_id), system_owned_empty());
   env.set_clock_unix_timestamp(1);
   let r = env.run_ix(init_freebet_issuer_instruction());
   assert!(r.program_result.is_ok(), "init_freebet_issuer {:?}", r);
   env.patch_spl_token_balance(issuer_ata(), USER_COLLATERAL_TOKENS);
   let r = env.run_ix(issue_freebet_instruction(
      freebet_id,
      FREEBET_EXPIRY,
      amount,
      min_odds_scaled,
      max_odds_scaled,
      min_legs,
      allowed_mms,
      allowed_operators,
   ));
   assert!(r.program_result.is_ok(), "issue_freebet {:?}", r);
}
