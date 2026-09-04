//! RFQ cashout of a single bet.
//!
//! Accounts: **18** then **7** MM accounts.
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
//! **MM (7)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_event_state` (writable) — verified via `verify_event_state` before MM `fill_cashout_rfq`
//! 3. `mm_market_data` (writable) — verified via `verify_mm_market_data_pda` before MM `fill_cashout_rfq`
//! 4. `mm_encumbrance_pda` (writable)
//! 5. `mm_liability_token_account` (writable)
//! 6. `mm_token_account` (writable)

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, ProgramResult, address::address_eq, cpi::invoke,
   error::ProgramError, hint::unlikely, instruction::{InstructionAccount, InstructionView},
};
use pinocchio_log::log;

use crate::{
   constants::MAX_NUMBER_OF_MMS,
   errors::SpammError, helpers::{
      clock_unix_timestamp_u32, get_token_account_balance, verify_event_state, verify_mm_config_pda, verify_mm_market_data_pda, verify_mm_program_executable, verify_token_account,
      cashout_helpers::{
         accept_cashout_payment, cashout_payment_dest, cashout_requires_delay, finish_cashout_single, maybe_open_live_cashout_escrow, pay_cashout_from_free_liability, require_cashout_sequence_at_least, split_fillers,
         validate_cashout_size, verify_cashout_fill_preamble, verify_cashout_mm_encumbrance,
         verify_ticket_feepayer,
      },
      freebet_helpers::require_not_freebet, verify_bet_pda,
   }, readers::read_address_ref_unchecked, rfq_verify::verify_rfq_ed25519_signature, state::{
      BetAccountData, FILL_CASHOUT_RFQ_IX_DISCRIMINATOR, FillRfqCashoutIxData, FillRfqIxData, MM_CONFIG_PDA_RFQ_SIGNER_OFFSET, RFQ_CASHOUT_MESSAGE_LEN, account_bet::{BetFiller, BetResult}, build_rfq_cashout_message,
   },
};

