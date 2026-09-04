//! Per-MM per-event open-profit book. Peak on a line is `max(0, max open P)`. Fill adds `P`
//! to one outcome; settle subtracts it. Reserved encumbrance moves by `new_peak - old_peak`.

use core::mem::offset_of;

use pinocchio::{AccountView, error::ProgramError, hint::unlikely, Resize};
use pinocchio_system::{instructions::Transfer};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   helpers::{calc_potential_profit, get_rent, verify_system_program}, 
   readers::{read_i64_le_unchecked, read_u8_unchecked, read_u16_le_unchecked, read_u64_pair_unchecked}, state::{EventId, MarketId, Sport}, writers::{write_netting_line_unchecked, write_u8_unchecked, write_u64_le_unchecked, write_u64_pair_unchecked},
};

pub const NETTING_PDA_SEED: &[u8] = b"netting";
pub const NETTING_PDA_DISCRIMINATOR: u8 = 6;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct NettingPdaDataHeader {
   pub discriminator: u8,
   pub bump: u8,
   pub event_id: EventId,
   pub open_home: u64,
   pub open_away: u64,
   pub open_draw: u64,
   pub number_of_lines: u8,
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct NettingLine {
   pub period: u8,
   pub mkt: u16,
   pub open_0: u64,
   pub open_1: u64,
}

pub const NETTING_HEADER_LEN: usize = <NettingPdaDataHeader as ZeroPodFixed>::SIZE;
pub const NETTING_LINE_LEN: usize = <NettingLine as ZeroPodFixed>::SIZE;
pub const NETTING_PDA_MIN_LEN: usize = NETTING_HEADER_LEN;

/// Initial spare line slots allocated by `create_netting_account` (`header + 10`).
pub const NETTING_CREATE_LINE_CAPACITY: usize = 10;
/// Hard cap: `number_of_lines` is a `u8`.
pub const NETTING_MAX_LINE_CAPACITY: usize = 255;
/// Alias for create capacity (SDK / tests still use this name for alloc size).
pub const NETTING_DEFAULT_LINE_CAPACITY: usize = NETTING_CREATE_LINE_CAPACITY;
pub const NETTING_ACCOUNT_ALLOC_LEN: usize =
   NETTING_HEADER_LEN + NETTING_CREATE_LINE_CAPACITY * NETTING_LINE_LEN;

const NETTING_DISC_OFFSET: usize = offset_of!(NettingPdaDataHeaderZc, discriminator);
const NETTING_FT_OFFSET: usize = offset_of!(NettingPdaDataHeaderZc, open_home);
const NETTING_NUMBER_OF_LINES_OFFSET: usize = offset_of!(NettingPdaDataHeaderZc, number_of_lines);

const NETTING_LINE_PERIOD_OFFSET: usize = offset_of!(NettingLineZc, period);
const NETTING_LINE_MKT_OFFSET: usize = offset_of!(NettingLineZc, mkt);
const NETTING_LINE_OPEN_0_OFFSET: usize = offset_of!(NettingLineZc, open_0);

#[inline(always)]
pub fn market_is_netting_eligible(market_id: &MarketId) -> bool {
   if unlikely(market_id.player != 0) {
      return false;
   }
   let sport = market_id.event_id.sport;
   let period = market_id.period;
   let mkt = market_id.mkt;
   // 3-way HT win does not fit `open_0`/`open_1` line slots; FT 1X2 uses the header.
   if unlikely(MarketId::is_soccer_ht_1x2(sport, period, mkt)) {
      return false;
   }
   is_header_market(sport, period, mkt) || MarketId::is_netting_line_mkt(sport, mkt)
}

/// FT win market only: soccer `period` 1 / `mkt` 1 (1X2), else `period` 0 / `mkt` 0 (ML).
#[inline(always)]
fn is_header_market(sport: Sport, period: u8, mkt: u16) -> bool {
   MarketId::is_full_time_period(sport, period)
      && ((sport == Sport::Soccer && mkt == 1) || (sport != Sport::Soccer && mkt == 0))
}

#[inline(always)]
pub(crate) fn ensure_netting_lines_view(
   data: &[u8],
   number_of_lines: usize,
) -> Result<(), ProgramError> {
   if unlikely(number_of_lines > NETTING_MAX_LINE_CAPACITY) {
      return Err(ProgramError::InvalidAccountData);
   }
   let min_len = NETTING_HEADER_LEN
      .checked_add(number_of_lines.checked_mul(NETTING_LINE_LEN).ok_or(ProgramError::ArithmeticOverflow)?).ok_or(ProgramError::ArithmeticOverflow)?;
   if unlikely(data.len() < min_len) {
      return Err(ProgramError::InvalidAccountData);
   }
   Ok(())
}

#[inline(always)]
fn occupied_plus_one_len(number_of_lines: usize) -> Result<usize, ProgramError> {
   NETTING_HEADER_LEN
      .checked_add(
         number_of_lines
            .checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?
            .checked_mul(NETTING_LINE_LEN).ok_or(ProgramError::ArithmeticOverflow)?,
      ).ok_or(ProgramError::ArithmeticOverflow)
}

/// Top up rent from `payer` via System Transfer, then `resize`.
/// `payer` must be a writable system-owned signer (System Transfer, not `set_lamports`).
#[inline(never)]
fn top_up_and_resize_netting(
   netting_pda: &mut AccountView,
   payer: &AccountView,
   rent_sysvar: &AccountView,
   new_len: usize,
) -> Result<(), ProgramError> {
   if netting_pda.data_len() >= new_len {
      return Ok(());
   }
   let new_rent = get_rent(rent_sysvar, new_len as u64)?;
   let cur_lamports = netting_pda.lamports();
   if new_rent > cur_lamports {
      let need = new_rent
         .checked_sub(cur_lamports).ok_or(ProgramError::ArithmeticOverflow)?;
      Transfer {
         from: payer,
         to: netting_pda,
         lamports: need,
      }
      .invoke()?;
   }
   netting_pda.resize(new_len)?;
   Ok(())
}

/// Grow by one line slot when a fill would insert a new `(period, mkt)` past current `data_len`.
/// No-op for header markets, existing lines, placeholders, or when already at the `u8` cap.
pub fn ensure_netting_space_for_market(
   netting_pda: &mut AccountView,
   market_id: &MarketId,
   payer: &AccountView,
   rent_sysvar: &AccountView,
) -> Result<(), ProgramError> {
   if !market_is_netting_eligible(market_id) {
      return Ok(());
   }
   let sport = market_id.event_id.sport;
   if is_header_market(sport, market_id.period, market_id.mkt) {
      return Ok(());
   }
   if unlikely(!MarketId::allow_add_netting_line(sport, market_id.period, market_id.mkt)) {
      return Ok(());
   }
   let data_len = netting_pda.data_len();
   if data_len < NETTING_HEADER_LEN {
      return Ok(());
   }
   let (number_of_lines, line_exists) = {
      let data = unsafe { core::slice::from_raw_parts(netting_pda.data_ptr(), data_len) };
      if data[NETTING_DISC_OFFSET] != NETTING_PDA_DISCRIMINATOR {
         return Ok(());
      }
      let number_of_lines =
         unsafe { read_u8_unchecked(data.as_ptr(), NETTING_NUMBER_OF_LINES_OFFSET) } as usize;
      ensure_netting_lines_view(data, number_of_lines)?;
      let line_exists = find_netting_line_or_insertion(
         data,
         NETTING_HEADER_LEN,
         number_of_lines,
         market_id.period,
         market_id.mkt,
      )
      .is_ok();
      (number_of_lines, line_exists)
   };
   if line_exists {
      return Ok(());
   }
   if unlikely(number_of_lines >= NETTING_MAX_LINE_CAPACITY) {
      return Ok(());
   }
   let needed = occupied_plus_one_len(number_of_lines)?;
   top_up_and_resize_netting(netting_pda, payer, rent_sysvar, needed)
}

/// Grow by one line slot for MM `add_line` when spare bytes are exhausted.
pub fn ensure_netting_space_for_extra_line(
   netting_pda: &mut AccountView,
   payer: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
) -> Result<(), ProgramError> {
   let data_len = netting_pda.data_len();
   if data_len < NETTING_HEADER_LEN {
      return Err(ProgramError::InvalidAccountData);
   }
   let number_of_lines =
      unsafe { read_u8_unchecked(netting_pda.data_ptr(), NETTING_NUMBER_OF_LINES_OFFSET) } as usize;
   if unlikely(number_of_lines >= NETTING_MAX_LINE_CAPACITY) {
      return Ok(());
   }
   let needed = occupied_plus_one_len(number_of_lines)?;
   if data_len >= needed {
      return Ok(());
   }
   // System program is required only on grow (System Transfer for extra rent).
   verify_system_program(system_program)?;
   top_up_and_resize_netting(netting_pda, payer, rent_sysvar, needed)
}

#[inline(always)]
pub(crate) fn find_netting_line_or_insertion(
   data: &[u8],
   lines_start: usize,
   number_of_lines: usize,
   period: u8,
   mkt: u16,
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
         unsafe { read_u16_le_unchecked(data.as_ptr(), line_offset + NETTING_LINE_MKT_OFFSET) };
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

#[inline(always)]
pub(crate) fn insert_blank_netting_line_at(
   data: &mut [u8],
   lines_start: usize,
   number_of_lines: usize,
   period: u8,
   mkt: u16,
   insertion_idx: usize,
) -> Result<(), ProgramError> {
   ensure_netting_lines_view(data, number_of_lines)?;
   if unlikely(number_of_lines >= NETTING_MAX_LINE_CAPACITY) {
      return Err(ProgramError::InvalidAccountData);
   }
   let needed = occupied_plus_one_len(number_of_lines)?;
   if unlikely(data.len() < needed) {
      return Err(ProgramError::InvalidAccountData);
   }
   let new_number_of_lines = number_of_lines + 1;
   let lines_total_len = number_of_lines
      .checked_mul(NETTING_LINE_LEN).ok_or(ProgramError::ArithmeticOverflow)?;
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
            open_0: 0,
            open_1: 0,
         });
      write_u8_unchecked(
         data.as_mut_ptr(),
         NETTING_NUMBER_OF_LINES_OFFSET,
         new_number_of_lines as u8,
      );
   }
   Ok(())
}

