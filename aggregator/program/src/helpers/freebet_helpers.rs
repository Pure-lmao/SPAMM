//! Shared freebet PDA verify, stake-source signing, Used/reinstate/consume patches.

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer},
   error::ProgramError, hint::unlikely,
};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use super::{
   derive_pdas::{derive_freebet_issuer_pda, derive_freebet_pda},
   verify_token_account,
};
use crate::{
   ID,
   constants::FREEBET_REINSTATE_SECS,
   errors::SpammError,
   helpers::close_pda_return_rent,
   readers::{read_address_ref_unchecked, read_u8_unchecked, read_u32_le_unchecked},
   state::{
      bump_open_count, freebet_account_len, FreebetAccountData, FreebetState,
      FREEBET_ISSUER_AUTH_OFFSET, FREEBET_ISSUER_BUMP_OFFSET,
      FREEBET_ISSUER_DISCRIMINATOR, FREEBET_ISSUER_LEN, FREEBET_ISSUER_OPEN_COUNT_OFFSET,
      FREEBET_ISSUER_SEED, account_bet::BetResult,
   },
};

/// Owner, length, disc, stored auth, PDA seeds. Returns the bump (already read for seeds).
/// Peeks fixed offsets instead of `FreebetIssuer::decode` so callers can verify the issuer PDA
/// without a second full decode when `freebet_pda` is decoded separately in the same ix.
#[inline(always)]
pub fn verify_freebet_issuer_pda(
   issuer_pda: &AccountView,
   auth: &Address,
) -> Result<u8, ProgramError> {
   if unlikely(!address_eq(issuer_pda.owner(), &ID)) {
      log!("freebet: issuer pda owner");
      return Err(ProgramError::InvalidAccountOwner);
   }
   if unlikely(issuer_pda.data_len() != FREEBET_ISSUER_LEN) {
      log!("freebet: issuer pda len");
      return Err(ProgramError::InvalidAccountData);
   }
   let ptr = issuer_pda.data_ptr();
   let disc = unsafe { read_u8_unchecked(ptr, 0) };
   if unlikely(disc != FREEBET_ISSUER_DISCRIMINATOR) {
      log!("freebet: issuer disc");
      return Err(ProgramError::InvalidAccountData);
   }
   let bump = unsafe { read_u8_unchecked(ptr, FREEBET_ISSUER_BUMP_OFFSET) };
   let stored_auth = unsafe { read_address_ref_unchecked(ptr, FREEBET_ISSUER_AUTH_OFFSET) };
   if unlikely(!address_eq(stored_auth, auth)) {
      log!("freebet: issuer auth");
      return Err(ProgramError::InvalidAccountData);
   }
   let expected = derive_freebet_issuer_pda(auth, bump);
   if unlikely(!address_eq(issuer_pda.address(), &expected)) {
      log!("freebet: issuer pda seeds");
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(bump)
}

/// Caller must have already passed `verify_freebet_issuer_pda` (checks `data_len`).
#[inline(always)]
pub fn get_issuer_open_count(issuer_pda: &AccountView) -> u32 {
   unsafe { read_u32_le_unchecked(issuer_pda.data_ptr(), FREEBET_ISSUER_OPEN_COUNT_OFFSET) }
}

#[inline(always)]
pub fn issuer_signer_seeds<'a>(
   auth: &'a Address,
   bump: &'a [u8; 1],
) -> [Seed<'a>; 3] {
   [
      Seed::from(FREEBET_ISSUER_SEED),
      Seed::from(auth.as_ref()),
      Seed::from(bump.as_slice()),
   ]
}

#[inline(always)]
pub fn transfer_stake(
   from: &AccountView,
   to: &AccountView,
   authority: &AccountView,
   amount: u64,
   issuer_sign: Option<(u8, Address)>,
) -> ProgramResult {
   if let Some((bump, auth)) = issuer_sign {
      let bump_bytes = [bump];
      let seeds = issuer_signer_seeds(&auth, &bump_bytes);
      let signers = [Signer::from(&seeds)];
      Transfer::new(from, to, authority, amount).invoke_signed(&signers)?;
   } else {
      Transfer::new(from, to, authority, amount).invoke()?;
   }
   Ok(())
}

