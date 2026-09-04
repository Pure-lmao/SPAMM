//! Soft-fail quote auction for cashout of an open parlay ticket (simulate only).
//!
//! Accounts: **3 + (3 + 2 × L) × N**
//!
//! **Fixed (3)**
//! 0. `user` (readonly)
//! 1. `clock_sysvar` (readonly)
//! 2. `original_parlay_pda` (readonly)
//!
//! **Per MM:** program, config, parlay quote buffer, then market (readonly)+event per leg.
//!
//! Data: [`FillParlayCashoutIxData`] (`cashout_id` unused).

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, error::ProgramError,
   hint::unlikely, instruction::{InstructionAccount, InstructionView},
};
use pinocchio_log::log;

use crate::{
   ID,
   constants::{MAX_NUMBER_OF_MMS_PROXY, MAX_PARLAY_LEGS, MAX_PARLAY_QUOTE_CPI_ACCOUNTS},
   errors::SpammError,
   helpers::{
      set_proxy_cashout_return_data, verify_clock_sysvar, verify_event_state, verify_mm_config_pda,
      verify_mm_market_data_pda, verify_mm_program_executable, verify_parlay_quote_buffer,
      cashout_helpers::{
         accept_cashout_payment, parse_cashout_quote_return_for_mm, proportional_payout,
         require_cashout_sequence_at_least, validate_cashout_size,
      },
      fill_helpers::invoke_parlay_quote_cpi,
      freebet_helpers::require_not_freebet,
      reject_duplicate_mm_programs, verify_parlay_pda,
   },
   state::{
      account_bet::BetResult,
      account_parlay_bet::ParlayBetAccountData,
      empty_parlay_leg_sel_buf, get_cashout_quote_parlay_ix_wire_len, write_get_cashout_quote_parlay_ix,
      FillParlayCashoutIxData, ParlayLegSel, ProxyCashoutQuoteData, GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN,
      PARLAY_LEG_SEL_LEN,
   },
};

const MM_FIXED: usize = 3;
const CASHOUT_PARLAY_IX_BUF: usize =
   GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN + MAX_PARLAY_LEGS * PARLAY_LEG_SEL_LEN;

pub const GET_PARLAY_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR: u8 = 34;

