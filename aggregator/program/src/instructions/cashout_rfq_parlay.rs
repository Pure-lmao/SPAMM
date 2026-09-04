//! RFQ cashout of a parlay ticket.
//!
//! Accounts: **18** then **exactly 5** MM accounts (no per-leg PDAs).
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
//! **MM (5)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_encumbrance_pda` (writable)
//! 3. `mm_liability_token_account` (writable)
//! 4. `mm_token_account` (writable)

use pinocchio::{
   AccountView, ProgramResult, cpi::invoke,
   error::ProgramError, instruction::{InstructionAccount, InstructionView},
};
use pinocchio_log::log;

use crate::{
   errors::SpammError, helpers::{
      clock_unix_timestamp_u32, get_token_account_balance, verify_mm_config_pda, verify_mm_program_executable, verify_token_account,
      cashout_helpers::{
         accept_cashout_payment, cashout_payment_dest, finish_cashout_parlay, maybe_open_live_cashout_escrow, pay_cashout_from_free_liability,
         validate_parlay_cashout_orig_ticket, verify_cashout_fill_preamble, verify_cashout_mm_encumbrance,
         verify_ticket_feepayer, ParlayCashoutOrigTicket,
      },
   }, readers::read_address_ref_unchecked, rfq_verify::verify_rfq_ed25519_signature, state::{
      FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR, FillRfqIxData, FillRfqParlayCashoutIxData, MM_CONFIG_PDA_RFQ_SIGNER_OFFSET, RFQ_CASHOUT_PARLAY_MESSAGE_LEN, build_rfq_cashout_parlay_message, rfq_cashout_parlay_message_len,
   },
};

pub const FILL_RFQ_PARLAY_CASHOUT_IX_DISCRIMINATOR: u8 = 73;

/// Scalars needed after ticket validation — avoids a second ix decode on the finish frame.
#[derive(Clone, Copy)]
struct RfqParlayCashoutIxMeta {
   cashout_id: u64,
   amount: u64,
   max_payment: u64,
   num_legs: u8,
}

#[inline(never)]
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   if accounts.len() < 18 {
      log!("fill_rfq_parlay_cashout: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   verify_cashout_fill_preamble(
      &accounts[0],
      &accounts[2],
      &accounts[3],
      &accounts[6],
      &accounts[10],
      &accounts[11],
      &accounts[12],
      &accounts[13],
      &accounts[14],
      &accounts[15],
      &accounts[16],
      &accounts[17],
      "fill_rfq_parlay_cashout",
   )?;
   run_fill_rfq_parlay_cashout(accounts, data)
}

/// Owns ticket (~3944B). Slice args keep the frame under 4KiB.
#[inline(never)]
fn run_fill_rfq_parlay_cashout(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let now = {
      let clock_sysvar = accounts.get(17).ok_or(ProgramError::NotEnoughAccountKeys)?;
      clock_unix_timestamp_u32(clock_sysvar)?
   };
   let mut ticket = unsafe { core::mem::zeroed::<ParlayCashoutOrigTicket>() };
   let (encumbrance_pda_bump, meta) =
      decode_validate_rfq_parlay_cashout(accounts, data, now, &mut ticket)?;
   finish_rfq_parlay_cashout_after_ticket(accounts, now, &ticket, encumbrance_pda_bump, meta)
}

/// Owns decoded RFQ ix (~448B) + verifies ed25519 on a deeper frame; writes ticket via out-param.
#[inline(never)]
fn decode_validate_rfq_parlay_cashout(
   accounts: &mut [AccountView],
   data: &[u8],
   now: u32,
   ticket: &mut ParlayCashoutOrigTicket,
) -> Result<(u8, RfqParlayCashoutIxMeta), ProgramError> {
   let (fixed, mm_rest) = accounts.split_at_mut(18);
   let ticket_feepayer = &fixed[1];
   let user = &fixed[2];
   let bet_pda = &fixed[4];
   let bet_ata = &fixed[5];
   let mint = &fixed[11];
   let token_program = &fixed[12];

   let (parsed, sig) = FillRfqParlayCashoutIxData::decode_with_signature(data)?;
   let ix_data_meta = RfqParlayCashoutIxMeta {
      cashout_id: parsed.cashout_id,
      amount: parsed.amount,
      max_payment: parsed.max_payment,
      num_legs: parsed.num_legs,
   };
   if mm_rest.len() != 5 {
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   let mm_program = &mm_rest[0];
   let mm_config = &mm_rest[1];
   let mm_encumbrance_pda = &mm_rest[2];
   let mm_liability_token_account = &mm_rest[3];
   let mm_token_account = &mm_rest[4];

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
      None,
      ticket,
   )?;
   verify_ticket_feepayer(ticket_feepayer, &ticket.orig_feepayer)?;
   if !verify_mm_config_pda(mm_config, mm_program) {
      return Err(SpammError::MmNotRegistered.into());
   }
   verify_mm_program_executable(mm_program)?;
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
   if parsed.offer_expiry < now {
      return Err(SpammError::QuoteExpired.into());
   }
   if !accept_cashout_payment(parsed.max_payment, parsed.min_payout, ticket.payout_removed) {
      return Err(SpammError::SlippageExceeded.into());
   }
   verify_rfq_parlay_cashout_sig(user.address(), mm_program.address(), mm_config, &parsed, &sig)?;
   Ok((encumbrance_pda_bump, ix_data_meta))
}

