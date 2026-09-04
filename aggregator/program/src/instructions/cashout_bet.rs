//! Auction cashout of a single bet: CPI `get_cashout_quote` across MMs, fill best payment, novate the slice.
//!
//! Accounts: **18** then **8 × N** (`N` ≤ 5).
//!
//! **Fixed (18)**
//! 0. `feepayer` (writable signer)
//! 1. `ticket_feepayer` (writable) — original ticket `feepayer`; rent dest on full pregame close
//! 2. `user` (readonly signer)
//! 3. `user_ata` (writable)
//! 4. `bet_pda` (writable)
//! 5. `bet_ata` (writable)
//! 6. `cashout_pda` (writable)
//! 7. `cashout_ata` (writable)
//! 8. `escrow_pda` (writable) — unused pregame (may be system program)
//! 9. `escrow_ata` (writable) — unused pregame (may be system program)
//! 10. `config_pda` (readonly)
//! 11. `mint` (readonly)
//! 12. `token_program` (readonly)
//! 13. `associated_token_program` (readonly)
//! 14. `rent_sysvar` (readonly)
//! 15. `system_program` (readonly)
//! 16. `instructions_sysvar` (readonly)
//! 17. `clock_sysvar` (readonly)
//!
//! **Per MM (8)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_event_state` (writable)
//! 3. `mm_market_data` (writable)
//! 4. `mm_quote_buffer` (writable)
//! 5. `mm_encumbrance_pda` (writable)
//! 6. `mm_liability_token_account` (writable)
//! 7. `mm_token_account` (writable)

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::invoke,
   error::ProgramError, hint::unlikely, instruction::{InstructionAccount, InstructionView},
};
use pinocchio_log::log;

use crate::{
   constants::MAX_NUMBER_OF_MMS, errors::SpammError, helpers::{
      clock_unix_timestamp_u32, get_token_account_balance, verify_event_state, verify_mm_config_pda,
      verify_mm_market_data_pda, verify_mm_program_executable, verify_quote_buffer, verify_token_account,
      reject_duplicate_mm_programs,
      cashout_helpers::{
         accept_cashout_payment, cashout_payment_dest, cashout_requires_delay, finish_cashout_single,
         maybe_open_live_cashout_escrow, parse_cashout_quote_return_for_mm, pay_cashout_from_free_liability, require_cashout_sequence_at_least, split_fillers,
         validate_cashout_size, verify_cashout_fill_preamble, verify_cashout_mm_encumbrance,
         verify_ticket_feepayer,
      }, freebet_helpers::require_not_freebet, verify_bet_pda,
   }, state::{
      BetAccountData, FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR, FillCashoutIxData, FillCashoutQuoteIxData, GET_CASHOUT_QUOTE_IX_DISCRIMINATOR, GetCashoutQuoteIxData, account_bet::{BetFiller, BetResult}, event_id_wire_from_market_wire,
   },
};

pub const FILL_CASHOUT_IX_DISCRIMINATOR: u8 = 70;
const MM_ACCOUNTS_PER_MM: usize = 8;

struct CashoutQuote<'a> {
   max_payment: u64,
   mm_address: &'a Address,
   mm_token_account: &'a AccountView,
   mm_quote_buffer: &'a AccountView,
   mm_config_pda: &'a AccountView,
   mm_market_data_pda: &'a AccountView,
   mm_event_state_pda: &'a AccountView,
   mm_encumbrance_pda: &'a AccountView,
   mm_liability_token_account: &'a AccountView,
   encumbrance_pda_bump: u8,
}

