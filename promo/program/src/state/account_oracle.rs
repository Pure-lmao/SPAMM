use pinocchio::Address;
use spamm_aggregator::readers::{read_u16_le_unchecked, read_u32_le_unchecked, read_u64_le_unchecked, read_u8_unchecked};
use spamm_aggregator::state::MM_MARKET_DATA_PDA_DISCRIMINATOR;
use spamm_aggregator::writers::{write_u16_le_unchecked, write_u32_le_unchecked, write_u8_unchecked};
use zeropod::{ZeroPod, ZeroPodFixed};

pub const ORACLE_DISCRIMINATOR: u8 = MM_MARKET_DATA_PDA_DISCRIMINATOR;

/// CPI `CreateAccount` cannot allocate more than 10 KiB in one tx.
/// Header 55 + 2 tables × 150 × 32 = 9655.
pub const MAX_PROMO_BETTORS: usize = 150;
pub const MAX_PROMO_ALLOWED: usize = MAX_PROMO_BETTORS;
pub const BETTOR_PUBKEY_LEN: usize = 32;
pub const ALLOWED_BYTES: usize = MAX_PROMO_ALLOWED * BETTOR_PUBKEY_LEN;
pub const BETTORS_BYTES: usize = MAX_PROMO_BETTORS * BETTOR_PUBKEY_LEN;

/// Packed oracle header — caps, then allowlist count + filled-bettor count.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct OracleHeader {
   pub discriminator: u8,
   pub bump: u8,
   pub sequence: u32,
   pub outcome_odds0: u32,
   pub outcome_odds1: u32,
   pub outcome_odds2: u32,
   pub event_start_time: u32,
   pub parlay_factor: u32,
   pub market_outcomes: u8,
   pub max_amount: u64,
   pub max_total_amount: u64,
   pub total_stake_amount: u64,
   pub allowed_count: u16,
   pub bettor_count: u16,
}

pub const ORACLE_HEADER_SIZE: usize = <OracleHeader as ZeroPodFixed>::SIZE;
pub const ORACLE_SIZE: u64 = (ORACLE_HEADER_SIZE + ALLOWED_BYTES + BETTORS_BYTES) as u64;

/// Wire offsets for sequence and scaled odds (packed u32 LE).
pub const ORACLE_SEQUENCE_OFFSET: usize = 2;
pub const OUTCOME_ODDS0_OFFSET: usize = ORACLE_SEQUENCE_OFFSET + 4;
pub const OUTCOME_ODDS1_OFFSET: usize = OUTCOME_ODDS0_OFFSET + 4;
pub const OUTCOME_ODDS2_OFFSET: usize = OUTCOME_ODDS1_OFFSET + 4;
pub const EVENT_START_TIME_OFFSET: usize = OUTCOME_ODDS2_OFFSET + 4;
pub const PARLAY_FACTOR_OFFSET: usize = EVENT_START_TIME_OFFSET + 4;
pub const MARKET_OUTCOMES_OFFSET: usize = PARLAY_FACTOR_OFFSET + 4;
pub const MAX_AMOUNT_OFFSET: usize = MARKET_OUTCOMES_OFFSET + 1;
pub const MAX_TOTAL_AMOUNT_OFFSET: usize = MAX_AMOUNT_OFFSET + 8;
pub const TOTAL_STAKE_AMOUNT_OFFSET: usize = MAX_TOTAL_AMOUNT_OFFSET + 8;
pub const ALLOWED_COUNT_OFFSET: usize = TOTAL_STAKE_AMOUNT_OFFSET + 8;
pub const BETTOR_COUNT_OFFSET: usize = ALLOWED_COUNT_OFFSET + 2;
pub const ALLOWED_OFFSET: usize = BETTOR_COUNT_OFFSET + 2;
pub const BETTORS_OFFSET: usize = ALLOWED_OFFSET + ALLOWED_BYTES;

const _: () = assert!(ORACLE_HEADER_SIZE == ALLOWED_OFFSET);
const _: () = assert!(OUTCOME_ODDS0_OFFSET == 6);
const _: () = assert!(EVENT_START_TIME_OFFSET == 18);
const _: () = assert!(MARKET_OUTCOMES_OFFSET == 26);
const _: () = assert!(MAX_AMOUNT_OFFSET == 27);
const _: () = assert!(ALLOWED_COUNT_OFFSET == 51);
const _: () = assert!(BETTOR_COUNT_OFFSET == 53);
const _: () = assert!(ALLOWED_OFFSET == 55);
const _: () = assert!(ORACLE_SIZE as usize <= 10_240);

/// Zero promo oracle account and set static fields + allowlist. Sequence and odds start at 0.
pub unsafe fn init_account(
   ptr: *mut u8,
   bump: u8,
   event_start_time: u32,
   market_outcomes: u8,
   max_amount: u64,
   max_total_amount: u64,
   allowed: &[u8],
) {
   core::ptr::write_bytes(ptr, 0, ORACLE_SIZE as usize);
   write_u8_unchecked(ptr, 0, ORACLE_DISCRIMINATOR);
   write_u8_unchecked(ptr, 1, bump);
   write_u32_le_unchecked(ptr, EVENT_START_TIME_OFFSET, event_start_time);
   write_u8_unchecked(ptr, MARKET_OUTCOMES_OFFSET, market_outcomes);
   core::ptr::write_unaligned(ptr.add(MAX_AMOUNT_OFFSET) as *mut u64, max_amount);
   core::ptr::write_unaligned(ptr.add(MAX_TOTAL_AMOUNT_OFFSET) as *mut u64, max_total_amount);
   let n = allowed.len() / BETTOR_PUBKEY_LEN;
   write_u16_le_unchecked(ptr, ALLOWED_COUNT_OFFSET, n as u16);
   for (i, b) in allowed.iter().enumerate() {
      write_u8_unchecked(ptr, ALLOWED_OFFSET + i, *b);
   }
}

