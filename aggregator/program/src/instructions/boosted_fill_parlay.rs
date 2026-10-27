//! Boosted auction parlay fill (disc 31). The user pays the stake. Issuer tokens move only at settle.
//!
//! Accounts: **15** then **6 + 2 × L** (`L` = `num_legs`).
//! Same fixed prefix as [`super::boosted_fill_bet`].
//!
//! **Fixed (15)**
//! 0. `feepayer` (writable signer)
//! 1. `user` (readonly signer)
//! 2. `user_ata` (writable) — stake source
//! 3. `issuer_pda` (readonly)
//! 4. `issuer_ata` (readonly) — checked, not debited
//! 5. `boost_pda` (writable) — marked used after a successful fill
//! 6. `bet_pda` (writable)
//! 7. `bet_ata` (writable)
//! 8. `config_pda` (readonly)
//! 9. `mint` (readonly)
//! 10. `token_program` (readonly)
//! 11. `associated_token_program` (readonly)
//! 12. `rent_sysvar` (readonly)
//! 13. `system_program` (readonly)
//! 14. `clock_sysvar` (readonly)
//!
//! **MM (6 + 2 × L)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_parlay_quote_buffer` (writable)
//! 3. `mm_encumbrance_pda` (writable)
//! 4. `mm_liability_token_account` (writable)
//! 5. `mm_token_account` (writable)
//! 6+2*i. `mm_market_data_pda` (readonly),
//!    `mm_event_state_pda` (readonly) per leg *i*
//!
//! Data: `boost_id: u32` then the fill_parlay body (header + [`ParlayLegSel`] × `num_legs`).
//!
//! The fat leg list stays inside `decode_and_run_fill_parlay`. Stake and leg count are peeked
//! from the ix header; the operator allow-list is checked on the written ticket.

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::{
   errors::SpammError,
   state::PromoType,
   helpers::{
      assert_boost_parlay, clock_unix_timestamp_u32, decode_and_verify_boost, mark_boost_used,
      verify_boost_before_fill, verify_token_account,
   },
   instructions::{
      fill_bet::FillBetStake,
      fill_parlay::decode_and_run_fill_parlay,
   },
   readers::read_u64_le_unchecked,
   state::{split_promo_id_prefix, FillParlayIxData, FILL_PARLAY_IX_HEADER_LEN},
};

pub const BOOSTED_FILL_PARLAY_IX_DISCRIMINATOR: u8 = 31;

#[inline(never)]
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      feepayer,
      user,
      user_ata,
      issuer_pda,
      issuer_ata,
      boost_pda,
      bet_pda,
      bet_ata,
      config_pda,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
      clock_sysvar,
      rest @ ..,
   ] = accounts else {
      log!("boosted_fill_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let (boost_id, ix_body) = split_promo_id_prefix(data, SpammError::InvalidBoost)?;
   if ix_body.len() < FILL_PARLAY_IX_HEADER_LEN {
      return Err(ProgramError::InvalidInstructionData);
   }
   let amount = unsafe { read_u64_le_unchecked(ix_body.as_ptr(), 8) };
   let num_legs = ix_body[FillParlayIxData::NUM_LEGS_OFFSET];
   let boost = decode_and_verify_boost(
      boost_pda,
      issuer_pda,
      boost_id,
      mint.address(),
   )?;
   verify_token_account(false, issuer_ata, issuer_pda, mint, token_program, true)?;
   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   verify_boost_before_fill(
      &boost,
      user.address(),
      mint.address(),
      amount,
      num_legs,
      &[],
      now,
   )?;
   decode_and_run_fill_parlay(
      feepayer,
      user,
      bet_pda,
      bet_ata,
      config_pda,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
      clock_sysvar,
      rest,
      ix_body,
      FillBetStake {
         token_account: user_ata,
         authority: user,
         issuer_sign: None,
         promo_type: PromoType::Boost,
         promo_account: *boost_pda.address(),
         freebet: None,
      },
   )?;
   assert_boost_parlay(bet_pda, &boost)?;
   mark_boost_used(boost_pda)
}
