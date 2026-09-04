//! Signed-quote RFQ fill for a parlay (one MM, no quote buffer).
//!
//! Accounts: **13** fixed + **5** MM (same fixed prefix as [`super::fill_parlay`]).
//! No per-leg market-data / event-state PDAs — legs are trusted via the MM ed25519 RFQ message.
//! **Fixed (13)**
//! 0. `feepayer` (writable signer)
//! 1. `user` (readonly signer)
//! 2. `user_ata` (writable)
//! 3. `bet_pda` (writable)
//! 4. `bet_ata` (writable)
//! 5. `config_pda` (readonly)
//! 6. `mint` (readonly)
//! 7. `token_program` (readonly)
//! 8. `associated_token_program` (readonly)
//! 9. `rent_sysvar` (readonly)
//! 10. `system_program` (readonly)
//! 11. `instructions_sysvar` (readonly)
//! 12. `clock_sysvar` (readonly)
//!
//! **MM (5)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_encumbrance_pda` (writable)
//! 3. `mm_liability_token_account` (writable)
//! 4. `mm_token_account` (writable)

use pinocchio::{
   AccountView, Address, ProgramResult, cpi::invoke,
   error::ProgramError, hint::unlikely,
   instruction::{InstructionAccount, InstructionView},
};
use pinocchio_log::log;

use crate::{
   constants::MAX_RFQ_PARLAY_LEGS, errors::SpammError, helpers::{
      calc_potential_payout, calc_potential_profit, clock_unix_timestamp_u32, ensure_pda_unused, get_encumbrance, get_token_account_balance, verify_associated_token_program, verify_clock_sysvar, verify_config_pda, verify_instructions_sysvar, verify_mint, verify_mm_config_pda, verify_mm_encumbrance_pda, verify_mm_program_executable, verify_rent_sysvar, verify_signer, verify_system_program, verify_token_account, verify_token_program,
      fill_helpers::{
         compute_liability_shortfall, create_parlay_bet_account, require_exact_token_increase,
      },
      freebet_helpers::{odds_in_freebet_range, require_freebet_mm_allowed, require_freebet_operator_allowed, verify_freebet_for_fill},
   }, instructions::fill_bet::FillBetStake, readers::read_address_ref_unchecked, rfq_verify::verify_rfq_ed25519_signature, state::{
      FILL_PARLAY_RFQ_IX_DISCRIMINATOR, FillRfqIxData, FillRfqParlayIxData, MM_CONFIG_PDA_RFQ_SIGNER_OFFSET, build_rfq_parlay_message, other::MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, rfq_message::{RFQ_PARLAY_MESSAGE_LEN, rfq_parlay_message_len},
   }, writers::write_i64_le_unchecked,
};

pub const FILL_RFQ_PARLAY_IX_DISCRIMINATOR: u8 = 13;

#[inline(never)]
fn verify_rfq_parlay_ed25519(
   user: &Address,
   mm_program: &Address,
   mm_config_pda: &AccountView,
   parsed_ix: &FillRfqParlayIxData,
   signature: &[u8; 64],
) -> Result<(), ProgramError> {
   let rfq_signer = unsafe {
      read_address_ref_unchecked(mm_config_pda.data_ptr(), MM_CONFIG_PDA_RFQ_SIGNER_OFFSET)
   };
   let n = parsed_ix.num_legs as usize;
   let msg_len = rfq_parlay_message_len(n);
   let mut message = [0u8; RFQ_PARLAY_MESSAGE_LEN];
   build_rfq_parlay_message(
      &mut message[..msg_len],
      user,
      parsed_ix.bet_id,
      parsed_ix.num_legs,
      parsed_ix.live_legs(),
      parsed_ix.max_stake,
      parsed_ix.odds_scaled,
      parsed_ix.offer_expiry,
      mm_program,
   )?;
   verify_rfq_ed25519_signature(rfq_signer, signature, &message[..msg_len])
}

#[inline(never)]
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [
      feepayer,
      user,
      user_ata,
      bet_pda,
      bet_ata,
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
      log!("fill_rfq_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   decode_and_run_fill_rfq_parlay(
      feepayer,
      user,
      bet_pda,
      bet_ata,
      config_pda,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
      instructions_sysvar,
      clock_sysvar,
      mm_accounts,
      data,
      FillBetStake {
         token_account: user_ata,
         authority: user,
         issuer_sign: None,
         freebet_id: 0,
         freebet: None,
      },
   )
}

