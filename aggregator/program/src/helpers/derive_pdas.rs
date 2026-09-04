//! PDA address helpers. Const string seeds live here; callers pass seed values and bump.

use pinocchio::Address;

use crate::{
   ID,
   state::{
      BET_ACCOUNT_SEED, CASHOUT_ACCOUNT_SEED, CASHOUT_ESCROW_SEED, CASHOUT_PARLAY_ACCOUNT_SEED,
      EVENT_STATE_SEED, EventId, FREEBET_ACCOUNT_SEED, FREEBET_ISSUER_SEED, MARKET_ID_LEN,
      MM_ACCOUNT_CONFIG_SEED, NETTING_PDA_SEED, PARLAY_BET_ACCOUNT_SEED, market_id_pda_seed_parts,
      other::{MM_ENCUMBRANCE_PDA_SEED, MM_MARKET_DATA_PDA_SEED},
   },
};

#[inline(always)]
pub fn derive_bet_pda(user: &Address, bet_id: u64, bump: u8) -> Address {
   let id = bet_id.to_le_bytes();
   Address::derive_address(
      &[BET_ACCOUNT_SEED, user.as_ref(), id.as_slice()],
      Some(bump),
      &ID,
   )
}

#[inline(always)]
pub fn find_bet_pda(user: &Address, bet_id: u64) -> (Address, u8) {
   let id = bet_id.to_le_bytes();
   Address::find_program_address(
      &[BET_ACCOUNT_SEED, user.as_ref(), id.as_slice()], 
      &ID
   )
}

#[inline(always)]
pub fn derive_parlay_pda(user: &Address, bet_id: u64, bump: u8) -> Address {
   let id = bet_id.to_le_bytes();
   Address::derive_address(
      &[PARLAY_BET_ACCOUNT_SEED, user.as_ref(), id.as_slice()],
      Some(bump),
      &ID,
   )
}

#[inline(always)]
pub fn find_parlay_pda(user: &Address, bet_id: u64) -> (Address, u8) {
   let id = bet_id.to_le_bytes();
   Address::find_program_address(
      &[PARLAY_BET_ACCOUNT_SEED, user.as_ref(), id.as_slice()],
      &ID,
   )
}

#[inline(always)]
pub fn derive_cashout_pda(mm: &Address, cashout_id: u64, bump: u8) -> Address {
   let id = cashout_id.to_le_bytes();
   Address::derive_address(
      &[CASHOUT_ACCOUNT_SEED, mm.as_ref(), id.as_slice()],
      Some(bump),
      &ID,
   )
}

#[inline(always)]
pub fn find_cashout_pda(mm: &Address, cashout_id: u64) -> (Address, u8) {
   let id = cashout_id.to_le_bytes();
   Address::find_program_address(
      &[CASHOUT_ACCOUNT_SEED, mm.as_ref(), id.as_slice()],
      &ID,
   )
}

#[inline(always)]
pub fn derive_cashout_parlay_pda(mm: &Address, cashout_id: u64, bump: u8) -> Address {
   let id = cashout_id.to_le_bytes();
   Address::derive_address(
      &[CASHOUT_PARLAY_ACCOUNT_SEED, mm.as_ref(), id.as_slice()],
      Some(bump),
      &ID,
   )
}

#[inline(always)]
pub fn find_cashout_parlay_pda(mm: &Address, cashout_id: u64) -> (Address, u8) {
   let id = cashout_id.to_le_bytes();
   Address::find_program_address(
      &[CASHOUT_PARLAY_ACCOUNT_SEED, mm.as_ref(), id.as_slice()],
      &ID,
   )
}

#[inline(always)]
pub fn derive_cashout_escrow_pda(owner: &Address, orig_bet_id: u64, bump: u8) -> Address {
   let id = orig_bet_id.to_le_bytes();
   Address::derive_address(
      &[CASHOUT_ESCROW_SEED, owner.as_ref(), id.as_slice()],
      Some(bump),
      &ID,
   )
}

#[inline(always)]
pub fn find_cashout_escrow_pda(owner: &Address, orig_bet_id: u64) -> (Address, u8) {
   let id = orig_bet_id.to_le_bytes();
   Address::find_program_address(
      &[CASHOUT_ESCROW_SEED, owner.as_ref(), id.as_slice()], &ID,
   )
}

#[inline(always)]
pub fn derive_freebet_pda(auth: &Address, freebet_id: u32, bump: u8) -> Address {
   let id = freebet_id.to_le_bytes();
   Address::derive_address(
      &[FREEBET_ACCOUNT_SEED, auth.as_ref(), id.as_slice()],
      Some(bump),
      &ID,
   )
}

#[inline(always)]
pub fn find_freebet_pda(auth: &Address, freebet_id: u32) -> (Address, u8) {
   let id = freebet_id.to_le_bytes();
   Address::find_program_address(
      &[FREEBET_ACCOUNT_SEED, auth.as_ref(), id.as_slice()], &ID,
   )
}

#[inline(always)]
pub fn derive_freebet_issuer_pda(auth: &Address, bump: u8) -> Address {
   Address::derive_address(
      &[FREEBET_ISSUER_SEED, auth.as_ref()], 
      Some(bump), 
      &ID,
   )
}

#[inline(always)]
pub fn find_freebet_issuer_pda(auth: &Address) -> (Address, u8) {
   Address::find_program_address(
      &[FREEBET_ISSUER_SEED, auth.as_ref()], 
      &ID,
   )
}

#[inline(always)]
pub fn derive_netting_pda(
   mm_program: &Address,
   event_id: &[u8; EventId::WIRE_SIZE],
   bump: u8,
) -> Address {
   Address::derive_address(
      &[NETTING_PDA_SEED, mm_program.as_ref(), event_id.as_slice()],
      Some(bump),
      &ID,
   )
}

#[inline(always)]
pub fn find_netting_pda(
   mm_program: &Address,
   event_id: &[u8; EventId::WIRE_SIZE],
) -> (Address, u8) {
   Address::find_program_address(
      &[NETTING_PDA_SEED, mm_program.as_ref(), event_id.as_slice()],
      &ID,
   )
}

#[inline(always)]
pub fn derive_encumbrance_pda(mm_program: &Address, bump: u8) -> Address {
   Address::derive_address(
      &[MM_ENCUMBRANCE_PDA_SEED, mm_program.as_ref()],
      Some(bump),
      &ID,
   )
}

#[inline(always)]
pub fn find_encumbrance_pda(mm_program: &Address) -> (Address, u8) {
   Address::find_program_address(
      &[MM_ENCUMBRANCE_PDA_SEED, mm_program.as_ref()], 
      &ID,
   )
}

#[inline(always)]
pub fn derive_mm_market_data_pda(
   mm_program: &Address,
   market_id: &[u8; MARKET_ID_LEN],
   bump: u8,
) -> Address {
   let (body, operator) = market_id_pda_seed_parts(market_id);
   Address::derive_address(
      &[MM_MARKET_DATA_PDA_SEED, body, operator],
      Some(bump),
      mm_program,
   )
}

#[inline(always)]
pub fn derive_event_state_pda(
   mm_program: &Address,
   event_id: &[u8; EventId::WIRE_SIZE],
   bump: u8,
) -> Address {
   Address::derive_address(
      &[EVENT_STATE_SEED, event_id.as_slice()],
      Some(bump),
      mm_program,
   )
}

#[inline(always)]
pub fn derive_mm_config_pda(mm_program: &Address, bump: u8) -> Address {
   Address::derive_address(
      &[MM_ACCOUNT_CONFIG_SEED], 
      Some(bump), 
      mm_program
   )
}