pub const FILL_RFQ_CASHOUT_IX_DISCRIMINATOR: u8 = 72;

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
      mm_program,
      mm_config,
      mm_event,
      mm_market,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
   ] = accounts else {
      log!("fill_rfq_cashout: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

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
      "fill_rfq_cashout",
   )?;

   let (parsed, sig) = FillRfqCashoutIxData::decode_with_signature(data)?;
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
   if unlikely(!address_eq(&orig.owner, user.address()) || orig.bet_id != parsed.orig_bet_id) {
      return Err(ProgramError::InvalidInstructionData);
   }
   if orig.result != BetResult::Pending {
      return Err(SpammError::InvalidCashout.into());
   }
   validate_cashout_size(orig.amount, parsed.amount)?;
   require_cashout_sequence_at_least(parsed.event_state_sequence, orig.event_state_sequence)?;
   verify_bet_pda(bet_pda, user.address(), orig.bet_id, orig.bump)?;
   verify_token_account(true, bet_ata, bet_pda, mint, token_program)?;
   if !verify_mm_config_pda(mm_config, mm_program) {
      return Err(SpammError::MmNotRegistered.into());
   }
   verify_mm_program_executable(mm_program)?;
   if !verify_mm_market_data_pda(mm_market, mm_program, &orig.market_id.as_bytes()) {
      return Err(ProgramError::InvalidAccountData);
   }
   if !verify_event_state(
      mm_event,
      mm_program,
      &orig.market_id.event_id.as_wire_bytes(),
      &parsed.event_game_state,
      parsed.event_state_sequence,
   ) {
      return Err(ProgramError::InvalidAccountData);
   }
   if !verify_token_account(false, mm_token_account, mm_config, mint, token_program)? {
      return Err(ProgramError::InvalidAccountData);
   }
   let Some(encumbrance_pda_bump) = verify_cashout_mm_encumbrance(
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_program,
      mint,
      token_program,
   )? else {
      return Err(ProgramError::InvalidAccountData);
   };

   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   if parsed.offer_expiry < now {
      return Err(SpammError::QuoteExpired.into());
   }
   verify_rfq_cashout_sig(user.address(), mm_program.address(), mm_config, &parsed, &sig)?;

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
   if !accept_cashout_payment(parsed.max_payment, parsed.min_payout, payout_removed) {
      return Err(SpammError::SlippageExceeded.into());
   }
   let delay = cashout_requires_delay(
      orig.market_id.is_pregame(),
      orig.event_state_sequence,
      parsed.event_state_sequence,
   );
   let filling_mm = *mm_program.address();
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
      now,
      parsed.amount,
      payout_removed,
      parsed.max_payment,
      filling_mm,
      false,
   )?;
   {
      let payment_dest: &AccountView = cashout_payment_dest(delay, escrow_ata, user_ata);
      let payment_before = get_token_account_balance(payment_dest)?;
      let amount_to_send = pay_cashout_from_free_liability(
         mm_encumbrance_pda,
         encumbrance_pda_bump,
         mm_program.address(),
         mm_liability_token_account,
         payment_dest,
         parsed.max_payment,
      )?;
      let cpi = FillRfqIxData {
         instruction_discriminator: FILL_CASHOUT_RFQ_IX_DISCRIMINATOR,
         amount_to_send,
      };
      let mut cpi_buf = [0u8; FillRfqIxData::WIRE_LEN];
      cpi.write_wire(&mut cpi_buf)?;
      let metas = [
         InstructionAccount::new(user.address(), false, false),
         InstructionAccount::new(mm_market.address(), true, false),
         InstructionAccount::new(mm_event.address(), true, false),
         InstructionAccount::new(mm_config.address(), false, false),
         InstructionAccount::new(mm_token_account.address(), true, false),
         InstructionAccount::new(payment_dest.address(), true, false),
         InstructionAccount::new(mint.address(), false, false),
         InstructionAccount::new(token_program.address(), false, false),
         InstructionAccount::new(instructions_sysvar.address(), false, false),
      ];
      invoke(
         &InstructionView {
            program_id: mm_program.address(),
            accounts: &metas,
            data: &cpi_buf,
         },
         &[
            user.as_ref(),
            mm_market.as_ref(),
            mm_event.as_ref(),
            mm_config.as_ref(),
            mm_token_account.as_ref(),
            payment_dest.as_ref(),
            mint.as_ref(),
            token_program.as_ref(),
            instructions_sysvar.as_ref(),
         ],
      )?;
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
         &filling_mm,
         &orig,
         parsed.cashout_id,
         parsed.amount,
         payout_removed,
         now,
         parsed.event_state_sequence,
         parsed.event_game_state,
         &remaining,
         &cashed,
         delay,
         escrow_ata,
         payment_before,
         parsed.max_payment,
      )?;
   }
   Ok(())
}

#[inline(never)]
fn verify_rfq_cashout_sig(
   user: &pinocchio::Address,
   mm_program: &pinocchio::Address,
   mm_config: &AccountView,
   parsed: &FillRfqCashoutIxData,
   sig: &[u8; 64],
) -> ProgramResult {
   let mut msg = [0u8; RFQ_CASHOUT_MESSAGE_LEN];
   build_rfq_cashout_message(
      &mut msg,
      user,
      parsed.orig_bet_id,
      parsed.cashout_id,
      parsed.amount,
      parsed.max_payment,
      parsed.offer_expiry,
      parsed.event_state_sequence,
      &parsed.event_game_state,
      mm_program,
   )?;
   let rfq_signer = unsafe { read_address_ref_unchecked(mm_config.data_ptr(), MM_CONFIG_PDA_RFQ_SIGNER_OFFSET) };
   verify_rfq_ed25519_signature(rfq_signer, sig, &msg)
}
