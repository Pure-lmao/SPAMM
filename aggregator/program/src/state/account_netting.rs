use core::mem::offset_of;

use pinocchio::{AccountView, error::ProgramError, hint::unlikely};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   helpers::calc_potential_profit,
   readers::{self, read_i64_pair_unchecked, read_u8_unchecked, read_u32_le_unchecked},
   state::{EventId, MarketId, Sport},
   writers::{self, write_i64_le_unchecked, write_i64_pair_unchecked, write_netting_line_unchecked, write_u8_unchecked},
};

pub const NETTING_PDA_SEED: &[u8] = b"netting";
pub const NETTING_PDA_DISCRIMINATOR: u8 = 5;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct NettingPdaDataHeader {
   pub discriminator: u8,
   pub bump: u8,
   pub event_id: EventId,
   pub home: i64,
   pub draw: i64,
   pub away: i64,
   pub number_of_lines: u8,
}


#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct NettingLine {
   pub period: u8,
   pub mkt: u32,
   pub outcome_0: i64,
   pub outcome_1: i64,
}

pub const NETTING_HEADER_LEN: usize = <NettingPdaDataHeader as ZeroPodFixed>::SIZE;
pub const NETTING_LINE_LEN: usize = <NettingLine as ZeroPodFixed>::SIZE;
pub const NETTING_PDA_MIN_LEN: usize = NETTING_HEADER_LEN;

/// Line capacity for newly allocated netting PDAs (`create_netting_account`).
pub const NETTING_DEFAULT_LINE_CAPACITY: usize = 10;
pub const NETTING_ACCOUNT_ALLOC_LEN: usize =
   NETTING_HEADER_LEN + NETTING_DEFAULT_LINE_CAPACITY * NETTING_LINE_LEN;

const NETTING_DISC_OFFSET: usize = offset_of!(NettingPdaDataHeaderZc, discriminator);
const NETTING_FT_OFFSET: usize = offset_of!(NettingPdaDataHeaderZc, home);
const NETTING_NUMBER_OF_LINES_OFFSET: usize = offset_of!(NettingPdaDataHeaderZc, number_of_lines);

const NETTING_LINE_PERIOD_OFFSET: usize = offset_of!(NettingLineZc, period);
const NETTING_LINE_MKT_OFFSET: usize = offset_of!(NettingLineZc, mkt);

/// `number_of_lines` from account data must not exceed table capacity, and the buffer must be at
/// least the size allocated by `create_netting_account` so line indices stay in-bounds.
#[inline(always)]
pub(crate) fn ensure_netting_lines_view(
   data: &[u8],
   number_of_lines: usize,
) -> Result<(), ProgramError> {
   if unlikely(number_of_lines > NETTING_DEFAULT_LINE_CAPACITY) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(data.len() < NETTING_ACCOUNT_ALLOC_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }
   Ok(())
}

/// Binary search on lines sorted by `(period, mkt)` ascending. Returns `Ok(index)` if that key
/// exists, otherwise `Err(insertion_index)` where a new line would belong.
#[inline(always)]
pub(crate) fn find_netting_line_or_insertion(
   data: &[u8],
   lines_start: usize,
   number_of_lines: usize,
   period: u8,
   mkt: u32,
) -> Result<usize, usize> {
   let mut lo = 0usize;
   let mut hi = number_of_lines;
   let key = (period, mkt);
   while lo < hi {
      let mid = lo + ((hi - lo) / 2);
      let line_offset = lines_start + (mid * NETTING_LINE_LEN);
      if unlikely(line_offset + NETTING_LINE_LEN > data.len()) {
         return Err(lo);
      }
      let this_period = unsafe {
         read_u8_unchecked(data.as_ptr(), line_offset + NETTING_LINE_PERIOD_OFFSET)
      };
      let this_mkt =
         unsafe { read_u32_le_unchecked(data.as_ptr(), line_offset + NETTING_LINE_MKT_OFFSET) };
      let this_key = (this_period, this_mkt);
      if this_key < key {
         lo = mid + 1;
      } else if this_key > key {
         hi = mid;
      } else {
         return Ok(mid);
      }
   }
   Err(lo)
}

