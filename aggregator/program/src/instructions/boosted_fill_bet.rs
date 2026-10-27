//! Boosted auction fill (disc 30). The user pays the stake. Issuer tokens move only at settle.
//!
//! Accounts: **15** then **9 × N** (`N` = number of market makers).
//! `fill_bet`'s 12, with `issuer_pda`, `issuer_ata`, and `boost_pda` inserted after `user_ata`.
//!
//! **Fixed (15)**
//! 0. `feepayer` (writable signer) — pays netting PDA rent if a fill inserts a new line
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
//! **Per MM (9 each)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_event_state_pda` (writable on fill) — verified before quote CPI; readonly on quote CPI
//! 3. `mm_market_data_pda` (writable on fill) — verified before quote CPI; readonly on quote CPI
//! 4. `mm_quote_buffer` (writable)
//! 5. `mm_encumbrance_pda` (writable)
//! 6. `mm_liability_token_account` (writable)
//! 7. `mm_token_account` (writable)
//! 8. `mm_netting_pda` (writable) — real netting PDA, or **system program** if no netting account exists
//!
//! Data: `boost_id: u32` then [`FillBetIxData`].

use pinocchio::{AccountView, ProgramResult, error::ProgramError};
use pinocchio_log::log;

use crate::{
   state::PromoType,
   helpers::{
      assert_boost_single_fillers, clock_unix_timestamp_u32, decode_and_verify_boost, mark_boost_used,
      verify_boost_before_fill, verify_token_account,
   },
   instructions::fill_bet::{FillBetStake, run_fill_bet},
   errors::SpammError,
   state::{split_promo_id_prefix, FillBetIxData},
};

pub const BOOSTED_FILL_BET_IX_DISCRIMINATOR: u8 = 30;

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
      mm_accounts @ ..,
   ] = accounts else {
      log!("boosted_fill_bet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let (boost_id, ix_body) = split_promo_id_prefix(data, SpammError::InvalidBoost)?;
   let parsed = FillBetIxData::decode(ix_body)?;
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
      parsed.amount,
      1,
      &[parsed.market_id.operator],
      now,
   )?;
   run_fill_bet(
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
      mm_accounts,
      parsed,
      FillBetStake {
         token_account: user_ata,
         authority: user,
         issuer_sign: None,
         promo_type: PromoType::Boost,
         promo_account: *boost_pda.address(),
         freebet: None,
      },
   )?;
   assert_boost_single_fillers(bet_pda, &boost)?;
   mark_boost_used(boost_pda)
}