/// Owner + PDA seeds. Caller supplies fields from a single authoritative decode.
#[inline(always)]
pub fn verify_freebet_pda(
   freebet_pda: &AccountView,
   issuer_auth: &Address,
   freebet_id: u32,
   bump: u8,
) -> ProgramResult {
   if unlikely(!address_eq(freebet_pda.owner(), &ID)) {
      log!("freebet: pda owner");
      return Err(ProgramError::InvalidAccountOwner);
   }

   let expected = derive_freebet_pda(issuer_auth, freebet_id, bump);
   if unlikely(!address_eq(freebet_pda.address(), &expected)) {
      log!("freebet: pda seeds");
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(())
}

/// One borrow/decode of `freebet_pda`, then PDA + issuer checks. `ix_freebet_id` must match stored id.
#[inline(never)]
pub fn decode_and_verify_freebet_for_ix(
   freebet_pda: &AccountView,
   issuer_pda: &AccountView,
   ix_freebet_id: u32,
) -> Result<(FreebetAccountData, u8), ProgramError> {
   let fb = {
      let data = freebet_pda.try_borrow()?;
      FreebetAccountData::decode(data.as_ref())?
   };
   if unlikely(fb.freebet_id != ix_freebet_id) {
      log!("freebet: id mismatch");
      return Err(SpammError::InvalidFreebet.into());
   }
   verify_freebet_pda(freebet_pda, &fb.issuer_auth, fb.freebet_id, fb.bump)?;
   let issuer_bump = verify_freebet_issuer_pda(issuer_pda, &fb.issuer_auth)?;
   Ok((fb, issuer_bump))
}


/// Fill-time checks: Available, not expired, user, amount, legs.
#[inline(never)]
pub fn verify_freebet_for_fill(
   fb: &FreebetAccountData,
   user: &Address,
   amount: u64,
   num_legs: u8,
   now: u32,
) -> ProgramResult {
   if unlikely(fb.state != FreebetState::Available) {
      log!("freebet: not available");
      return Err(SpammError::FreebetNotAvailable.into());
   }
   if unlikely(now >= fb.expiry) {
      log!("freebet: expired");
      return Err(SpammError::FreebetExpired.into());
   }
   if unlikely(!address_eq(&fb.user, user)) {
      log!("freebet: user mismatch");
      return Err(SpammError::InvalidFreebet.into());
   }
   if unlikely(amount != fb.amount) {
      log!("freebet: amount mismatch");
      return Err(SpammError::FreebetAmountMismatch.into());
   }
   if unlikely(num_legs < fb.min_legs) {
      log!("freebet: min_legs");
      return Err(SpammError::FreebetLegCount.into());
   }
   Ok(())
}

#[inline(always)]
pub fn odds_in_freebet_range(odds_scaled: u32, fb: &FreebetAccountData) -> bool {
   odds_scaled >= fb.min_odds_scaled && odds_scaled <= fb.max_odds_scaled
}

#[inline(always)]
pub fn require_freebet_mm_allowed(fb: &FreebetAccountData, mm: &Address) -> ProgramResult {
   if fb.mm_allowed(mm) {
      Ok(())
   } else {
      log!("freebet: mm not allowed");
      Err(SpammError::FreebetMmNotAllowed.into())
   }
}

#[inline(always)]
pub fn require_freebet_operator_allowed(fb: &FreebetAccountData, operator: &Address) -> ProgramResult {
   if fb.operator_allowed(operator) {
      Ok(())
   } else {
      log!("freebet: operator not allowed");
      Err(SpammError::FreebetOperatorNotAllowed.into())
   }
}

#[inline(always)]
pub fn require_not_freebet(freebet_id: u32) -> ProgramResult {
   if unlikely(freebet_id != 0) {
      log!("freebet: ticket is a freebet");
      return Err(SpammError::InvalidFreebet.into());
   }
   Ok(())
}

#[inline(always)]
pub fn require_is_freebet(freebet_id: u32) -> ProgramResult {
   if unlikely(freebet_id == 0) {
      log!("freebet: ticket is not a freebet");
      return Err(SpammError::InvalidFreebet.into());
   }
   Ok(())
}

/// Settle-time freebet / issuer checks before token moves. Caller must already have decoded the
/// bet ticket and passed `require_is_freebet(ticket_freebet_id)`. Cross-checks ticket id vs PDA.
#[inline(never)]
pub fn verify_freebet_settle_preamble(
   ticket_freebet_id: u32,
   user: &AccountView,
   issuer_auth: &AccountView,
   issuer_pda: &AccountView,
   issuer_ata: &AccountView,
   freebet_pda: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
) -> ProgramResult {
   let header = {
      let data = freebet_pda.try_borrow()?;
      FreebetAccountData::decode_header(data.as_ref())?
   };
   if unlikely(header.freebet_id != ticket_freebet_id) {
      log!("freebet: settle ticket/pda id mismatch");
      return Err(SpammError::InvalidFreebet.into());
   }
   verify_freebet_issuer_pda(issuer_pda, issuer_auth.address())?;
   if unlikely(!address_eq(&header.issuer_auth, issuer_auth.address())) {
      log!("freebet: settle issuer_auth mismatch");
      return Err(SpammError::InvalidFreebet.into());
   }
   verify_freebet_pda(
      freebet_pda,
      &header.issuer_auth,
      header.freebet_id,
      header.bump,
   )?;
   if unlikely(header.state != FreebetState::Used) {
      log!("freebet: settle expects Used");
      return Err(SpammError::InvalidFreebet.into());
   }
   if unlikely(!address_eq(&header.user, user.address())) {
      log!("freebet: settle user mismatch");
      return Err(SpammError::InvalidFreebet.into());
   }
   verify_token_account(true, issuer_ata, issuer_pda, mint, token_program)?;
   Ok(())
}

#[inline(always)]
pub fn mark_freebet_used(freebet_pda: &mut AccountView) -> ProgramResult {
   let mut data = freebet_pda.try_borrow_mut()?;
   let header = FreebetAccountData::decode_header(data.as_ref())?;
   if unlikely(header.state != FreebetState::Available) {
      log!("freebet: mark used expects Available");
      return Err(SpammError::FreebetNotAvailable.into());
   }
   FreebetAccountData::patch_state(&mut data, FreebetState::Used)
}

#[inline(always)]
pub fn reinstate_freebet(
   freebet_pda: &mut AccountView,
   new_amount: Option<u64>,
   now: u32,
) -> ProgramResult {
   let expiry = now
      .checked_add(FREEBET_REINSTATE_SECS).ok_or(ProgramError::ArithmeticOverflow)?;
   let mut data = freebet_pda.try_borrow_mut()?;
   if let Some(amount) = new_amount {
      FreebetAccountData::patch_amount(&mut data, amount)?;
   }
   FreebetAccountData::patch_expiry(&mut data, expiry)?;
   FreebetAccountData::patch_state(&mut data, FreebetState::Available)
}

/// Close the freebet PDA (rent → `rent_dest`) and decrement issuer `open_count`.
#[inline(never)]
pub fn consume_freebet(
   freebet_pda: &mut AccountView,
   issuer_pda: &mut AccountView,
   rent_dest: &mut AccountView,
) -> ProgramResult {
   {
      let mut data = issuer_pda.try_borrow_mut()?;
      bump_open_count(&mut data, -1)?;
   }
   close_pda_return_rent(freebet_pda, rent_dest)
}

/// After settle tokens: reinstate, consume, or half-reinstate from the ticket grade.
#[inline(never)]
pub fn apply_freebet_settle_state(
   result: BetResult,
   orig_amount: u64,
   now: u32,
   freebet_pda: &mut AccountView,
   issuer_pda: &mut AccountView,
   rent_dest: &mut AccountView,
) -> ProgramResult {
   match result {
      BetResult::Push | BetResult::Cancelled | BetResult::RolledBack => {
         reinstate_freebet(freebet_pda, None, now)
      }
      BetResult::HalfWon | BetResult::HalfLost => {
         let half = orig_amount / 2;
         if half == 0 {
            consume_freebet(freebet_pda, issuer_pda, rent_dest)
         } else {
            reinstate_freebet(freebet_pda, Some(half), now)
         }
      }
      BetResult::Won | BetResult::Lost | BetResult::ModifiedWin => {
         consume_freebet(freebet_pda, issuer_pda, rent_dest)
      }
      BetResult::Pending => Err(SpammError::BetNotGraded.into()),
      BetResult::CashedOut => Err(SpammError::InvalidCashout.into()),
   }
}

#[inline(always)]
pub fn freebet_space(num_mms: usize, num_operators: usize) -> usize {
   freebet_account_len(num_mms, num_operators)
}
