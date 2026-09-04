//! Single MM: CPI `get_quote_parlay`, require odds ≥ `min_odds_scaled`, CPI `fill_parlay_quote`, then create parlay bet PDA + ATA.
//!
//! Accounts: **13** fixed, then **6 + 2 × L** for one MM (`L` = `num_legs`).
//!
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
//! **MM (6 + 2 × L)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_parlay_quote_buffer` (writable)
//! 3. `mm_encumbrance_pda` (writable)
//! 4. `mm_liability_token_account` (writable)
//! 5. `mm_token_account` (writable)
//! 6+2*i. `mm_market_data_pda` (readonly),
//!    `mm_event_state_pda` (readonly) per leg *i*
//!
//! Data (after router discriminator): header (`bet_id`, `amount`, `min_odds_scaled`, `num_legs`)
//! + [`ParlayLegSel`] × `num_legs` only (no padding; max [`MAX_PARLAY_LEGS`]).

use pinocchio::{
   AccountView, ProgramResult, cpi::invoke,
   error::ProgramError, hint::unlikely, instruction::{InstructionAccount, InstructionView},
};
#[cfg(feature = "log")]
use pinocchio_log::log;

use crate::{
   constants::{MAX_PARLAY_LEGS}, errors::SpammError, helpers::{
      calc_potential_payout, calc_potential_profit, clock_unix_timestamp_u32, ensure_pda_unused, get_encumbrance, get_token_account_balance, verify_associated_token_program, verify_clock_sysvar, verify_config_pda, verify_instructions_sysvar, verify_mint, verify_mm_config_pda, verify_mm_encumbrance_pda, verify_mm_program_executable, verify_parlay_quote_buffer, verify_rent_sysvar, verify_signer, verify_system_program, verify_token_account, verify_token_program,
      fill_helpers::{
         compute_liability_shortfall, create_parlay_bet_account, require_exact_token_increase,
         invoke_mm_get_quote_parlay, parse_parlay_quote_return_for_mm,
      },
      freebet_helpers::{odds_in_freebet_range, require_freebet_mm_allowed, require_freebet_operator_allowed, verify_freebet_for_fill},
      parlay_helpers::{apply_leg_odds, ensure_parlay_odds_product_matches},
   }, instructions::fill_bet::FillBetStake, state::{
      FILL_QUOTE_PARLAY_IX_DISCRIMINATOR, FillParlayIxData, FillParlayQuoteIxData, ParlayLegSel, ParlayLegWire, empty_parlay_leg_buf, other::MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
   }, writers::write_i64_le_unchecked,
};

pub const FILL_PARLAY_IX_DISCRIMINATOR: u8 = 11;