/// Ticket borrowed from `run_fill_rfq_parlay_cashout`; ix scalars from `meta` (no second decode).
#[inline(never)]
fn finish_rfq_parlay_cashout_after_ticket(
   accounts: &mut [AccountView],
   now: u32,
   ticket: &ParlayCashoutOrigTicket,
   encumbrance_pda_bump: u8,
   meta: RfqParlayCashoutIxMeta,
) -> ProgramResult {
   let (fixed, mm_rest) = accounts.split_at_mut(18);
   // Exact fixed layout (18). Prefixed slots already checked in preamble / unused on this path.
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

   let num_legs = meta.num_legs as usize;
   let mm_program = &mm_rest[0];
   let mm_config = &mm_rest[1];
   let mm_encumbrance_pda = &mm_rest[2];
   let mm_liability_token_account = &mm_rest[3];
   let mm_token_account = &mm_rest[4];

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
      meta.cashout_id,
      now,
      meta.amount,
      ticket.payout_removed,
      meta.max_payment,
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
      meta.max_payment,
   )?;
   invoke_fill_rfq_parlay_cashout_mm(
      user,
      mm_program,
      mm_config,
      mm_token_account,
      payment_dest,
      mint,
      token_program,
      instructions_sysvar,
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
      meta.cashout_id,
      meta.amount,
      meta.num_legs,
      &ticket.legs[..num_legs],
      ticket.payout_removed,
      ticket.delay,
      ticket.orig_amount,
      ticket.orig_payout,
      ticket.orig_bet_id,
      ticket.orig_bump,
      ticket.orig_feepayer,
      ticket.orig_filler,
      now,
      escrow_ata,
      payment_before,
      meta.max_payment,
   )
}

#[inline(never)]
fn invoke_fill_rfq_parlay_cashout_mm(
   user: &AccountView,
   mm_program: &AccountView,
   mm_config: &AccountView,
   mm_token_account: &AccountView,
   payment_dest: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   instructions_sysvar: &AccountView,
   amount_to_send: u64,
) -> ProgramResult {
   let cpi = FillRfqIxData {
      instruction_discriminator: FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR,
      amount_to_send,
   };
   let mut cpi_buf = [0u8; FillRfqIxData::WIRE_LEN];
   cpi.write_wire(&mut cpi_buf)?;
   let metas = [
      InstructionAccount::new(user.address(), false, false),
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
         mm_config.as_ref(),
         mm_token_account.as_ref(),
         payment_dest.as_ref(),
         mint.as_ref(),
         token_program.as_ref(),
         instructions_sysvar.as_ref(),
      ],
   )
}

#[inline(never)]
fn verify_rfq_parlay_cashout_sig(
   user: &pinocchio::Address,
   mm_program: &pinocchio::Address,
   mm_config: &AccountView,
   parsed: &FillRfqParlayCashoutIxData,
   sig: &[u8; 64],
) -> ProgramResult {
   let n = parsed.num_legs as usize;
   let msg_len = rfq_cashout_parlay_message_len(n);
   let mut msg = [0u8; RFQ_CASHOUT_PARLAY_MESSAGE_LEN];
   build_rfq_cashout_parlay_message(
      &mut msg[..msg_len],
      user,
      parsed.orig_bet_id,
      parsed.cashout_id,
      parsed.amount,
      parsed.max_payment,
      parsed.offer_expiry,
      mm_program,
      parsed.num_legs,
      &parsed.snapshots[..n],
   )?;
   let rfq_signer = unsafe { read_address_ref_unchecked(mm_config.data_ptr(), MM_CONFIG_PDA_RFQ_SIGNER_OFFSET) };
   verify_rfq_ed25519_signature(rfq_signer, sig, &msg[..msg_len])
}
