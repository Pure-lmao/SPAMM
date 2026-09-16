//! Promo MM quote: fixed odds, per-bet `max_amount`, pool `max_total_amount`, one bet per user.
//! Parlays are not offered — see `get_quote_parlay`.

use pinocchio::{AccountView, Address, ProgramResult, address::address_eq, error::ProgramError, hint::unlikely};
use pinocchio::sysvars::clock::Clock;
use pinocchio_log::log;
use spamm_aggregator::constants::ODDS_SCALE;
use crate::mm_helpers::{spamm_ix_wire, verify_event_state, verify_market_data_pda};
use crate::state::account_config::Config;
use crate::state::account_oracle::{
   ORACLE_SIZE, read_event_start_time, read_market_outcomes, read_max_amount, read_max_total_amount,
   read_outcome_odds_for_side, read_total_stake_amount, has_allowed, has_bettor,
};

use crate::constants::find_config_pda;
use crate::constants::find_quote_buffer_pda;
use crate::constants::{PROMO_MKT, PROMO_SIDE};
use crate::state::GetQuoteReturnWire;
use zeropod::ZeroPodFixed;
use spamm_aggregator::state::mm_quote::MM_QUOTE_BUFFER_DISCRIMINATOR;
use spamm_aggregator::state::{GetQuoteIxData, MM_QUOTE_BUFFER_LEN, MMQuoteBuffer};
pub use spamm_aggregator::state::GET_QUOTE_IX_DISCRIMINATOR;