/// CPI `get_quote_parlay` via [`invoke_mm_get_quote_parlay`].
#[inline(never)]
fn invoke_get_quote_parlay(
   num_legs: usize,
   amount: u64,
   min_odds_scaled: u32,
   legs: &[ParlayLegSel],
   user: &AccountView,
   clock_sysvar: &AccountView,
   mm_program_account: &AccountView,
   mm_config_pda: &AccountView,
   mm_parlay_quote_buffer: &AccountView,
   leg_accounts: &[AccountView],
) -> Result<(), ProgramError> {
   if !invoke_mm_get_quote_parlay(
      num_legs,
      amount,
      min_odds_scaled,
      legs,
      user,
      clock_sysvar,
      mm_program_account,
      mm_config_pda,
      mm_parlay_quote_buffer,
      leg_accounts,
   ) {
      #[cfg(feature = "log")]
      log!("fill_parlay: failed to invoke get quote parlay ix");
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(())
}

/// Quote CPI + return parse. Large ix/metas live only in [`invoke_get_quote_parlay`].
#[inline(never)]
fn cpi_get_quote_parlay(
   num_legs: usize,
   amount: u64,
   min_odds_scaled: u32,
   legs: &[ParlayLegSel],
   user: &AccountView,
   clock_sysvar: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   mm_program_account: &AccountView,
   mm_config_pda: &AccountView,
   mm_parlay_quote_buffer: &AccountView,
   mm_encumbrance_pda: &AccountView,
   mm_liability_token_account: &AccountView,
   mm_token_account: &AccountView,
   leg_accounts: &mut [AccountView],
   quoted_legs_out: &mut [ParlayLegWire],
) -> Result<(u64, u32), ProgramError> {
   if !verify_mm_config_pda(mm_config_pda, mm_program_account) {
      #[cfg(feature = "log")]
      log!("fill_parlay: invalid mm config pda");
      return Err(SpammError::MmNotRegistered.into());
   }

   if !verify_parlay_quote_buffer(mm_parlay_quote_buffer, mm_program_account) {
      #[cfg(feature = "log")]
      log!("fill_parlay: invalid parlay quote buffer");
      return Err(ProgramError::InvalidInstructionData);
   }

   if !verify_token_account(false, mm_token_account, mm_config_pda, mint, token_program)? {
      #[cfg(feature = "log")]
      log!("fill_parlay: invalid mm token account");
      return Err(ProgramError::InvalidInstructionData);
   }

   let Some(_encumbrance_pda_bump) = verify_mm_encumbrance_pda(mm_encumbrance_pda, mm_program_account) else {
      #[cfg(feature = "log")]
      log!("fill_parlay: invalid encumbrance pda");
      return Err(ProgramError::InvalidInstructionData);
   };

   if !verify_token_account(false, mm_liability_token_account, mm_encumbrance_pda, mint, token_program)? {
      #[cfg(feature = "log")]
      log!("fill_parlay: invalid mm liability token account");
      return Err(ProgramError::InvalidInstructionData);
   }

   invoke_get_quote_parlay(
      num_legs,
      amount,
      min_odds_scaled,
      legs,
      user,
      clock_sysvar,
      mm_program_account,
      mm_config_pda,
      mm_parlay_quote_buffer,
      leg_accounts,
   )?;

   if unlikely(quoted_legs_out.len() < num_legs) {
      return Err(ProgramError::InvalidInstructionData);
   }
   let mut leg_odds = [0u32; MAX_PARLAY_LEGS];
   let Some((max_amount, odds_scaled, _num)) =
      parse_parlay_quote_return_for_mm(mm_program_account, &mut leg_odds).filter(|(m, _, _)| *m > 0)
   else {
      #[cfg(feature = "log")]
      log!("fill_parlay: empty quote from mm");
      return Err(ProgramError::InvalidInstructionData);
   };
   apply_leg_odds(num_legs, &legs[..num_legs], &leg_odds[..num_legs], quoted_legs_out);
   ensure_parlay_odds_product_matches(num_legs, &quoted_legs_out[..num_legs], odds_scaled)?;

   #[cfg(feature = "log")]
   log!("fill_parlay: max_amount: {}, odds_scaled: {}", max_amount, odds_scaled);

   if odds_scaled < min_odds_scaled {
      #[cfg(feature = "log")]
      log!("fill_parlay: quoted odds below min_odds_scaled");
      return Err(SpammError::SlippageExceeded.into());
   }

   Ok((max_amount, odds_scaled))
}

/// CPI `fill_parlay_quote`, refund check, encumbrance write. Fill ix buffer + metas live only in this frame.
#[inline(never)]
fn cpi_fill_parlay_quote_apply(
   max_amount: u64,
   amount: u64,
   odds_scaled: u32,
   user: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   mm_program_account: &AccountView,
   mm_config_pda: &AccountView,
   mm_parlay_quote_buffer: &AccountView,
   mm_encumbrance_pda: &mut AccountView,
   mm_liability_token_account: &AccountView,
   mm_token_account: &AccountView,
   instructions_sysvar: &AccountView,
) -> Result<(u64, u64), ProgramError> {
   let amount_to_fill = if max_amount > amount { amount } else { max_amount };

   let Ok(mm_liability_account_balance_before) = get_token_account_balance(mm_liability_token_account) else {
      #[cfg(feature = "log")]
      log!("fill_parlay: failed to get mm liability account balance before");
      return Err(ProgramError::InvalidAccountData);
   };

   let Ok(outstanding_liability) = get_encumbrance(mm_encumbrance_pda) else {
      return Err(ProgramError::InvalidAccountData);
   };

   let Ok(gross_margin_u64) = calc_potential_profit(amount_to_fill, odds_scaled) else {
      return Err(ProgramError::InvalidInstructionData);
   };
   let gross_margin_i64: i64 = gross_margin_u64.try_into().map_err(|_| ProgramError::InvalidInstructionData)?;

   let (amount_to_send, new_outstanding_liability) = compute_liability_shortfall(
      mm_liability_account_balance_before,
      outstanding_liability,
      gross_margin_i64,
   )?;

   let fill_ix_data = FillParlayQuoteIxData {
      instruction_discriminator: FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
      amount_to_fill,
      odds_scaled,
      amount_to_send,
   };
   let mut fill_ix_buf = [0u8; FillParlayQuoteIxData::WIRE_LEN];
   let Ok(()) = fill_ix_data.write_wire(&mut fill_ix_buf) else {
      return Err(ProgramError::InvalidInstructionData);
   };

   let fill_quote_ix_account_metas = [
      InstructionAccount::new(user.address(), false, false),
      InstructionAccount::new(mm_config_pda.address(), true, false),
      InstructionAccount::new(mm_parlay_quote_buffer.address(), true, false),
      InstructionAccount::new(mm_token_account.address(), true, false),
      InstructionAccount::new(mm_liability_token_account.address(), true, false),
      InstructionAccount::new(mint.address(), false, false),
      InstructionAccount::new(token_program.address(), false, false),
      InstructionAccount::new(instructions_sysvar.address(), false, false),
   ];
   let fill_quote_invoke_accounts = [
      user.as_ref(),
      mm_config_pda.as_ref(),
      mm_parlay_quote_buffer.as_ref(),
      mm_token_account.as_ref(),
      mm_liability_token_account.as_ref(),
      mint.as_ref(),
      token_program.as_ref(),
      instructions_sysvar.as_ref(),
   ];
   let fill_quote_ix = InstructionView {
      program_id: mm_program_account.address(),
      accounts: &fill_quote_ix_account_metas,
      data: &fill_ix_buf,
   };
   let Ok(()) = invoke(&fill_quote_ix, &fill_quote_invoke_accounts) else {
      return Err(ProgramError::InvalidInstructionData);
   };

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

   let filled_payout = calc_potential_payout(amount_to_fill, odds_scaled)?;

   Ok((amount_to_fill, filled_payout))
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
      rest @ ..,
   ] = accounts else {
      #[cfg(feature = "log")]
      log!("fill_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   decode_and_run_fill_parlay(
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
      rest,
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

/// Owns the fat parlay ix on this frame only. Callers that also hold
/// `FreebetAccountData` must not decode the ix on their own frame.
#[inline(never)]
pub(crate) fn decode_and_run_fill_parlay(
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
   mm_and_legs: &mut [AccountView],
   data: &[u8],
   stake: FillBetStake<'_>,
) -> ProgramResult {
   let parsed = FillParlayIxData::decode(data)?;
   run_fill_parlay(
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
      mm_and_legs,
      parsed,
      stake,
   )
}

#[inline(never)]
pub(crate) fn run_fill_parlay(
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
   mm_and_legs: &mut [AccountView],
   parsed: FillParlayIxData,
   stake: FillBetStake<'_>,
) -> ProgramResult {
   let [
      mm_program_account,
      mm_config_pda,
      mm_parlay_quote_buffer,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
      leg_accounts @ ..,
   ] = mm_and_legs else {
      #[cfg(feature = "log")]
      log!("fill_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(feepayer)?;
   verify_signer(user)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   verify_instructions_sysvar(instructions_sysvar)?;
   verify_clock_sysvar(clock_sysvar)?;
   verify_mint(mint)?;
   verify_token_account(true, stake.token_account, stake.authority, mint, token_program)?;
   verify_config_pda(config_pda, true)?;
   verify_mm_program_executable(mm_program_account)?;
   ensure_pda_unused(bet_pda, "fill_parlay")?;

   let FillParlayIxData {
      bet_id,
      amount,
      min_odds_scaled,
      num_legs: num_legs_u8,
      legs,
   } = parsed;
   let num_legs = num_legs_u8 as usize;

   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   if let Some(fb) = stake.freebet {
      verify_freebet_for_fill(fb, user.address(), amount, num_legs_u8, now)?;
      require_freebet_mm_allowed(fb, mm_program_account.address())?;
      for i in 0..num_legs {
         require_freebet_operator_allowed(fb, &legs[i].market_id.operator)?;
      }
   }

   let expected_leg_accounts = num_legs.saturating_mul(2);
   if leg_accounts.len() != expected_leg_accounts {
      #[cfg(feature = "log")]
      log!("fill_parlay: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   }

   let mut quoted_legs = empty_parlay_leg_buf::<MAX_PARLAY_LEGS>();
   let (max_amount, odds_scaled) = cpi_get_quote_parlay(
      num_legs,
      amount,
      min_odds_scaled,
      &legs[..num_legs],
      user,
      clock_sysvar,
      mint,
      token_program,
      mm_program_account,
      mm_config_pda,
      mm_parlay_quote_buffer,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
      leg_accounts,
      &mut quoted_legs,
   )?;

   if let Some(fb) = stake.freebet {
      if !odds_in_freebet_range(odds_scaled, fb) {
         return Err(SpammError::FreebetOddsOutOfRange.into());
      }
   }

   let (filled_amount, filled_payout) = cpi_fill_parlay_quote_apply(
      max_amount,
      amount,
      odds_scaled,
      user,
      mint,
      token_program,
      mm_program_account,
      mm_config_pda,
      mm_parlay_quote_buffer,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
      instructions_sysvar,
   )?;

   if stake.freebet.is_some() && filled_amount != amount {
      return Err(SpammError::FreebetAmountMismatch.into());
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
      filled_amount,
      filled_payout,
      now,
      stake.freebet_id,
      num_legs,
      &quoted_legs[..num_legs],
      mm_program_account.address(),
      stake.issuer_sign,
      "fill_parlay",
   )?;

   Ok(())
}

