//! Shared RFQ / cashout fill collateral transfer (config PDA signer).

use pinocchio::{AccountView, ProgramResult, hint::unlikely};
use pinocchio_log::log;

use crate::{
   instructions::token_transfer::transfer_mm_config_signed,
   state::FillRfqIxPayload,
};

#[inline(always)]
pub fn transfer_mm_collateral(
   mm_config_pda: &AccountView,
   mm_token_account: &AccountView,
   payment_dest: &AccountView,
   data: &[u8],
   label: &str,
) -> ProgramResult {
   let ix_data = FillRfqIxPayload::decode(data)?;
   if unlikely(ix_data.amount_to_send == 0) {
      return Ok(());
   }
   transfer_mm_config_signed(
      mm_config_pda,
      mm_token_account,
      payment_dest,
      ix_data.amount_to_send,
   )
   .map_err(|e| {
      log!("{}: transfer failed", label);
      e
   })
}
