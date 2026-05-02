//! Shared logic for [`super::fill_bet::fill_bet`] and [`super::fill_parlay::fill_parlay`].

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer, get_return_data},
   hint::{likely, unlikely},
};
#[cfg(feature = "log")]
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::{
   parsers::parse_quote_data,
   state::other::MM_ENCUMBRANCE_PDA_SEED,
};

/// Parse CPI return data from a prior MM `get_quote` / `get_quote_parlay` when the return program id matches.
#[inline(always)]
pub fn parse_quote_return_for_mm(mm_program_account: &AccountView) -> Option<(u64, u32)> {
   let return_data = get_return_data()?;
   if unlikely(!address_eq(return_data.program_id(), mm_program_account.address())) {
      return None;
   }
   parse_quote_data(return_data.as_slice()).ok()
}

/// If the MM liability ATA increased by something other than `amount_to_send`, sweep that deposit back
/// to the MM token account (same policy as `fill_bet`).
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