/// Shifts sorted lines to open a slot at `insertion_idx`, writes `(period, mkt)` and zero outcomes,
/// increments `number_of_lines`. Call only when the key is absent (`find_netting_line_or_insertion`
/// returned `Err(insertion_idx)`).
#[inline(always)]
pub(crate) fn insert_blank_netting_line_at(
   data: &mut [u8],
   lines_start: usize,
   number_of_lines: usize,
   period: u8,
   mkt: u32,
   insertion_idx: usize,
) -> Result<(), ProgramError> {
   ensure_netting_lines_view(data, number_of_lines)?;
   if unlikely(number_of_lines >= NETTING_DEFAULT_LINE_CAPACITY) {
      return Err(ProgramError::InvalidAccountData);
   }
   let new_number_of_lines = number_of_lines + 1;
   let lines_total_len = number_of_lines
      .checked_mul(NETTING_LINE_LEN)
      .ok_or(ProgramError::ArithmeticOverflow)?;
   if unlikely(insertion_idx > number_of_lines) {
      return Err(ProgramError::InvalidAccountData);
   }

   let insertion_offset = lines_start + (insertion_idx * NETTING_LINE_LEN);
   let old_end = lines_start + lines_total_len;
   if insertion_offset < old_end {
      data.copy_within(
         insertion_offset..old_end,
         insertion_offset + NETTING_LINE_LEN,
      );
   }

   unsafe {
      write_netting_line_unchecked(
         data.as_mut_ptr(), insertion_offset, NettingLine {
            period,
            mkt,
            outcome_0: 0,
            outcome_1: 0,
         });
      write_u8_unchecked(
         data.as_mut_ptr(),
         NETTING_NUMBER_OF_LINES_OFFSET,
         new_number_of_lines as u8,
      );
   }
   Ok(())
}

/// Inserts a new zeroed line for `(period, mkt)` in sorted order. Errors if that key already
/// exists, the table is full, the key is reserved for header-only netting, or account data is invalid.
#[inline(always)]
pub fn add_netting_line(
   data: &mut [u8],
   sport: Sport,
   period: u8,
   mkt: u32,
) -> Result<(), ProgramError> {
   if unlikely(!MarketId::allow_add_netting_line(sport, period, mkt)) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(data.len() < NETTING_HEADER_LEN || data[NETTING_DISC_OFFSET] != NETTING_PDA_DISCRIMINATOR) {
      return Err(ProgramError::InvalidAccountData);
   }
   let number_of_lines =
      unsafe { read_u8_unchecked(data.as_ptr(), NETTING_NUMBER_OF_LINES_OFFSET) } as usize;
   ensure_netting_lines_view(data, number_of_lines)?;
   let lines_start = NETTING_HEADER_LEN;
   let insertion_idx = match find_netting_line_or_insertion(
      data, lines_start, number_of_lines, period, mkt,
   ) {
      Ok(_) => return Err(ProgramError::InvalidAccountData),
      Err(i) => i,
   };
   insert_blank_netting_line_at(
      data, lines_start, number_of_lines, period, mkt, insertion_idx,
   )
}

/// Removes the line with the given `(period, mkt)` if present. Fails if no line matches.
#[inline(always)]
pub fn remove_netting_line(data: &mut [u8], period: u8, mkt: u32) -> Result<(), ProgramError> {
   if unlikely(data.len() < NETTING_HEADER_LEN || data[NETTING_DISC_OFFSET] != NETTING_PDA_DISCRIMINATOR) {
      return Err(ProgramError::InvalidAccountData);
   }
   let number_of_lines =
      unsafe { read_u8_unchecked(data.as_ptr(), NETTING_NUMBER_OF_LINES_OFFSET) } as usize;
   if unlikely(number_of_lines == 0) {
      return Err(ProgramError::InvalidAccountData);
   }
   ensure_netting_lines_view(data, number_of_lines)?;
   let lines_start = NETTING_HEADER_LEN;
   let lines_total_len = match number_of_lines.checked_mul(NETTING_LINE_LEN) {
      Some(v) => v,
      None => return Err(ProgramError::ArithmeticOverflow),
   };
   let idx = match find_netting_line_or_insertion(
      data, lines_start, number_of_lines, period, mkt,
   ) {
      Ok(i) => i,
      Err(_) => return Err(ProgramError::InvalidInstructionData),
   };
   // Compact sorted lines upward: copy everything after the removed slot down, then clear the
   // vacated tail slot so unused space at the bottom matches freshly allocated (zero) bytes.
   let old_n = number_of_lines;
   let new_n = old_n - 1;
   let remove_off = lines_start + (idx * NETTING_LINE_LEN);
   let tail_start = remove_off + NETTING_LINE_LEN;
   let tail_end = lines_start + lines_total_len;
   if tail_start < tail_end {
      data.copy_within(tail_start..tail_end, remove_off);
   }
   let clear_start = lines_start + (new_n * NETTING_LINE_LEN);
   let clear_end = lines_start + (old_n * NETTING_LINE_LEN);
   if clear_start < clear_end {
      data[clear_start..clear_end].fill(0);
   }
   let new_count = new_n as u8;
   unsafe {
      write_u8_unchecked(data.as_mut_ptr(), NETTING_NUMBER_OF_LINES_OFFSET, new_count);
   }
   Ok(())
}

