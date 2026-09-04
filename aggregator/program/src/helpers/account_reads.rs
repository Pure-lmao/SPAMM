use pinocchio::{AccountView, error::ProgramError, sysvars::clock::Clock};

use crate::{
   readers::{read_i64_le_unchecked, read_u64_le_unchecked}, state::{
      other::MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
   },
};

/// Caller must have already passed `verify_token_account` (checks `data_len`).
#[inline(always)]
pub fn get_token_account_balance(token_account: &AccountView) -> Result<u64, ProgramError> {
   const TOKEN_ACCOUNT_AMOUNT_OFFSET: usize = 64;
   Ok(unsafe { read_u64_le_unchecked(token_account.data_ptr(), TOKEN_ACCOUNT_AMOUNT_OFFSET) })
}

/// Caller must have already passed `verify_mm_encumbrance_pda` (checks `data_len`).
pub fn get_encumbrance(encumbrance_pda: &AccountView) -> Result<i64, ProgramError> {
   Ok(unsafe {
      read_i64_le_unchecked(encumbrance_pda.data_ptr(), MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET)
   })
}

/// Caller must have already passed `verify_clock_sysvar`.
#[inline(always)]
pub fn clock_unix_timestamp(clock: &AccountView) -> Result<i64, ProgramError> {
   // SAFETY: clock id verified; account is not mutably borrowed.
   Ok(unsafe { Clock::from_bytes_unchecked(clock.borrow_unchecked()) }.unix_timestamp)
}

/// Caller must have already passed `verify_clock_sysvar`.
#[inline(always)]
pub fn clock_unix_timestamp_u32(clock: &AccountView) -> Result<u32, ProgramError> {
   // SAFETY: clock id verified; account is not mutably borrowed.
   let now_i64 = clock_unix_timestamp(clock)?;
   now_i64.try_into().map_err(|_| ProgramError::InvalidAccountData)
}