#[inline(always)]
pub fn add_netting_line(
   data: &mut [u8],
   sport: Sport,
   period: u8,
   mkt: u16,
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

#[inline(always)]
fn line_open_pair(data: &[u8], line_offset: usize) -> (u64, u64) {
   let off = line_offset + NETTING_LINE_OPEN_0_OFFSET;
   unsafe { read_u64_pair_unchecked(data.as_ptr(), off) }
}

pub fn remove_netting_line(data: &mut [u8], period: u8, mkt: u16) -> Result<(), ProgramError> {
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
   let line_offset = lines_start + (idx * NETTING_LINE_LEN);
   let (open_0, open_1) = line_open_pair(data, line_offset);
   if unlikely(open_0 != 0 || open_1 != 0) {
      return Err(ProgramError::InvalidAccountData);
   }
   let old_n = number_of_lines;
   let new_n = old_n - 1;
   let remove_off = line_offset;
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
   unsafe {
      write_u8_unchecked(data.as_mut_ptr(), NETTING_NUMBER_OF_LINES_OFFSET, new_n as u8);
   }
   Ok(())
}

/// True if header or any line still has open profit.
pub fn netting_has_open_profit(data: &[u8]) -> Result<bool, ProgramError> {
   if unlikely(data.len() < NETTING_HEADER_LEN || data[NETTING_DISC_OFFSET] != NETTING_PDA_DISCRIMINATOR) {
      return Err(ProgramError::InvalidAccountData);
   }
   for i in 0..3 {
      let off = NETTING_FT_OFFSET + (i * 8);
      let v = unsafe { read_i64_le_unchecked(data.as_ptr(), off) };
      if v != 0 {
         return Ok(true);
      }
   }
   let number_of_lines =
      unsafe { read_u8_unchecked(data.as_ptr(), NETTING_NUMBER_OF_LINES_OFFSET) } as usize;
   ensure_netting_lines_view(data, number_of_lines)?;
   let lines_start = NETTING_HEADER_LEN;
   for i in 0..number_of_lines {
      let (o0, o1) = line_open_pair(data, lines_start + i * NETTING_LINE_LEN);
      if o0 != 0 || o1 != 0 {
         return Ok(true);
      }
   }
   Ok(false)
}

#[derive(Clone, Copy)]
pub enum NettingWrite {
   Header { open: [u64; 3] },
   ExistingLine { line_idx: usize, open_0: u64, open_1: u64 },
   NewLine {
      insertion_idx: usize,
      period: u8,
      mkt: u16,
      open_0: u64,
      open_1: u64,
   },
}

#[derive(Clone, Copy)]
pub struct NettingCalc {
   pub delta: i64,
   pub write: NettingWrite,
}

#[inline(always)]
fn read_header_open(data: &[u8]) -> [u64; 3] {
   // SAFETY: caller guarantees `NETTING_FT_OFFSET..+24` is in-bounds.
   unsafe {
      core::ptr::read_unaligned(
         data.as_ptr().add(NETTING_FT_OFFSET) as *const [u64; 3],
      )
   }
}

pub fn calculate_netting(
   netting_pda: &AccountView,
   market_id: &MarketId,
   side: u8,
   amount_filled: u64,
   odds_scaled: u32,
) -> Option<NettingCalc> {
   if !market_is_netting_eligible(market_id) {
      return None;
   }
   let sport = market_id.event_id.sport;
   let period = market_id.period;
   let mkt = market_id.mkt;

   let data = unsafe {
      core::slice::from_raw_parts(netting_pda.data_ptr(), netting_pda.data_len())
   };
   if data.len() < NETTING_HEADER_LEN || data[NETTING_DISC_OFFSET] != NETTING_PDA_DISCRIMINATOR {
      return None;
   }

   let profit_on_win = calc_potential_profit(amount_filled, odds_scaled).ok()?;

   if is_header_market(sport, period, mkt) {
      let outcome_index = side as usize;
      if sport == Sport::Soccer {
         if outcome_index > 2 {
            return None;
         }
      } else if outcome_index > 1 {
         return None;
      }
      let mut open = read_header_open(data);
      let old_peak = max3(open[0], open[1], open[2]);
      open[outcome_index] = open[outcome_index].checked_add(profit_on_win)?;
      let new_peak = max3(open[0], open[1], open[2]);
      let new_peak_i64: i64 = match new_peak.try_into() {
         Ok(v) => v,
         Err(_) => return None,
      };
      let old_peak_i64: i64 = match old_peak.try_into() {
         Ok(v) => v,
         Err(_) => return None,
      };
      let delta = new_peak_i64.checked_sub(old_peak_i64)?;
      return Some(NettingCalc { delta, write: NettingWrite::Header { open } });
   }

   let number_of_lines =
      unsafe { read_u8_unchecked(data.as_ptr(), NETTING_NUMBER_OF_LINES_OFFSET) } as usize;
   ensure_netting_lines_view(data, number_of_lines).ok()?;
   let lines_start = NETTING_HEADER_LEN;

   match find_netting_line_or_insertion(data, lines_start, number_of_lines, period, mkt) {
      Ok(line_idx) => {
         let line_offset = lines_start + (line_idx * NETTING_LINE_LEN);
         let (mut open_0, mut open_1) = line_open_pair(data, line_offset);
         let old_peak = max2(open_0, open_1);
         if side == 0 {
            open_0 = open_0.checked_add(profit_on_win)?;
         } else if side == 1 {
            open_1 = open_1.checked_add(profit_on_win)?;
         } else {
            return None;
         }
         let new_peak = max2(open_0, open_1);
         let new_peak_i64: i64 = match new_peak.try_into() {
            Ok(v) => v,
            Err(_) => return None,
         };
         let old_peak_i64: i64 = match old_peak.try_into() {
            Ok(v) => v,
            Err(_) => return None,
         };
         let delta = new_peak_i64.checked_sub(old_peak_i64)?;
         Some(NettingCalc {
            delta,
            write: NettingWrite::ExistingLine { line_idx, open_0, open_1 },
         })
      }
      Err(insertion_idx) => {
         if unlikely(!MarketId::allow_add_netting_line(sport, period, mkt)) {
            return None;
         }
         if unlikely(number_of_lines >= NETTING_MAX_LINE_CAPACITY) {
            return None;
         }
         let (mut open_0, mut open_1) = (0u64, 0u64);
         if side == 0 {
            open_0 = profit_on_win;
         } else if side == 1 {
            open_1 = profit_on_win;
         } else {
            return None;
         }
         let delta = max2(open_0, open_1);
         let delta_i64: i64 = match delta.try_into() {
            Ok(v) => v,
            Err(_) => return None,
         };
         Some(NettingCalc {
            delta: delta_i64,
            write: NettingWrite::NewLine {
               insertion_idx,
               period,
               mkt,
               open_0,
               open_1,
            },
         })
      }
   }
}

pub fn apply_netting(
   netting_pda: &AccountView,
   write: &NettingWrite,
) -> Result<(), ProgramError> {
   let data = unsafe {
      core::slice::from_raw_parts_mut(
         netting_pda.data_ptr() as *mut u8,
         netting_pda.data_len(),
      )
   };
   if unlikely(
      data.len() < NETTING_HEADER_LEN
         || data[NETTING_DISC_OFFSET] != NETTING_PDA_DISCRIMINATOR,
   ) {
      return Err(ProgramError::InvalidAccountData);
   }

   match *write {
      NettingWrite::Header { open } => {
         for (i, value) in open.iter().enumerate() {
            let off = NETTING_FT_OFFSET + (i * 8);
            unsafe { write_u64_le_unchecked(data.as_mut_ptr(), off, *value) };
         }
      }
      NettingWrite::ExistingLine { line_idx, open_0, open_1 } => {
         let number_of_lines =
            unsafe { read_u8_unchecked(data.as_ptr(), NETTING_NUMBER_OF_LINES_OFFSET) } as usize;
         ensure_netting_lines_view(data, number_of_lines)?;
         if unlikely(line_idx >= number_of_lines) {
            return Err(ProgramError::InvalidAccountData);
         }
         let line_offset = NETTING_HEADER_LEN + (line_idx * NETTING_LINE_LEN);
         let off = line_offset + NETTING_LINE_OPEN_0_OFFSET;
         unsafe {
            write_u64_pair_unchecked(data.as_mut_ptr(), off, (open_0, open_1));
         }
      }
      NettingWrite::NewLine { insertion_idx, period, mkt, open_0, open_1 } => {
         let number_of_lines =
            unsafe { read_u8_unchecked(data.as_ptr(), NETTING_NUMBER_OF_LINES_OFFSET) } as usize;
         let lines_start = NETTING_HEADER_LEN;
         insert_blank_netting_line_at(
            data, lines_start, number_of_lines, period, mkt, insertion_idx,
         )?;
         let line_offset = lines_start + (insertion_idx * NETTING_LINE_LEN);
         let off = line_offset + NETTING_LINE_OPEN_0_OFFSET;
         unsafe {
            write_u64_pair_unchecked(data.as_mut_ptr(), off, (open_0, open_1));
         }
      }
   }

   Ok(())
}

/// Subtract `profit_to_remove` from this market's outcome. Returns `new_peak - old_peak` (≤ 0).
pub fn apply_settle_netting(
   netting_pda: &mut AccountView,
   market_id: &MarketId,
   side: u8,
   profit_to_remove: u64,
) -> Result<i64, ProgramError> {
   if profit_to_remove == 0 {
      return Ok(0);
   }
   if !market_is_netting_eligible(market_id) {
      return Err(ProgramError::InvalidInstructionData);
   }
   let data = unsafe {
      core::slice::from_raw_parts_mut(
         netting_pda.data_ptr() as *mut u8,
         netting_pda.data_len(),
      )
   };
   if unlikely(
      data.len() < NETTING_HEADER_LEN
         || data[NETTING_DISC_OFFSET] != NETTING_PDA_DISCRIMINATOR,
   ) {
      return Err(ProgramError::InvalidAccountData);
   }

   let sport = market_id.event_id.sport;
   let period = market_id.period;
   let mkt = market_id.mkt;
   let outcome_index = side as usize;

   if is_header_market(sport, period, mkt) {
      if sport == Sport::Soccer {
         if unlikely(outcome_index > 2) {
            return Err(ProgramError::InvalidInstructionData);
         }
      } else if unlikely(outcome_index > 1) {
         return Err(ProgramError::InvalidInstructionData);
      }
      let mut open = read_header_open(data);
      let old_peak = max3(open[0], open[1], open[2]);
      open[outcome_index] = open[outcome_index]
         .checked_sub(profit_to_remove).ok_or(ProgramError::ArithmeticOverflow)?;
      let new_peak = max3(open[0], open[1], open[2]);
      let new_peak_i64: i64 = match new_peak.try_into() {
         Ok(v) => v,
         Err(_) => return Err(ProgramError::ArithmeticOverflow),
      };
      let old_peak_i64: i64 = match old_peak.try_into() {
         Ok(v) => v,
         Err(_) => return Err(ProgramError::ArithmeticOverflow),
      };
      let delta = new_peak_i64.checked_sub(old_peak_i64).ok_or(ProgramError::ArithmeticOverflow)?;
      for (i, value) in open.iter().enumerate() {
         let off = NETTING_FT_OFFSET + (i * 8);
         unsafe { write_u64_le_unchecked(data.as_mut_ptr(), off, *value) };
      }
      return Ok(delta);
   }

   let number_of_lines =
      unsafe { read_u8_unchecked(data.as_ptr(), NETTING_NUMBER_OF_LINES_OFFSET) } as usize;
   ensure_netting_lines_view(data, number_of_lines)?;
   let lines_start = NETTING_HEADER_LEN;
   let line_idx = match find_netting_line_or_insertion(data, lines_start, number_of_lines, period, mkt) {
      Ok(i) => i,
      Err(_) => return Err(ProgramError::InvalidAccountData),
   };
   let line_offset = lines_start + (line_idx * NETTING_LINE_LEN);
   let (mut open_0, mut open_1) = line_open_pair(data, line_offset);
   let old_peak = max2(open_0, open_1);
   if side == 0 {
      open_0 = open_0.checked_sub(profit_to_remove).ok_or(ProgramError::ArithmeticOverflow)?;
   } else if side == 1 {
      open_1 = open_1.checked_sub(profit_to_remove).ok_or(ProgramError::ArithmeticOverflow)?;
   } else {
      return Err(ProgramError::InvalidInstructionData);
   }
   let new_peak = max2(open_0, open_1);
   let new_peak_i64: i64 = match new_peak.try_into() {
      Ok(v) => v,
      Err(_) => return Err(ProgramError::ArithmeticOverflow),
   };
   let old_peak_i64: i64 = match old_peak.try_into() {
      Ok(v) => v,
      Err(_) => return Err(ProgramError::ArithmeticOverflow),
   };
   let delta = new_peak_i64.checked_sub(old_peak_i64).ok_or(ProgramError::ArithmeticOverflow)?;
   let off = line_offset + NETTING_LINE_OPEN_0_OFFSET;
   unsafe {
      write_u64_pair_unchecked(data.as_mut_ptr(), off, (open_0, open_1));
   }
   Ok(delta)
}

#[inline(always)]
fn max2(a: u64, b: u64) -> u64 {
   let best = if a > b { a } else { b };
   if best > 0 { best } else { 0 }
}

#[inline(always)]
fn max3(a: u64, b: u64, c: u64) -> u64 {
   let ab = if a > b { a } else { b };
   let best = if ab > c { ab } else { c };
   if best > 0 { best } else { 0 }
}