#[inline(never)]
pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      user,
      clock_program,
      mm_market_data_pda,
      event_state_pda,
      mm_config_pda,
      mm_quote_buffer,
   ] = accounts else {
      log!("get_quote: mm accounts mismatch");
      return zero_quote_return();
   };
   let wire = match spamm_ix_wire::<{ GetQuoteIxData::WIRE_LEN }>(GET_QUOTE_IX_DISCRIMINATOR, data)
   {
      Ok(w) => w,
      Err(_) => {
         log!("get_quote: ix wire decode failed");
         return zero_quote_return();
      }
   };
   let parsed_data = match GetQuoteIxData::decode(&wire) {
      Ok(d) => d,
      Err(_) => {
         log!("get_quote: decode failed");
         return zero_quote_return();
      }
   };
   let side = parsed_data.side;
   let amount = parsed_data.amount;
   let min_odds_scaled = parsed_data.odds_scaled;
   let market_id = parsed_data.market_id;

   if unlikely(market_id.mkt != PROMO_MKT) {
      log!("get_quote: promo markets require mkt 9");
      return zero_quote_return();
   }
   if unlikely(side != PROMO_SIDE) {
      log!("get_quote: promo markets only accept side 0");
      return zero_quote_return();
   }

   let event_state_sequence = parsed_data.event_state_sequence;
   if unlikely(event_state_sequence == 0) {
      log!("get_quote: event_state_sequence must be > 0");
      return zero_quote_return();
   }

   let event_game_state = parsed_data.event_game_state;

   let (expected_quote_buffer, _) = find_quote_buffer_pda(program_id);
   if unlikely(!address_eq(mm_quote_buffer.address(), &expected_quote_buffer)) {
      log!("get_quote: quote buffer invalid");
      return zero_quote_return();
   }

   let (expected_config, _) = find_config_pda(program_id);
   if unlikely(!address_eq(mm_config_pda.address(), &expected_config)) {
      log!("get_quote: mm config pda invalid");
      return zero_quote_return();
   }

   if unlikely(!verify_event_state(
      event_state_pda,
      program_id,
      &market_id.event_id,
      &event_game_state,
      event_state_sequence,
   )) {
      log!("get_quote: event state invalid");
      return zero_quote_return();
   }

   if unlikely(
      verify_market_data_pda(mm_market_data_pda, program_id, &market_id).is_err()
   ) {
      log!("get_quote: market data pda invalid");
      return zero_quote_return();
   }

   if unlikely(mm_market_data_pda.data_len() != ORACLE_SIZE as usize) {
      log!("get_quote: market data wrong length");
      return zero_quote_return();
   }

   let oracle_ptr = mm_market_data_pda.data_ptr();
   unsafe {
      if !has_allowed(oracle_ptr, user.address()) {
         log!("get_quote: user not on allowlist");
         return zero_quote_return();
      }
      if has_bettor(oracle_ptr, user.address()) {
         log!("get_quote: user already bet on this promo market");
         return zero_quote_return();
      }
   }

   let config_data = match mm_config_pda.try_borrow() {
      Ok(d) => d,
      Err(_) => {
         log!("get_quote: config borrow failed");
         return zero_quote_return();
      }
   };
   let config = match Config::from_account_data(&config_data) {
      Ok(c) => c,
      Err(()) => {
         log!("get_quote: config decode failed");
         return zero_quote_return();
      }
   };

   if config.status != true {
      log!("get_quote: config status is not active");
      return zero_quote_return();
   }

   let clock = match Clock::from_account_view(clock_program) {
      Ok(c) => c,
      Err(_) => {
         log!("get_quote: clock sysvar failed");
         return zero_quote_return();
      }
   };
   let current_time = match u32::try_from(clock.unix_timestamp) {
      Ok(t) => t,
      Err(_) => {
         log!("get_quote: clock timestamp invalid");
         return zero_quote_return();
      }
   };

   let (market_outcome_count, outcome_odds, max_cap, max_total, total_stake, event_start_time) =
      unsafe {
         (
            read_market_outcomes(oracle_ptr),
            read_outcome_odds_for_side(oracle_ptr, side),
            read_max_amount(oracle_ptr),
            read_max_total_amount(oracle_ptr),
            read_total_stake_amount(oracle_ptr),
            read_event_start_time(oracle_ptr),
         )
      };

   if unlikely(current_time >= event_start_time) {
      log!("get_quote: event already started");
      return zero_quote_return();
   }

   if unlikely(market_outcome_count != 2 && market_outcome_count != 3) {
      log!("get_quote: market_outcomes must be 2 or 3");
      return zero_quote_return();
   }

   if outcome_odds < ODDS_SCALE as u32 {
      log!("get_quote: outcome odds is less than ODDS_SCALE");
      return zero_quote_return();
   }
   if outcome_odds < min_odds_scaled {
      log!("get_quote: outcome odds is less than min odds scaled");
      return zero_quote_return();
   }

   if max_cap == 0 {
      log!("get_quote: max_amount is zero");
      return zero_quote_return();
   }
   if max_total == 0 {
      log!("get_quote: max_total_amount is zero");
      return zero_quote_return();
   }

   if total_stake >= max_total {
      log!("get_quote: max_total_amount exhausted");
      return zero_quote_return();
   }
   let remaining_total = max_total
      .checked_sub(total_stake)
      .ok_or(ProgramError::ArithmeticOverflow)?;

   let quote_max_amount = amount.min(max_cap).min(remaining_total);
   let odds_scaled = outcome_odds;

   if quote_max_amount > 0 && odds_scaled < min_odds_scaled {
      return zero_quote_return();
   }

   set_get_quote_return_data(quote_max_amount, odds_scaled)?;

   let quote = MMQuoteBuffer {
      discriminator: MM_QUOTE_BUFFER_DISCRIMINATOR,
      is_used: 0,
      user_address: *user.address(),
      market_id,
      side,
      max_amount: quote_max_amount,
      odds_scaled,
      event_game_state,
      event_state_sequence,
   };

   let buf = mm_quote_buffer.try_borrow_mut();
   if unlikely(buf.is_err()) {
      log!("get_quote: quote buffer borrow failed");
      return zero_quote_return();
   }
   let mut buf = buf.unwrap();
   if unlikely(buf.len() != MM_QUOTE_BUFFER_LEN) {
      log!("get_quote: quote buffer len mismatch");
      return zero_quote_return();
   }
   if unlikely(quote.write_wire(&mut buf).is_err()) {
      log!("get_quote: quote write failed");
      return zero_quote_return();
   }

   Ok(())
}

#[inline(always)]
fn zero_quote_return() -> ProgramResult {
   set_get_quote_return_data(0, 0)?;
   Ok(())
}

#[inline(always)]
fn set_get_quote_return_data(max_amount: u64, odds_scaled: u32) -> ProgramResult {
   let ret = GetQuoteReturnWire {
      max_amount,
      odds_scaled,
   };
   let zc = ret.to_zc();
   let mut out = [0u8; <GetQuoteReturnWire as ZeroPodFixed>::SIZE];
   unsafe {
      core::ptr::write(out.as_mut_ptr().cast(), zc);
   }
   #[cfg(any(target_os = "solana", target_arch = "bpf"))]
   unsafe {
      pinocchio::syscalls::sol_set_return_data(out.as_ptr(), out.len() as u64);
   }
   #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
   {
      let _ = out;
   }
   Ok(())
}