#[inline(always)]
pub fn apply_netting(
   netting_pda: &AccountView,
   market_id: &MarketId,
   side: u8,
   amount_filled: u64,
   odds_scaled: u32,
) -> (bool, i64) {
   let m_id = *market_id;
   let sport = m_id.event_id.sport;
   let period = m_id.period;
   let mkt = m_id.mkt;

   let in_100_to_300 = mkt.wrapping_sub(100) <= 200;
   let in_1000_to_2000 = mkt.wrapping_sub(1000) <= 1000;
   let is_valid_netting_mkt = if sport == Sport::Soccer {
      mkt == 1 || mkt == 4 || in_100_to_300 || in_1000_to_2000
   } else {
      mkt == 0 || in_100_to_300 || in_1000_to_2000
   };
   if unlikely(!is_valid_netting_mkt) {
      return (false, 0i64);
   }

   let data = unsafe {
      core::slice::from_raw_parts_mut(
         netting_pda.data_ptr() as *mut u8,
         netting_pda.data_len(),
      )
   };
   if data.len() < NETTING_HEADER_LEN || data[NETTING_DISC_OFFSET] != NETTING_PDA_DISCRIMINATOR {
      return (false, 0i64);
   }

   let profit_on_win_u64 = calc_potential_profit(amount_filled, odds_scaled);
   let profit_on_win: i64 = if let Ok(value) = profit_on_win_u64 { 
      value.try_into().ok().unwrap_or(0)
   } else { return (false, 0i64) };
   
   let amount_filled_i64 = match i64::try_from(amount_filled) {
      Ok(value) => value,
      Err(_) => return (false, 0i64),
   };

   if sport == Sport::Soccer && mkt == 1 {
      let outcome_index = side as usize;
      let mut ft = [0i64; 3];
      for (i, value) in ft.iter_mut().enumerate() {
         let start = NETTING_FT_OFFSET + (i * 8);
         *value = unsafe { readers::read_i64_le_unchecked(data.as_ptr(), start) };
      }

      let old_net = max3(ft[0], ft[1], ft[2]);
      for (i, value) in ft.iter_mut().enumerate() {
         if i == outcome_index {
            *value = match value.checked_add(profit_on_win) {
               Some(v) => v,
               None => return (false, 0i64),
            };
         } else {
            *value = match value.checked_sub(amount_filled_i64) {
               Some(v) => v,
               None => return (false, 0i64),
            };
         }
      }
      let new_net = max3(ft[0], ft[1], ft[2]);

      for (i, value) in ft.iter().enumerate() {
         let start = NETTING_FT_OFFSET + (i * 8);
         unsafe { writers::write_i64_le_unchecked(data.as_mut_ptr(), start, *value) };
      }

      return (true, signed_reserve_delta(old_net, new_net));
   }

   if sport != Sport::Soccer && mkt == 0 {
      let selected_index = if side == 0 { 0usize } else { 2usize };
      let opposing_index = if side == 0 { 2usize } else { 0usize };

      let mut ft = [0i64; 3];
      for (i, value) in ft.iter_mut().enumerate() {
         let start = NETTING_FT_OFFSET + (i * 8);
         *value = unsafe { readers::read_i64_le_unchecked(data.as_ptr(), start) };
      }

      let old_net = max3(ft[0], ft[1], ft[2]);
      ft[selected_index] = match ft[selected_index].checked_add(profit_on_win) {
         Some(v) => v,
         None => return (false, 0i64),
      };
      ft[opposing_index] = match ft[opposing_index].checked_sub(amount_filled_i64) {
         Some(v) => v,
         None => return (false, 0i64),
      };
      let new_net = max3(ft[0], ft[1], ft[2]);

      for (i, value) in ft.iter().enumerate() {
         let start = NETTING_FT_OFFSET + (i * 8);
         unsafe { write_i64_le_unchecked(data.as_mut_ptr(), start, *value) };
      }

      return (true, signed_reserve_delta(old_net, new_net));
   }

   let number_of_lines =
      unsafe { read_u8_unchecked(data.as_ptr(), NETTING_NUMBER_OF_LINES_OFFSET) } as usize;

   match ensure_netting_lines_view(data, number_of_lines) {
      Ok(()) => {}
      Err(_) => return (false, 0i64),
   }
   let lines_start = NETTING_HEADER_LEN;

   let line_idx = match find_netting_line_or_insertion(
      data, lines_start, number_of_lines, period, mkt,
   ) {
      Ok(idx) => idx,
      Err(insertion_idx) => {
         if unlikely(!MarketId::allow_add_netting_line(sport, period, mkt)) {
            return (false, 0i64);
         }
         match insert_blank_netting_line_at(
            data,
            lines_start,
            number_of_lines,
            period,
            mkt,
            insertion_idx,
         ) {
            Ok(()) => insertion_idx,
            Err(_) => return (false, 0i64),
         }
      }
   };

   let line_offset = lines_start + (line_idx * NETTING_LINE_LEN);
   let side0_offset = line_offset + offset_of!(NettingLineZc, outcome_0);

   let (mut side0, mut side1) = unsafe { read_i64_pair_unchecked(data.as_ptr(), side0_offset) };

   let old_net = max2(side0, side1);
   if side == 0 {
      side0 = match side0.checked_add(profit_on_win) {
         Some(v) => v,
         None => return (false, 0i64),
      };
      side1 = match side1.checked_sub(amount_filled_i64) {
         Some(v) => v,
         None => return (false, 0i64),
      };
   } else {
      side1 = match side1.checked_add(profit_on_win) {
         Some(v) => v,
         None => return (false, 0i64),
      };
      side0 = match side0.checked_sub(amount_filled_i64) {
         Some(v) => v,
         None => return (false, 0i64),
      };
   }
   let new_net = max2(side0, side1);

   unsafe {
      write_i64_pair_unchecked(data.as_mut_ptr(), side0_offset, (side0, side1));
   }

   (true, signed_reserve_delta(old_net, new_net))
}

/// Signed change in portfolio worst-case reserve (`new_net - old_net`). Positive means more
/// encumbrance / MM margin required; negative means netting released reserve.
#[inline(always)]
fn signed_reserve_delta(old_net: i64, new_net: i64) -> i64 {
   match new_net.checked_sub(old_net) {
      Some(d) => d,
      None => 0i64,
   }
}


#[inline(always)]
fn max2(a: i64, b: i64) -> i64 {
   let best = if a > b { a } else { b };
   if best > 0 { best } else { 0 }
}

#[inline(always)]
fn max3(a: i64, b: i64, c: i64) -> i64 {
   let ab = if a > b { a } else { b };
   let best = if ab > c { ab } else { c };
   if best > 0 { best } else { 0 }
}

// `NettingLine` packed on-chain size (period u8 + mkt u32 + outcome_0 i64 + outcome_1 i64).
const _: () = assert!(NETTING_LINE_LEN == 21);
const _: () = assert!(NETTING_HEADER_LEN == 40);
const _: () = assert!(core::mem::size_of::<NettingPdaDataHeaderZc>() == NETTING_HEADER_LEN);
const _: () = assert!(core::mem::size_of::<NettingLineZc>() == NETTING_LINE_LEN);
