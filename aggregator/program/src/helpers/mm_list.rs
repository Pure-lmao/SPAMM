//! MM list PDA length / membership helpers shared by `register_mm` and `deregister_mm`.

use pinocchio::{AccountView, Address, address::address_eq, error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{
   readers::{read_address_ref_unchecked, read_u16_le_unchecked},
   state::{
      MM_LIST_HEADER_LEN,
      other::{MM_LIST_ENTRY_LEN, MM_LIST_PDA_NUMBER_OF_MMS_OFFSET},
   },
};

/// Read `number_of_mms` and require `data_len == header + entries`.
#[inline(always)]
pub fn read_mm_list_count(mm_list: &AccountView) -> Result<usize, ProgramError> {
   let data_len = mm_list.data_len();
   if unlikely(data_len < MM_LIST_HEADER_LEN) {
      log!("mm_list: data too short");
      return Err(ProgramError::InvalidAccountData);
   }

   let number_of_mms =
      unsafe { read_u16_le_unchecked(mm_list.data_ptr(), MM_LIST_PDA_NUMBER_OF_MMS_OFFSET) }
         as usize;
   let expected_len = MM_LIST_HEADER_LEN
      .checked_add(
         number_of_mms
            .checked_mul(MM_LIST_ENTRY_LEN)
            .ok_or(ProgramError::ArithmeticOverflow)?,
      )
      .ok_or(ProgramError::ArithmeticOverflow)?;
   if unlikely(data_len != expected_len) {
      log!("mm_list: length does not match number_of_mms");
      return Err(ProgramError::InvalidAccountData);
   }
   Ok(number_of_mms)
}

/// Fail if `mm_program` is already listed. Returns the validated entry count.
#[inline(always)]
pub fn ensure_mm_program_not_in_list(
   mm_list: &AccountView,
   mm_program: &Address,
) -> Result<usize, ProgramError> {
   let number_of_mms = read_mm_list_count(mm_list)?;
   let ptr = mm_list.data_ptr();
   for i in 0..number_of_mms {
      let off = MM_LIST_HEADER_LEN + i * MM_LIST_ENTRY_LEN;
      if unlikely(address_eq(
         unsafe { read_address_ref_unchecked(ptr, off) },
         mm_program,
      )) {
         log!("mm_list: mm_program already registered");
         return Err(ProgramError::InvalidAccountData);
      }
   }
   Ok(number_of_mms)
}

/// Find `mm_program` in the list. Returns `(index, number_of_mms)`.
#[inline(always)]
pub fn find_mm_program_in_list(
   mm_list: &AccountView,
   mm_program: &Address,
) -> Result<(usize, usize), ProgramError> {
   let number_of_mms = read_mm_list_count(mm_list)?;
   let ptr = mm_list.data_ptr();
   for i in 0..number_of_mms {
      let off = MM_LIST_HEADER_LEN + i * MM_LIST_ENTRY_LEN;
      if address_eq(unsafe { read_address_ref_unchecked(ptr, off) }, mm_program) {
         return Ok((i, number_of_mms));
      }
   }
   log!("mm_list: mm_program not in list");
   Err(ProgramError::InvalidAccountData)
}
