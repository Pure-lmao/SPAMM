//! Shared logic for fill / RFQ fill / settle token-batch helpers.

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer, get_return_data},
   error::ProgramError, hint::{likely, unlikely},
};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::{
   parsers::{parse_parlay_quote_data, parse_quote_data},
   state::other::MM_ENCUMBRANCE_PDA_SEED,
};

/// Parse CPI return data from a prior MM `get_quote` when the return program id matches.
#[inline(always)]
pub fn parse_quote_return_for_mm(mm_program_account: &AccountView) -> Option<(u64, u32)> {
   let return_data = match get_return_data() {
      Some(rd) => rd,
      None => {
         #[cfg(feature = "log")]
         log!("fill_helpers: parse_quote_return_for_mm: get_return_data empty after CPI");
         return None;
      }
   };
   if unlikely(!address_eq(return_data.program_id(), mm_program_account.address())) {
      #[cfg(feature = "log")]
      log!("fill_helpers: parse_quote_return_for_mm: return data owner != expected MM program id");
      return None;
   }
   let slice = return_data.as_slice();
   match parse_quote_data(slice) {
      Ok(parsed) => Some(parsed),
      Err(_) => {
         #[cfg(feature = "log")]
         log!("fill_helpers: parse_quote_return_for_mm: parse_quote_data failed len {}", slice.len());
         None
      }
   }
}

/// Parse parlay CPI return (`GetParlayQuoteReturnWire`).
#[inline(always)]
pub fn parse_parlay_quote_return_for_mm(
   mm_program_account: &AccountView,
) -> Option<(u64, u32, u8, [u32; crate::constants::MAX_PARLAY_LEGS])> {
   let return_data = get_return_data()?;
   if unlikely(!address_eq(return_data.program_id(), mm_program_account.address())) {
      return None;
   }
   parse_parlay_quote_data(return_data.as_slice()).ok()
}

/// Bet / parlay PDA must be empty before `CreateAccount` (fail early before quote/fill CPIs).
#[inline(always)]
pub fn ensure_bet_pda_unused(bet_pda: &AccountView, label: &str) -> ProgramResult {
   if unlikely(bet_pda.lamports() > 0 || bet_pda.data_len() > 0) {
      log!("{}: bet pda already initialized", label);
      return Err(ProgramError::AccountAlreadyInitialized);
   }
   Ok(())
}

/// Free collateral vs encumbrance: returns `(amount_to_send, new_outstanding_liability)`.
#[inline(always)]
pub fn compute_liability_shortfall(
   liability_balance: u64,
   outstanding_liability: i64,
   encumbrance_delta: i64,
) -> Result<(u64, i64), ProgramError> {
   let balance_i64: i64 = liability_balance.try_into().map_err(|_| {
      log!("fill_helpers: liability balance does not fit i64");
      ProgramError::InvalidAccountData
   })?;
   let encumbered_i64: i64 = if outstanding_liability < 0 {
      0
   } else {
      outstanding_liability
   };
   let free_i64: i64 = balance_i64.saturating_sub(encumbered_i64);
   let shortfall_i64: i64 = encumbrance_delta.saturating_sub(free_i64);
   let amount_to_send: u64 = if shortfall_i64 <= 0 {
      0u64
   } else {
      shortfall_i64.try_into().map_err(|_| {
         log!("fill_helpers: shortfall does not fit u64");
         ProgramError::InvalidInstructionData
      })?
   };
   let new_outstanding: i64 = outstanding_liability
      .checked_add(encumbrance_delta)
      .ok_or_else(|| {
         log!("fill_helpers: outstanding liability overflow");
         ProgramError::InvalidInstructionData
      })?;
   Ok((amount_to_send, new_outstanding))
}

/// If the MM liability ATA increased by something other than `amount_to_send`, sweep that deposit back
/// to the MM token account (multi-MM `fill_bet` soft-continue path only).
#[inline(always)]
pub fn refund_liability_deposit_mismatch(
   mm_encumbrance_pda: &mut AccountView,
   encumbrance_bump: u8,
   mm_address: Address,
   mm_liability_token_account: &AccountView,
   mm_token_account: &AccountView,
   amount_to_send: u64,
   mm_liability_token_account_increase: u64,
) -> ProgramResult {
   if likely(mm_liability_token_account_increase == amount_to_send) {
      return Ok(());
   }
   let bump_seed = &[encumbrance_bump];
   let enc_seeds = [
      Seed::from(MM_ENCUMBRANCE_PDA_SEED),
      Seed::from(mm_address.as_ref()),
      Seed::from(bump_seed),
   ];
   let signers = [Signer::from(&enc_seeds)];
   Transfer::new(
      mm_liability_token_account,
      mm_token_account,
      mm_encumbrance_pda,
      mm_liability_token_account_increase,
   )
   .invoke_signed(&signers)?;
   #[cfg(feature = "log")]
   log!("fill_helpers: refunded unexpected liability token movement");
   Ok(())
}