/// Owns the fat RFQ-parlay ix on this frame only. Callers that also hold
/// `FreebetAccountData` must not inline this (and must not decode the ix themselves).
#[inline(never)]
pub(crate) fn decode_and_run_fill_rfq_parlay(
   feepayer: &AccountView,
   user: &AccountView,
   bet_pda: &mut AccountView,
   bet_ata: &AccountView,
   config_pda: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   associated_token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   instructions_sysvar: &AccountView,
   clock_sysvar: &AccountView,
   mm_accounts: &mut [AccountView],
   data: &[u8],
   stake: FillBetStake<'_>,
) -> ProgramResult {
   // One owned ix on this frame only (~3240B). Never return-by-value decode (doubles past 4KiB).
   let mut parsed_ix = unsafe { core::mem::zeroed::<FillRfqParlayIxData>() };
   let signature = FillRfqParlayIxData::decode_into(&mut parsed_ix, data)?;
   run_fill_rfq_parlay(
      feepayer,
      user,
      bet_pda,
      bet_ata,
      config_pda,
      mint,
      token_program,
      associated_token_program,
      rent_sysvar,
      system_program,
      instructions_sysvar,
      clock_sysvar,
      mm_accounts,
      &parsed_ix,
      signature,
      stake,
   )
}

#[inline(never)]
pub(crate) fn run_fill_rfq_parlay(
   feepayer: &AccountView,
   user: &AccountView,
   bet_pda: &mut AccountView,
   bet_ata: &AccountView,
   config_pda: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   associated_token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   instructions_sysvar: &AccountView,
   clock_sysvar: &AccountView,
   mm_accounts: &mut [AccountView],
   parsed_ix: &FillRfqParlayIxData,
   signature: [u8; 64],
   stake: FillBetStake<'_>,
) -> ProgramResult {
   let [
      mm_program_account,
      mm_config_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
   ] = mm_accounts else {
      log!("fill_rfq_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&feepayer)?;
   verify_signer(&user)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   verify_instructions_sysvar(instructions_sysvar)?;
   verify_clock_sysvar(clock_sysvar)?;
   verify_mint(mint)?;
   verify_token_account(true, stake.token_account, stake.authority, mint, token_program)?;
   verify_config_pda(config_pda, true)?;
   ensure_pda_unused(bet_pda, "fill_rfq_parlay")?;

   let bet_id = parsed_ix.bet_id;
   let amount = parsed_ix.amount;
   let odds_scaled = parsed_ix.odds_scaled;
   let num_legs_u8 = parsed_ix.num_legs;
   let num_legs = num_legs_u8 as usize;

   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   if unlikely(now > parsed_ix.offer_expiry) {
      log!("fill_rfq_parlay: quote expired");
      return Err(SpammError::QuoteExpired.into());
   }

   if let Some(fb) = stake.freebet {
      verify_freebet_for_fill(fb, user.address(), amount, num_legs_u8, now)?;
      require_freebet_mm_allowed(fb, mm_program_account.address())?;
      for i in 0..num_legs {
         require_freebet_operator_allowed(fb, &parsed_ix.legs[i].market_id.operator)?;
      }
      if !odds_in_freebet_range(odds_scaled, fb) {
         return Err(SpammError::FreebetOddsOutOfRange.into());
      }
   }

   verify_mm_program_executable(mm_program_account)?;
   if unlikely(!verify_mm_config_pda(mm_config_pda, mm_program_account)) {
      log!("fill_rfq_parlay: invalid mm config pda");
      return Err(SpammError::MmNotRegistered.into());
   }

   verify_rfq_parlay_ed25519(
      user.address(),
      mm_program_account.address(),
      mm_config_pda,
      &parsed_ix,
      &signature,
   )?;

   if unlikely(!verify_token_account(false, mm_token_account, mm_config_pda, mint, token_program)?) {
      log!("fill_rfq_parlay: invalid mm token account");
      return Err(ProgramError::InvalidAccountData);
   }
   if verify_mm_encumbrance_pda(mm_encumbrance_pda, mm_program_account).is_none() {
      log!("fill_rfq_parlay: invalid encumbrance pda");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!verify_token_account(
      false,
      mm_liability_token_account,
      mm_encumbrance_pda,
      mint,
      token_program,
   )?) {
      log!("fill_rfq_parlay: invalid mm liability token account");
      return Err(ProgramError::InvalidAccountData);
   }

   let Ok(mm_liability_account_balance_before) = get_token_account_balance(mm_liability_token_account) else {
      log!("fill_rfq_parlay: failed to read liability balance");
      return Err(ProgramError::InvalidAccountData);
   };
   let Ok(outstanding_liability) = get_encumbrance(mm_encumbrance_pda) else {
      log!("fill_rfq_parlay: failed to read encumbrance");
      return Err(ProgramError::InvalidAccountData);
   };

   let Ok(gross_margin_u64) = calc_potential_profit(amount, odds_scaled) else {
      log!("fill_rfq_parlay: failed to calc potential profit");
      return Err(ProgramError::InvalidInstructionData);
   };
   let gross_margin_i64: i64 = gross_margin_u64.try_into().map_err(|_| {
      log!("fill_rfq_parlay: gross margin does not fit i64");
      ProgramError::InvalidInstructionData
   })?;

   let (amount_to_send, new_outstanding_liability) = compute_liability_shortfall(
      mm_liability_account_balance_before,
      outstanding_liability,
      gross_margin_i64,
   )?;

   let fill_ix_data = FillRfqIxData {
      instruction_discriminator: FILL_PARLAY_RFQ_IX_DISCRIMINATOR,
      amount_to_send,
   };
   let mut fill_ix_buf = [0u8; FillRfqIxData::WIRE_LEN];
   fill_ix_data.write_wire(&mut fill_ix_buf)?;

   let fill_rfq_ix_account_metas = [
      InstructionAccount::new(user.address(), false, false),
      InstructionAccount::new(mm_config_pda.address(), true, false),
      InstructionAccount::new(mm_token_account.address(), true, false),
      InstructionAccount::new(mm_liability_token_account.address(), true, false),
      InstructionAccount::new(mint.address(), false, false),
      InstructionAccount::new(token_program.address(), false, false),
      InstructionAccount::new(instructions_sysvar.address(), false, false),
   ];
   let fill_rfq_invoke_accounts = [
      user.as_ref(),
      mm_config_pda.as_ref(),
      mm_token_account.as_ref(),
      mm_liability_token_account.as_ref(),
      mint.as_ref(),
      token_program.as_ref(),
      instructions_sysvar.as_ref(),
   ];
   invoke(
      &InstructionView {
         program_id: mm_program_account.address(),
         accounts: &fill_rfq_ix_account_metas,
         data: &fill_ix_buf,
      },
      &fill_rfq_invoke_accounts,
   )?;

   require_exact_token_increase(
      mm_liability_token_account,
      mm_liability_account_balance_before,
      amount_to_send,
   )?;

   unsafe {
      write_i64_le_unchecked(
         mm_encumbrance_pda.data_mut_ptr(),
         MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
         new_outstanding_liability,
      );
   }

   let filled_payout = calc_potential_payout(amount, odds_scaled)?;
   create_parlay_bet_from_rfq_legs(
      feepayer,
      user,
      stake,
      bet_pda,
      bet_ata,
      mint,
      token_program,
      rent_sysvar,
      system_program,
      bet_id,
      amount,
      filled_payout,
      now,
      num_legs,
      parsed_ix,
      mm_program_account.address(),
   )
}

/// Owns `[ParlayLegWire; MAX_RFQ_PARLAY_LEGS]` on this frame only.
#[inline(never)]
fn create_parlay_bet_from_rfq_legs(
   feepayer: &AccountView,
   user: &AccountView,
   stake: FillBetStake<'_>,
   bet_pda: &mut AccountView,
   bet_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   bet_id: u64,
   amount: u64,
   filled_payout: u64,
   now: u32,
   num_legs: usize,
   parsed_ix: &FillRfqParlayIxData,
   mm_program: &pinocchio::Address,
) -> ProgramResult {
   let mut stored = unsafe { core::mem::zeroed::<[crate::state::ParlayLegWire; MAX_RFQ_PARLAY_LEGS]>() };
   for i in 0..num_legs {
      stored[i] = parsed_ix.legs[i].with_pending();
   }
   create_parlay_bet_account(
      feepayer,
      user,
      stake.token_account,
      stake.authority,
      bet_pda,
      bet_ata,
      mint,
      token_program,
      rent_sysvar,
      system_program,
      bet_id,
      amount,
      filled_payout,
      now,
      stake.freebet_id,
      num_legs,
      &stored[..num_legs],
      mm_program,
      stake.issuer_sign,
      "fill_rfq_parlay",
   )
}

