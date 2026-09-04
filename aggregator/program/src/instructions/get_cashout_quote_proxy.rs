//! Soft-fail quote auction for cashout of a single open ticket (simulate only).
//!
//! Accounts: **3 + 5 × N** (`N` ≤ MAX_NUMBER_OF_MMS_PROXY).
//!
//! **Fixed (3)**
//! 0. `user` (readonly)
//! 1. `clock_sysvar` (readonly)
//! 2. `original_bet_pda` (readonly)
//!
//! **Per MM (5)** — same as `get_quote_proxy`
//! 0. `mm_program` 1. `mm_config_pda` 2. `mm_event_state_pda`
//! 3. `mm_market_data_pda` (readonly) 4. `mm_quote_buffer` (writable)
//!
//! Data: [`FillCashoutIxData`] (`cashout_id` unused).

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::invoke, error::ProgramError,
   hint::unlikely, instruction::{InstructionAccount, InstructionView},
};
use pinocchio_log::log;

use crate::{
   ID,
   constants::{MAX_NUMBER_OF_MMS, MAX_NUMBER_OF_MMS_PROXY},
   errors::SpammError,
   helpers::{
      set_proxy_cashout_return_data, verify_clock_sysvar, verify_event_state, verify_mm_config_pda,
      verify_mm_market_data_pda, verify_mm_program_executable, verify_quote_buffer,
      cashout_helpers::{
         accept_cashout_payment, parse_cashout_quote_return_for_mm, require_cashout_sequence_at_least,
         split_fillers, validate_cashout_size,
      },
      freebet_helpers::require_not_freebet,
      reject_duplicate_mm_programs, verify_bet_pda,
   },
   state::{
      account_bet::{BetFiller, BetResult},
      FillCashoutIxData,
      GetCashoutQuoteIxData, ProxyCashoutQuoteData, GET_CASHOUT_QUOTE_IX_DISCRIMINATOR,
      BetAccountData,
   },
};

const MM_ACCOUNTS_PER_MM: usize = 5;

pub const GET_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR: u8 = 33;

#[inline(never)]
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [user, clock_sysvar, original_bet_pda, mm_accounts @ ..] = accounts else {
      log!("get_cashout_quote_proxy: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_clock_sysvar(clock_sysvar)?;
   if mm_accounts.len() < MM_ACCOUNTS_PER_MM || mm_accounts.len() % MM_ACCOUNTS_PER_MM != 0 {
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   let number_of_mms = mm_accounts.len() / MM_ACCOUNTS_PER_MM;
   if number_of_mms > MAX_NUMBER_OF_MMS_PROXY {
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   reject_duplicate_mm_programs(mm_accounts, MM_ACCOUNTS_PER_MM)?;

   let parsed = FillCashoutIxData::decode(data)?;
   if unlikely(!address_eq(original_bet_pda.owner(), &ID)) {
      return Err(ProgramError::InvalidAccountData);
   }
   let mut orig_fillers_buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let orig = {
      let raw = original_bet_pda.try_borrow()?;
      let h = BetAccountData::decode_header(raw.as_ref())?;
      let n = h.num_fillers as usize;
      BetAccountData::decode_fillers_into(raw.as_ref(), n, &mut orig_fillers_buf)?;
      h
   };
   require_not_freebet(orig.freebet_id)?;
   if orig.bet_id != parsed.orig_bet_id || orig.result != BetResult::Pending {
      return Err(SpammError::InvalidCashout.into());
   }
   verify_bet_pda(
      original_bet_pda,
      user.address(),
      orig.bet_id,
      orig.bump,
   )?;
   validate_cashout_size(orig.amount, parsed.amount)?;
   require_cashout_sequence_at_least(parsed.event_state_sequence, orig.event_state_sequence)?;
   let num = orig.num_fillers as usize;
   let orig_fillers = unsafe {
      core::slice::from_raw_parts(orig_fillers_buf.as_ptr().cast::<BetFiller>(), num)
   };
   let mut remaining_buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let mut cashed_buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   // Same payout_removed as fill_cashout (`split_fillers`), not header proportional.
   let payout_removed = split_fillers(
      orig_fillers,
      num,
      orig.amount,
      parsed.amount,
      &mut remaining_buf,
      &mut cashed_buf,
   )?;
   let market_wire = orig.market_id.as_bytes();
   let event_id_wire = orig.market_id.event_id.as_wire_bytes();

   let get_ix = GetCashoutQuoteIxData {
      instruction_discriminator: GET_CASHOUT_QUOTE_IX_DISCRIMINATOR,
      amount: parsed.amount,
      payout: payout_removed,
      min_payout: parsed.min_payout,
      market_id: orig.market_id,
      side: orig.side,
      event_game_state: parsed.event_game_state,
      event_state_sequence: parsed.event_state_sequence,
   };
   let mut get_buf = [0u8; GetCashoutQuoteIxData::WIRE_LEN];
   get_ix.write_wire(&mut get_buf)?;

   let mut quotes =
      [const { MaybeUninit::<ProxyCashoutQuoteData>::uninit() }; MAX_NUMBER_OF_MMS_PROXY];
   let mut valid = 0usize;

   for i in 0..number_of_mms {
      let base = i * MM_ACCOUNTS_PER_MM;
      let mm_program = &mm_accounts[base];
      let mm_config = &mm_accounts[base + 1];
      let mm_event = &mm_accounts[base + 2];
      let mm_market = &mm_accounts[base + 3];
      let mm_buf = &mm_accounts[base + 4];

      if verify_mm_program_executable(mm_program).is_err() {
         continue;
      }

      if !verify_mm_config_pda(mm_config, mm_program) {
         continue;
      }
      if !verify_quote_buffer(mm_buf, mm_program) {
         continue;
      }
      if !verify_mm_market_data_pda(mm_market, mm_program, &market_wire) {
         continue;
      }
      if !verify_event_state(
         mm_event,
         mm_program,
         &event_id_wire,
         &parsed.event_game_state,
         parsed.event_state_sequence,
      ) {
         continue;
      }

      let metas = [
         InstructionAccount::new(user.address(), false, false),
         InstructionAccount::new(clock_sysvar.address(), false, false),
         InstructionAccount::new(mm_market.address(), false, false),
         InstructionAccount::new(mm_event.address(), false, false),
         InstructionAccount::new(mm_config.address(), false, false),
         InstructionAccount::new(mm_buf.address(), true, false),
      ];
      if invoke(
         &InstructionView {
            program_id: mm_program.address(),
            accounts: &metas,
            data: &get_buf,
         },
         &[
            user.as_ref(),
            clock_sysvar.as_ref(),
            mm_market.as_ref(),
            mm_event.as_ref(),
            mm_config.as_ref(),
            mm_buf.as_ref(),
         ],
      )
      .is_err()
      {
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