#[inline(never)]
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      feepayer,
      ticket_feepayer,
      user,
      user_ata,
      bet_pda,
      bet_ata,
      cashout_pda,
      cashout_ata,
      escrow_pda,
      escrow_ata,
      config_pda,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
      instructions_sysvar,
      clock_sysvar,
      mm_accounts @ ..,
   ] = accounts else {
      log!("fill_cashout: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   if mm_accounts.len() < MM_ACCOUNTS_PER_MM || mm_accounts.len() % MM_ACCOUNTS_PER_MM != 0 {
      log!("fill_cashout: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   let number_of_mms = mm_accounts.len() / MM_ACCOUNTS_PER_MM;
   if number_of_mms > MAX_NUMBER_OF_MMS {
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   reject_duplicate_mm_programs(mm_accounts, MM_ACCOUNTS_PER_MM)?;

   verify_cashout_fill_preamble(
      feepayer,
      user,
      user_ata,
      cashout_pda,
      config_pda,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
      instructions_sysvar,
      clock_sysvar,
      "fill_cashout",
   )?;

   let parsed = FillCashoutIxData::decode(data)?;
   let mut orig_fillers_buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let orig = {
      let raw = bet_pda.try_borrow()?;
      let h = BetAccountData::decode_header(raw.as_ref())?;
      let n = h.num_fillers as usize;
      BetAccountData::decode_fillers_into(raw.as_ref(), n, &mut orig_fillers_buf)?;
      h
   };
   require_not_freebet(orig.freebet_id)?;
   verify_ticket_feepayer(ticket_feepayer, &orig.feepayer)?;
   if unlikely(!address_eq(&orig.owner, user.address())) {
      log!("fill_cashout: user is not owner");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(orig.bet_id != parsed.orig_bet_id) {
      log!("fill_cashout: orig_bet_id mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(orig.result != BetResult::Pending) {
      return Err(SpammError::InvalidCashout.into());
   }
   validate_cashout_size(orig.amount, parsed.amount)?;
   require_cashout_sequence_at_least(parsed.event_state_sequence, orig.event_state_sequence)?;
   verify_token_account(true, bet_ata, bet_pda, mint, token_program)?;

   verify_bet_pda(bet_pda, user.address(), orig.bet_id, orig.bump)?;

   let num = orig.num_fillers as usize;
   let orig_fillers = unsafe {
      core::slice::from_raw_parts(orig_fillers_buf.as_ptr().cast::<BetFiller>(), num)
   };
   let mut remaining_buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let mut cashed_buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let payout_removed = split_fillers(
      orig_fillers,
      num,
      orig.amount,
      parsed.amount,
      &mut remaining_buf,
      &mut cashed_buf,
   )?;
   let remaining = unsafe {
      core::slice::from_raw_parts(remaining_buf.as_ptr().cast::<BetFiller>(), num)
   };
   let cashed = unsafe {
      core::slice::from_raw_parts(cashed_buf.as_ptr().cast::<BetFiller>(), num)
   };

   let market_id = orig.market_id;
   let side = orig.side;
   let event_state_sequence = parsed.event_state_sequence;
   let event_game_state = parsed.event_game_state;
   let market_wire = market_id.as_bytes();
   let event_id_wire = event_id_wire_from_market_wire(&market_wire);

   let get_cashout_ix = GetCashoutQuoteIxData {
      instruction_discriminator: GET_CASHOUT_QUOTE_IX_DISCRIMINATOR,
      amount: parsed.amount,
      payout: payout_removed,
      min_payout: parsed.min_payout,
      market_id,
      side,
      event_game_state,
      event_state_sequence,
   };
   let mut get_cashout_buf = [0u8; GetCashoutQuoteIxData::WIRE_LEN];
   get_cashout_ix.write_wire(&mut get_cashout_buf)?;

   let mut quotes = [const { MaybeUninit::<CashoutQuote>::uninit() }; MAX_NUMBER_OF_MMS];
   let mut valid = 0usize;

   for i in 0..number_of_mms {
      let base = i * MM_ACCOUNTS_PER_MM;
      let mm_program_account = &mm_accounts[base];
      let mm_config_pda = &mm_accounts[base + 1];
      let mm_event_state_pda = &mm_accounts[base + 2];
      let mm_market_data_pda = &mm_accounts[base + 3];
      let mm_quote_buffer = &mm_accounts[base + 4];
      let mm_encumbrance_pda = &mm_accounts[base + 5];
      let mm_liability_token_account = &mm_accounts[base + 6];
      let mm_token_account = &mm_accounts[base + 7];

      if verify_mm_program_executable(mm_program_account).is_err() {
         continue;
      }
      if !verify_mm_config_pda(mm_config_pda, mm_program_account) {
         continue;
      }
      if !verify_quote_buffer(mm_quote_buffer, mm_program_account) {
         continue;
      }
      if !verify_mm_market_data_pda(mm_market_data_pda, mm_program_account, &market_wire) {
         continue;
      }
      if !verify_event_state(mm_event_state_pda, mm_program_account, event_id_wire, &event_game_state, event_state_sequence) {
         continue;
      }
      if !verify_token_account(false, mm_token_account, mm_config_pda, mint, token_program)? {
         continue;
      }
      let Some(encumbrance_pda_bump) = verify_cashout_mm_encumbrance(
         mm_encumbrance_pda,
         mm_liability_token_account,
         mm_program_account,
         mint,
         token_program,
      )? else {
         continue;
      };

      let metas = [
         InstructionAccount::new(user.address(), false, false),
         InstructionAccount::new(clock_sysvar.address(), false, false),
         InstructionAccount::new(mm_market_data_pda.address(), false, false),
         InstructionAccount::new(mm_event_state_pda.address(), false, false),
         InstructionAccount::new(mm_config_pda.address(), false, false),
         InstructionAccount::new(mm_quote_buffer.address(), true, false),
      ];
      let view = InstructionView {
         program_id: mm_program_account.address(),
         accounts: &metas,
         data: &get_cashout_buf,
      };
      if invoke(
         &view,
         &[
            user.as_ref(),
            clock_sysvar.as_ref(),
            mm_market_data_pda.as_ref(),
            mm_event_state_pda.as_ref(),
            mm_config_pda.as_ref(),
            mm_quote_buffer.as_ref(),
         ],
      )
      .is_err()
      {
         continue;
      }
      let Some(max_payment) = parse_cashout_quote_return_for_mm(mm_program_account) else {
         continue;
      };
      if !accept_cashout_payment(max_payment, parsed.min_payout, payout_removed) {
         continue;
      }
      quotes[valid].write(CashoutQuote {
         max_payment,
         mm_address: mm_program_account.address(),
         mm_token_account,
         mm_quote_buffer,
         mm_config_pda,
         mm_market_data_pda,
         mm_event_state_pda,
         mm_encumbrance_pda,
         mm_liability_token_account,
         encumbrance_pda_bump,
      });
      valid += 1;
   }

   if valid == 0 {
      return Err(SpammError::NoQuotesAvailable.into());
   }

   let mut best_i = 0usize;
   let mut best_payment = 0u64;
   for i in 0..valid {
      let q = unsafe { quotes[i].assume_init_ref() };
      if q.max_payment > best_payment {
         best_payment = q.max_payment;
         best_i = i;
      }
   }
   let winner = unsafe { quotes[best_i].assume_init_read() };

   let delay = cashout_requires_delay(
      market_id.is_pregame(),
      orig.event_state_sequence,
      event_state_sequence,
   );

   let timestamp = clock_unix_timestamp_u32(clock_sysvar)?;
   maybe_open_live_cashout_escrow(
      delay,
      feepayer,
      user,
      escrow_pda,
      escrow_ata,
      mint,
      token_program,
      rent_sysvar,
      system_program,
      orig.bet_id,
      parsed.cashout_id,
      timestamp,
      parsed.amount,
      payout_removed,
      winner.max_payment,
      *winner.mm_address,
      false,
   )?;

   let payment_dest: &AccountView = cashout_payment_dest(delay, escrow_ata, user_ata);
   let payment_before = get_token_account_balance(payment_dest)?;
   let amount_to_send = pay_cashout_from_free_liability(
      winner.mm_encumbrance_pda,
      winner.encumbrance_pda_bump,
      winner.mm_address,
      winner.mm_liability_token_account,
      payment_dest,
      winner.max_payment,
   )?;
   {
      let fill_ix = FillCashoutQuoteIxData {
         instruction_discriminator: FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR,
         amount: parsed.amount,
         amount_to_send,
         market_id,
         side,
         event_game_state,
         event_state_sequence,
      };
      let mut fill_buf = [0u8; FillCashoutQuoteIxData::WIRE_LEN];
      fill_ix.write_wire(&mut fill_buf)?;
      let fill_metas = [
         InstructionAccount::new(user.address(), false, false),
         InstructionAccount::new(winner.mm_market_data_pda.address(), true, false),
         InstructionAccount::new(winner.mm_event_state_pda.address(), true, false),
         InstructionAccount::new(winner.mm_config_pda.address(), false, false),
         InstructionAccount::new(winner.mm_quote_buffer.address(), true, false),
         InstructionAccount::new(winner.mm_token_account.address(), true, false),
         InstructionAccount::new(payment_dest.address(), true, false),
         InstructionAccount::new(mint.address(), false, false),
         InstructionAccount::new(token_program.address(), false, false),
         InstructionAccount::new(instructions_sysvar.address(), false, false),
      ];
      let fill_view = InstructionView {
         program_id: winner.mm_address,
         accounts: &fill_metas,
         data: &fill_buf,
      };
      invoke(
         &fill_view,
         &[
            user.as_ref(),
            winner.mm_market_data_pda.as_ref(),
            winner.mm_event_state_pda.as_ref(),
            winner.mm_config_pda.as_ref(),
            winner.mm_quote_buffer.as_ref(),
            winner.mm_token_account.as_ref(),
            payment_dest.as_ref(),
            mint.as_ref(),
            token_program.as_ref(),
            instructions_sysvar.as_ref(),
         ],
      )?;
   }

   finish_cashout_single(
      feepayer,
      ticket_feepayer,
      user,
      user_ata,
      bet_pda,
      bet_ata,
      cashout_pda,
      cashout_ata,
      mint,
      token_program,
      rent_sysvar,
      system_program,
      winner.mm_address,
      &orig,
      parsed.cashout_id,
      parsed.amount,
      payout_removed,
      timestamp,
      event_state_sequence,
      event_game_state,
      &remaining,
      &cashed,
      delay,
      escrow_ata,
      payment_before,
      winner.max_payment,
   )
}