#[inline(always)]
pub unsafe fn read_discriminator(ptr: *const u8) -> u8 {
   read_u8_unchecked(ptr, 0)
}
#[inline(always)]
pub unsafe fn read_sequence(ptr: *const u8) -> u32 {
   read_u32_le_unchecked(ptr, ORACLE_SEQUENCE_OFFSET)
}
#[inline(always)]
pub unsafe fn read_event_start_time(ptr: *const u8) -> u32 {
   read_u32_le_unchecked(ptr, EVENT_START_TIME_OFFSET)
}
#[inline(always)]
pub unsafe fn read_outcome_odds0(ptr: *const u8) -> u32 {
   read_u32_le_unchecked(ptr, OUTCOME_ODDS0_OFFSET)
}
#[inline(always)]
pub unsafe fn read_outcome_odds_for_side(ptr: *const u8, side: u8) -> u32 {
   match side {
      0 => read_u32_le_unchecked(ptr, OUTCOME_ODDS0_OFFSET),
      1 => read_u32_le_unchecked(ptr, OUTCOME_ODDS1_OFFSET),
      _ => read_u32_le_unchecked(ptr, OUTCOME_ODDS2_OFFSET),
   }
}
#[inline(always)]
pub unsafe fn read_market_outcomes(ptr: *const u8) -> u8 {
   read_u8_unchecked(ptr, MARKET_OUTCOMES_OFFSET)
}
#[inline(always)]
pub unsafe fn read_max_amount(ptr: *const u8) -> u64 {
   read_u64_le_unchecked(ptr, MAX_AMOUNT_OFFSET)
}
#[inline(always)]
pub unsafe fn read_max_total_amount(ptr: *const u8) -> u64 {
   read_u64_le_unchecked(ptr, MAX_TOTAL_AMOUNT_OFFSET)
}
#[inline(always)]
pub unsafe fn read_total_stake_amount(ptr: *const u8) -> u64 {
   read_u64_le_unchecked(ptr, TOTAL_STAKE_AMOUNT_OFFSET)
}
#[inline(always)]
pub unsafe fn read_allowed_count(ptr: *const u8) -> u16 {
   read_u16_le_unchecked(ptr, ALLOWED_COUNT_OFFSET)
}
#[inline(always)]
pub unsafe fn read_bettor_count(ptr: *const u8) -> u16 {
   read_u16_le_unchecked(ptr, BETTOR_COUNT_OFFSET)
}

unsafe fn contains_pubkey(ptr: *const u8, table_offset: usize, count: usize, max: usize, user: &Address) -> bool {
   if count == 0 || count > max {
      return false;
   }
   let user_bytes = user.as_ref();
   for i in 0..count {
      let start = table_offset + i * BETTOR_PUBKEY_LEN;
      let mut matches = true;
      for j in 0..BETTOR_PUBKEY_LEN {
         if read_u8_unchecked(ptr, start + j) != user_bytes[j] {
            matches = false;
            break;
         }
      }
      if matches {
         return true;
      }
   }
   false
}

/// Empty allowlist (`allowed_count == 0`) means any user may quote/fill (still one bet per wallet).
pub unsafe fn has_allowed(ptr: *const u8, user: &Address) -> bool {
   let n = read_allowed_count(ptr) as usize;
   if n == 0 {
      return true;
   }
   contains_pubkey(ptr, ALLOWED_OFFSET, n, MAX_PROMO_ALLOWED, user)
}

pub unsafe fn has_bettor(ptr: *const u8, user: &Address) -> bool {
   contains_pubkey(
      ptr,
      BETTORS_OFFSET,
      read_bettor_count(ptr) as usize,
      MAX_PROMO_BETTORS,
      user,
   )
}

pub unsafe fn add_bettor_and_stake(ptr: *mut u8, user: &Address, stake: u64) -> Result<(), ()> {
   if !has_allowed(ptr, user) {
      return Err(());
   }
   if has_bettor(ptr, user) {
      return Err(());
   }
   let n = read_bettor_count(ptr) as usize;
   if n >= MAX_PROMO_BETTORS {
      return Err(());
   }
   let total = read_total_stake_amount(ptr);
   let max_total = read_max_total_amount(ptr);
   if max_total == 0 || total.saturating_add(stake) > max_total {
      return Err(());
   }
   let user_bytes = user.as_ref();
   let start = BETTORS_OFFSET + n * BETTOR_PUBKEY_LEN;
   for j in 0..BETTOR_PUBKEY_LEN {
      write_u8_unchecked(ptr, start + j, user_bytes[j]);
   }
   write_u16_le_unchecked(ptr, BETTOR_COUNT_OFFSET, (n + 1) as u16);
   core::ptr::write_unaligned(
      ptr.add(TOTAL_STAKE_AMOUNT_OFFSET) as *mut u64,
      total.saturating_add(stake),
   );
   Ok(())
}
