//! Single-MM cashout of a parlay ticket.
//!
//! Accounts: **18** then **6 + 2 × L** (`L` = `num_legs`, 2..=20).
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
//! **MM (6 + 2 × L)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_parlay_quote_buffer` (writable)
//! 3. `mm_encumbrance_pda` (writable)
//! 4. `mm_liability_token_account` (writable)
//! 5. `mm_token_account` (writable)
//! 6+2*i. `mm_market_data` (readonly),
//!    `mm_event_state` (readonly) per leg *i*

use pinocchio::{
   AccountView, ProgramResult, cpi::invoke,
   error::ProgramError, instruction::{InstructionAccount, InstructionView},
};
use pinocchio_log::log;

use core::mem::MaybeUninit;

use crate::{
   constants::{MAX_PARLAY_LEGS, MAX_PARLAY_QUOTE_CPI_ACCOUNTS},
   errors::SpammError,
   helpers::{
      clock_unix_timestamp_u32, get_token_account_balance, verify_mm_config_pda, verify_mm_program_executable, verify_parlay_quote_buffer, verify_token_account,
      fill_helpers::invoke_parlay_quote_cpi,
      cashout_helpers::{
         accept_cashout_payment, cashout_payment_dest, finish_cashout_parlay,
         maybe_open_live_cashout_escrow, parse_cashout_quote_return_for_mm, pay_cashout_from_free_liability,
         validate_parlay_cashout_orig_ticket, verify_cashout_fill_preamble, verify_cashout_mm_encumbrance,
         verify_ticket_feepayer, ParlayCashoutOrigTicket,
      },
   },
   state::{
      account_bet::BetResult,
      mm_parlay_quote::ParlayLegWire,
      FillCashoutQuoteParlayIxData, FillParlayCashoutIxData, PARLAY_LEG_SEL_LEN,
      FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR, GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN,
      empty_parlay_leg_sel_buf,
      get_cashout_quote_parlay_ix_wire_len, write_get_cashout_quote_parlay_ix,
   },
};

pub const FILL_PARLAY_CASHOUT_IX_DISCRIMINATOR: u8 = 71;

/// Scalars needed after ticket validation — keeps the fat ix decode off the ticket frame.
#[derive(Clone, Copy)]
struct ParlayCashoutIxMeta {
   cashout_id: u64,
   amount: u64,
   min_payout: u64,
   num_legs: u8,
}

#[inline(never)]
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   // Fixed prefix is 18; MM accounts follow (checked later).
   if accounts.len() < 18 {
      log!("fill_parlay_cashout: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   verify_cashout_fill_preamble(
      &accounts[0],  // feepayer
      &accounts[2],  // user
      &accounts[3],  // user_ata
      &accounts[6],  // cashout_pda
      &accounts[10], // config_pda
      &accounts[11], // mint
      &accounts[12], // token_program
      &accounts[13], // associated_token_program
      &accounts[14], // rent_sysvar
      &accounts[15], // system_program
      &accounts[16], // instructions_sysvar
      &accounts[17], // clock_sysvar
      "fill_parlay_cashout",
   )?;
   run_fill_parlay_cashout(accounts, data)
}

/// Owns the fat ticket (~3944B). Takes the accounts slice (not 20 pointer args) so the frame fits.
#[inline(never)]
fn run_fill_parlay_cashout(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let mut ticket = unsafe { core::mem::zeroed::<ParlayCashoutOrigTicket>() };
   let (encumbrance_pda_bump, meta) =
      validate_mm_and_ticket_for_parlay_cashout(accounts, data, &mut ticket)?;
   finish_fill_parlay_cashout_after_ticket(accounts, &ticket, encumbrance_pda_bump, meta)
}