#[inline(never)]
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [user, clock_sysvar, original_parlay_pda, mm_accounts @ ..] = accounts else {
      log!("get_parlay_cashout_quote_proxy: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_clock_sysvar(clock_sysvar)?;
   let parsed = FillParlayCashoutIxData::decode(data)?;
   let num_legs = parsed.num_legs as usize;
   let per_mm = MM_FIXED + 2 * num_legs;
   if mm_accounts.len() < per_mm || mm_accounts.len() % per_mm != 0 {
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   let number_of_mms = mm_accounts.len() / per_mm;
   if number_of_mms > MAX_NUMBER_OF_MMS_PROXY {
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   reject_duplicate_mm_programs(mm_accounts, per_mm)?;

   if unlikely(!address_eq(original_parlay_pda.owner(), &ID)) {
      return Err(ProgramError::InvalidAccountData);
   }

   let mut sels = empty_parlay_leg_sel_buf::<MAX_PARLAY_LEGS>();
   let payout_removed = decode_parlay_cashout_ticket(
      user,
      original_parlay_pda,
      &parsed,
      num_legs,
      &mut sels,
   )?;

   let wire_len = get_cashout_quote_parlay_ix_wire_len(num_legs);
   if wire_len > CASHOUT_PARLAY_IX_BUF {
      return Err(ProgramError::InvalidInstructionData);
   }
   let mut qbuf = [0u8; CASHOUT_PARLAY_IX_BUF];
   write_get_cashout_quote_parlay_ix(
      &mut qbuf[..wire_len],
      parsed.amount,
      payout_removed,
      parsed.min_payout,
      num_legs,
      &sels[..num_legs],
   )?;

   collect_parlay_cashout_proxy_quotes(
      user,
      clock_sysvar,
      mm_accounts,
      per_mm,
      number_of_mms,
      num_legs,
      &parsed,
      &sels[..num_legs],
      payout_removed,
      &qbuf[..wire_len],
   )
}

/// One decode of header + legs into `sels`. Returns `payout_removed`.
#[inline(never)]
fn decode_parlay_cashout_ticket(
   user: &AccountView,
   original_parlay_pda: &AccountView,
   parsed: &FillParlayCashoutIxData,
   num_legs: usize,
   sels: &mut [ParlayLegSel],
) -> Result<u64, ProgramError> {
   let raw = original_parlay_pda.try_borrow()?;
   let header = ParlayBetAccountData::decode_header(raw.as_ref())?;
   require_not_freebet(header.freebet_id)?;
   if header.bet_id != parsed.orig_bet_id
      || header.result != BetResult::Pending
      || header.num_legs != parsed.num_legs
   {
      return Err(SpammError::InvalidCashout.into());
   }
   verify_parlay_pda(
      original_parlay_pda,
      user.address(),
      header.bet_id,
      header.bump,
   )?;
   if unlikely(sels.len() < num_legs) {
      return Err(ProgramError::InvalidInstructionData);
   }
   for i in 0..num_legs {
      let leg = ParlayBetAccountData::decode_leg(raw.as_ref(), i)?;
      if leg.result != BetResult::Pending {
         return Err(SpammError::InvalidCashout.into());
      }
      require_cashout_sequence_at_least(parsed.snapshots[i].event_state_sequence, leg.event_state_sequence)?;
      sels[i] = ParlayLegSel {
         market_id: leg.market_id,
         side: leg.side,
         event_state_sequence: parsed.snapshots[i].event_state_sequence,
         event_game_state: parsed.snapshots[i].event_game_state,
      };
   }
   validate_cashout_size(header.amount, parsed.amount)?;
   proportional_payout(header.amount, header.payout, parsed.amount)
}

/// Owns the quotes array only (no ticket re-decode in this frame).
#[inline(never)]
fn collect_parlay_cashout_proxy_quotes(
   user: &AccountView,
   clock_sysvar: &AccountView,
   mm_accounts: &[AccountView],
   per_mm: usize,
   number_of_mms: usize,
   num_legs: usize,
   parsed: &FillParlayCashoutIxData,
   sels: &[ParlayLegSel],
   payout_removed: u64,
   qbuf: &[u8],
) -> ProgramResult {
   let mut quotes =
      [const { MaybeUninit::<ProxyCashoutQuoteData>::uninit() }; MAX_NUMBER_OF_MMS_PROXY];
   let mut valid = 0usize;

   for i in 0..number_of_mms {
      let base = i * per_mm;
      let mm_program = &mm_accounts[base];
      let mm_config = &mm_accounts[base + 1];
      let mm_buf = &mm_accounts[base + 2];
      let leg_accounts = &mm_accounts[base + MM_FIXED..base + per_mm];

      if verify_mm_program_executable(mm_program).is_err() {
         continue;
      }

      if !verify_mm_config_pda(mm_config, mm_program) {
         continue;
      }
      if !verify_parlay_quote_buffer(mm_buf, mm_program) {
         continue;
      }
      if !legs_ok_for_proxy(sels, parsed, num_legs, mm_program, leg_accounts) {
         continue;
      }

      if !cpi_get_cashout_quote_parlay_proxy(
         num_legs,
         qbuf,
         user,
         clock_sysvar,
         mm_program,
         mm_config,
         mm_buf,
         leg_accounts,
      ) {
         continue;
      }
      let Some(max_payment) = parse_cashout_quote_return_for_mm(mm_program) else {
         continue;
      };
      if !accept_cashout_payment(max_payment, parsed.min_payout, payout_removed) {
         continue;
      }
      quotes[valid].write(ProxyCashoutQuoteData {
         mm_address: *mm_program.address(),
         max_payment,
      });
      valid += 1;
   }

   if valid == 0 {
      return Err(SpammError::NoQuotesAvailable.into());
   }
   set_proxy_cashout_return_data(&quotes, valid);
   Ok(())
}

#[inline(never)]
fn legs_ok_for_proxy(
   sels: &[ParlayLegSel],
   parsed: &FillParlayCashoutIxData,
   num_legs: usize,
   mm_program: &AccountView,
   leg_accounts: &[AccountView],
) -> bool {
   if sels.len() < num_legs || leg_accounts.len() < 2 * num_legs {
      return false;
   }
   for li in 0..num_legs {
      let mid = &sels[li].market_id;
      if !verify_mm_market_data_pda(&leg_accounts[2 * li], mm_program, &mid.as_bytes())
         || !verify_event_state(
            &leg_accounts[2 * li + 1],
            mm_program,
            &mid.event_id.as_wire_bytes(),
            &parsed.snapshots[li].event_game_state,
            parsed.snapshots[li].event_state_sequence,
         )
      {
         return false;
      }
   }
   true
}

#[inline(never)]
fn cpi_get_cashout_quote_parlay_proxy(
   num_legs: usize,
   data: &[u8],
   user: &AccountView,
   clock_sysvar: &AccountView,
   mm_program: &AccountView,
   mm_config: &AccountView,
   mm_buf: &AccountView,
   leg_accounts: &[AccountView],
) -> bool {
   let nmeta = 4 + 2 * num_legs;
   if nmeta > MAX_PARLAY_QUOTE_CPI_ACCOUNTS || leg_accounts.len() < 2 * num_legs {
      return false;
   }
   let mut metas = [const { MaybeUninit::<InstructionAccount>::uninit() }; MAX_PARLAY_QUOTE_CPI_ACCOUNTS];
   metas[0].write(InstructionAccount::new(user.address(), false, false));
   metas[1].write(InstructionAccount::new(clock_sysvar.address(), false, false));
   metas[2].write(InstructionAccount::new(mm_config.address(), false, false));
   metas[3].write(InstructionAccount::new(mm_buf.address(), true, false));
   for i in 0..num_legs {
      metas[4 + 2 * i].write(InstructionAccount::new(leg_accounts[2 * i].address(), false, false));
      metas[5 + 2 * i].write(InstructionAccount::new(
         leg_accounts[2 * i + 1].address(),
         false,
         false,
      ));
   }
   let metas_init = unsafe {
      core::slice::from_raw_parts(metas.as_ptr().cast::<InstructionAccount>(), nmeta)
   };
   let ix = InstructionView {
      program_id: mm_program.address(),
      accounts: metas_init,
      data,
   };
   invoke_parlay_quote_cpi(num_legs, &ix, user, clock_sysvar, mm_config, mm_buf, leg_accounts)
}