/// Owns decoded ix (~240B); writes ticket via out-param (caller's frame).
#[inline(never)]
fn validate_mm_and_ticket_for_parlay_cashout(
   accounts: &mut [AccountView],
   data: &[u8],
   ticket: &mut ParlayCashoutOrigTicket,
) -> Result<(u8, ParlayCashoutIxMeta), ProgramError> {
   let (fixed, mm_accounts) = accounts.split_at_mut(18);
   let ticket_feepayer = &fixed[1];
   let user = &fixed[2];
   let bet_pda = &fixed[4];
   let bet_ata = &fixed[5];
   let mint = &fixed[11];
   let token_program = &fixed[12];

   let parsed = FillParlayCashoutIxData::decode(data)?;
   let ix_data_meta = ParlayCashoutIxMeta {
      cashout_id: parsed.cashout_id,
      amount: parsed.amount,
      min_payout: parsed.min_payout,
      num_legs: parsed.num_legs,
   };
   let num_legs = ix_data_meta.num_legs as usize;
   let mm_fixed = 6;
   if mm_accounts.len() != mm_fixed + 2 * num_legs {
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   let mm_program = &mm_accounts[0];
   let mm_config = &mm_accounts[1];
   let mm_buf = &mm_accounts[2];
   let mm_encumbrance_pda = &mm_accounts[3];
   let mm_liability_token_account = &mm_accounts[4];
   let mm_token_account = &mm_accounts[5];
   let leg_accounts = &mm_accounts[mm_fixed..];

   validate_parlay_cashout_orig_ticket(
      user,
      bet_pda,
      bet_ata,
      mint,
      token_program,
      parsed.orig_bet_id,
      parsed.amount,
      parsed.num_legs,
      &parsed.snapshots,
      Some((mm_program, leg_accounts)),
      ticket,
   )?;
   verify_ticket_feepayer(ticket_feepayer, &ticket.orig_feepayer)?;
   verify_mm_program_executable(mm_program)?;
   if !verify_mm_config_pda(mm_config, mm_program) {
      return Err(SpammError::MmNotRegistered.into());
   }
   if !verify_parlay_quote_buffer(mm_buf, mm_program) {
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
   Ok((encumbrance_pda_bump, ix_data_meta))
}

/// Owns `legs_buf`. Ticket is borrowed (lives on `run_fill_parlay_cashout`).
#[inline(never)]
fn finish_fill_parlay_cashout_after_ticket(
   accounts: &mut [AccountView],
   ticket: &ParlayCashoutOrigTicket,
   encumbrance_pda_bump: u8,
   ix_data_meta: ParlayCashoutIxMeta,
) -> ProgramResult {
   let (fixed, mm_accounts) = accounts.split_at_mut(18);
   // Exact fixed layout (18). `config_pda` / `associated_token_program` already checked in preamble.
   #[allow(unused_variables)]
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
   ] = fixed else {
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   let num_legs = ix_data_meta.num_legs as usize;
   let mm_fixed = 6;
   let mm_program = &mm_accounts[0];
   let mm_config = &mm_accounts[1];
   let mm_buf = &mm_accounts[2];
   let mm_encumbrance_pda = &mm_accounts[3];
   let mm_liability_token_account = &mm_accounts[4];
   let mm_token_account = &mm_accounts[5];
   let leg_accounts = &mm_accounts[mm_fixed..];

   let mut legs_buf = unsafe { core::mem::zeroed::<[ParlayLegWire; MAX_PARLAY_LEGS]>() };
   for i in 0..num_legs {
      legs_buf[i] = ParlayLegWire {
         market_id: ticket.legs[i].market_id,
         side: ticket.legs[i].side,
         event_state_sequence: ticket.legs[i].cashout_event_state_sequence,
         event_game_state: ticket.legs[i].cashout_event_game_state,
         odds_scaled: ticket.legs[i].odds_scaled,
         result: BetResult::Pending,
      };
   }

   let max_payment = quote_parlay_cashout_mm(
      user,
      clock_sysvar,
      mm_program,
      mm_config,
      mm_buf,
      leg_accounts,
      ix_data_meta.amount,
      ix_data_meta.min_payout,
      num_legs,
      &legs_buf[..num_legs],
      ticket.payout_removed,
   )?;
   let timestamp = clock_unix_timestamp_u32(clock_sysvar)?;
   maybe_open_live_cashout_escrow(
      ticket.delay,
      feepayer,
      user,
      escrow_pda,
      escrow_ata,
      mint,
      token_program,
      rent_sysvar,
      system_program,
      ticket.orig_bet_id,
      ix_data_meta.cashout_id,
      timestamp,
      ix_data_meta.amount,
      ticket.payout_removed,
      max_payment,
      *mm_program.address(),
      true,
   )?;

   let payment_dest: &AccountView = cashout_payment_dest(ticket.delay, escrow_ata, user_ata);
   let payment_before = get_token_account_balance(payment_dest)?;
   let amount_to_send = pay_cashout_from_free_liability(
      mm_encumbrance_pda,
      encumbrance_pda_bump,
      mm_program.address(),
      mm_liability_token_account,
      payment_dest,
      max_payment,
   )?;
   invoke_fill_cashout_quote_parlay(
      user,
      mm_program,
      mm_config,
      mm_buf,
      mm_token_account,
      payment_dest,
      mint,
      token_program,
      instructions_sysvar,
      ix_data_meta.amount,
      amount_to_send,
   )?;

   finish_cashout_parlay(
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
      mm_program.address(),
      ix_data_meta.cashout_id,
      ix_data_meta.amount,
      ix_data_meta.num_legs,
      &ticket.legs[..num_legs],
      ticket.payout_removed,
      ticket.delay,
      ticket.orig_amount,
      ticket.orig_payout,
      ticket.orig_bet_id,
      ticket.orig_bump,
      ticket.orig_feepayer,
      ticket.orig_filler,
      timestamp,
      escrow_ata,
      payment_before,
      max_payment,
   )
}

#[inline(never)]
fn quote_parlay_cashout_mm(
   user: &AccountView,
   clock_sysvar: &AccountView,
   mm_program: &AccountView,
   mm_config: &AccountView,
   mm_buf: &AccountView,
   leg_accounts: &[AccountView],
   amount: u64,
   min_payout: u64,
   num_legs: usize,
   legs: &[ParlayLegWire],
   payout_removed: u64,
) -> Result<u64, ProgramError> {
   let wire_len = get_cashout_quote_parlay_ix_wire_len(num_legs);
   let mut qbuf = [0u8; GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN + MAX_PARLAY_LEGS * PARLAY_LEG_SEL_LEN];
   if wire_len > qbuf.len() {
      return Err(ProgramError::InvalidInstructionData);
   }
   pack_cashout_quote_parlay_ix(
      &mut qbuf[..wire_len],
      amount,
      payout_removed,
      min_payout,
      num_legs,
      legs,
   )?;

   if !cpi_get_cashout_quote_parlay(
      num_legs,
      &qbuf[..wire_len],
      user,
      clock_sysvar,
      mm_program,
      mm_config,
      mm_buf,
      leg_accounts,
   ) {
      return Err(SpammError::NoQuotesAvailable.into());
   }
   let Some(max_payment) = parse_cashout_quote_return_for_mm(mm_program) else {
      return Err(SpammError::NoQuotesAvailable.into());
   };
   if !accept_cashout_payment(max_payment, min_payout, payout_removed) {
      return Err(SpammError::SlippageExceeded.into());
   }
   Ok(max_payment)
}

/// Owns `[ParlayLegSel; MAX_PARLAY_LEGS]` on this frame only (keeps it off `quote_parlay_cashout_mm`).
#[inline(never)]
fn pack_cashout_quote_parlay_ix(
   out: &mut [u8],
   amount: u64,
   payout_removed: u64,
   min_payout: u64,
   num_legs: usize,
   legs: &[ParlayLegWire],
) -> Result<(), ProgramError> {
   let mut sels = empty_parlay_leg_sel_buf::<MAX_PARLAY_LEGS>();
   for i in 0..num_legs {
      sels[i] = legs[i].sel();
   }
   write_get_cashout_quote_parlay_ix(out, amount, payout_removed, min_payout, num_legs, &sels[..num_legs])
}

#[inline(never)]
fn invoke_fill_cashout_quote_parlay(
   user: &AccountView,
   mm_program: &AccountView,
   mm_config: &AccountView,
   mm_buf: &AccountView,
   mm_token_account: &AccountView,
   payment_dest: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   instructions_sysvar: &AccountView,
   amount: u64,
   amount_to_send: u64,
) -> ProgramResult {
   let fill_ix = FillCashoutQuoteParlayIxData {
      instruction_discriminator: FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
      amount,
      amount_to_send,
   };
   let mut fill_buf = [0u8; FillCashoutQuoteParlayIxData::WIRE_LEN];
   fill_ix.write_wire(&mut fill_buf)?;
   let fill_metas = [
      InstructionAccount::new(user.address(), false, false),
      InstructionAccount::new(mm_config.address(), false, false),
      InstructionAccount::new(mm_buf.address(), true, false),
      InstructionAccount::new(mm_token_account.address(), true, false),
      InstructionAccount::new(payment_dest.address(), true, false),
      InstructionAccount::new(mint.address(), false, false),
      InstructionAccount::new(token_program.address(), false, false),
      InstructionAccount::new(instructions_sysvar.address(), false, false),
   ];
   invoke(
      &InstructionView {
         program_id: mm_program.address(),
         accounts: &fill_metas,
         data: &fill_buf,
      },
      &[
         user.as_ref(),
         mm_config.as_ref(),
         mm_buf.as_ref(),
         mm_token_account.as_ref(),
         payment_dest.as_ref(),
         mint.as_ref(),
         token_program.as_ref(),
         instructions_sysvar.as_ref(),
      ],
   )
}

#[inline(never)]
fn cpi_get_cashout_quote_parlay(
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
