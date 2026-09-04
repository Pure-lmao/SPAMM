//! Signed-quote RFQ fill for a single bet (one MM, no quote buffer).
//!
//! Accounts: **13** fixed + **8** MM (same fixed prefix as [`super::fill_bet`]).
//! **Fixed (13)**
//! 0. `feepayer` (writable signer) — pays netting PDA rent if a fill inserts a new line
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
//! **MM (8)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_event_state_pda` (writable) — verified via `verify_event_state` before MM `fill_bet_rfq` (MM CPI may still ignore it)
//! 3. `mm_market_data_pda` (writable) — verified via `verify_mm_market_data_pda` before MM `fill_bet_rfq` (MM may write on fill)
//! 4. `mm_encumbrance_pda` (writable)
//! 5. `mm_liability_token_account` (writable)
//! 6. `mm_token_account` (writable)
//! 7. `mm_netting_pda` (writable) — real netting PDA, or system program if none

use pinocchio::{
   AccountView, Address, ProgramResult, cpi::invoke,
   error::ProgramError, hint::unlikely,
   instruction::{InstructionAccount, InstructionView},
};
use pinocchio_log::log;

use crate::{
   errors::SpammError, helpers::{
      calc_potential_payout, calc_potential_profit, clock_unix_timestamp_u32, ensure_pda_unused, get_encumbrance, get_token_account_balance, verify_associated_token_program, verify_clock_sysvar, verify_config_pda, verify_event_state, verify_instructions_sysvar, verify_mint, verify_mm_config_pda, verify_mm_encumbrance_pda, verify_mm_market_data_pda, verify_mm_program_executable, verify_netting_pda_or_placeholder, verify_rent_sysvar, verify_signer, verify_system_program, verify_token_account, verify_token_program,
      fill_helpers::{compute_liability_shortfall, create_single_bet_account, require_exact_token_increase},
      freebet_helpers::{odds_in_freebet_range, require_freebet_mm_allowed, require_freebet_operator_allowed, verify_freebet_for_fill},
   }, instructions::fill_bet::FillBetStake, readers::read_address_ref_unchecked, rfq_verify::verify_rfq_ed25519_signature, state::{
      BET_ACCOUNT_DISCRIMINATOR, BetAccountHeader, BetFiller, FILL_BET_RFQ_IX_DISCRIMINATOR, FillRfqBetIxData, FillRfqIxData, MM_CONFIG_PDA_RFQ_SIGNER_OFFSET, account_bet::BetResult, account_netting::{NettingCalc, apply_netting, calculate_netting, ensure_netting_space_for_market}, build_rfq_bet_message, other::MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, rfq_message::RFQ_BET_MESSAGE_LEN,
   }, writers::write_i64_le_unchecked,
};

pub const FILL_RFQ_BET_IX_DISCRIMINATOR: u8 = 12;

#[inline(never)]
fn verify_rfq_bet_ed25519(
   user: &Address,
   mm_program: &Address,
   mm_config_pda: &AccountView,
   parsed: &FillRfqBetIxData,
   signature: &[u8; 64],
) -> Result<(), ProgramError> {
   let rfq_signer = unsafe {
      read_address_ref_unchecked(mm_config_pda.data_ptr(), MM_CONFIG_PDA_RFQ_SIGNER_OFFSET)
   };
   let mut message = [0u8; RFQ_BET_MESSAGE_LEN];
   build_rfq_bet_message(
      &mut message,
      user,
      parsed.bet_id,
      &parsed.market_id,
      &parsed.event_game_state,
      parsed.event_state_sequence,
      parsed.side,
      parsed.max_stake,
      parsed.odds_scaled,
      parsed.offer_expiry,
      mm_program,
   )?;
   verify_rfq_ed25519_signature(rfq_signer, signature, &message)
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
      log!("fill_rfq_bet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   let (parsed, signature) = FillRfqBetIxData::decode_with_signature(data)?;
   run_fill_rfq_bet(
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
      parsed,
      signature,
      FillBetStake {
         token_account: user_ata,
         authority: user,
         issuer_sign: None,
         freebet_id: 0,
         freebet: None,
      },
   )
}

#[inline(never)]
pub(crate) fn run_fill_rfq_bet(
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
   parsed: FillRfqBetIxData,
   signature: [u8; 64],
   stake: FillBetStake<'_>,
) -> ProgramResult {
   let [
      mm_program_account,
      mm_config_pda,
      mm_event_state_pda,
      mm_market_data_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
      mm_netting_pda,
   ] = mm_accounts else {
      log!("fill_rfq_bet: accounts mismatch");
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
   ensure_pda_unused(bet_pda, "fill_rfq_bet")?;

   let bet_id = parsed.bet_id;
   let amount = parsed.amount;
   let market_id = parsed.market_id;
   let side = parsed.side;
   let event_game_state = parsed.event_game_state;
   let event_state_sequence = parsed.event_state_sequence;
   let odds_scaled = parsed.odds_scaled;

   let now = clock_unix_timestamp_u32(clock_sysvar)?;
   if unlikely(now > parsed.offer_expiry) {
      log!("fill_rfq_bet: quote expired");
      return Err(SpammError::QuoteExpired.into());
   }

   verify_mm_program_executable(mm_program_account)?;
   let mm_address = *mm_program_account.address();

   if let Some(fb) = stake.freebet {
      verify_freebet_for_fill(fb, user.address(), amount, 1, now)?;
      require_freebet_mm_allowed(fb, &mm_address)?;
      require_freebet_operator_allowed(fb, &market_id.operator)?;
      if !odds_in_freebet_range(odds_scaled, fb) {
         return Err(SpammError::FreebetOddsOutOfRange.into());
      }
   }

   if unlikely(!verify_mm_config_pda(mm_config_pda, mm_program_account)) {
      log!("fill_rfq_bet: invalid mm config pda");
      return Err(SpammError::MmNotRegistered.into());
   }

   verify_rfq_bet_ed25519(
      user.address(),
      mm_program_account.address(),
      mm_config_pda,
      &parsed,
      &signature,
   )?;

   if unlikely(!verify_mm_market_data_pda(
      mm_market_data_pda, 
      mm_program_account, 
      &market_id.as_bytes()
   )) {
      log!("fill_rfq_bet: invalid market data pda");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(!verify_event_state(
      mm_event_state_pda,
      mm_program_account,
      &market_id.event_id.as_wire_bytes(),
      &event_game_state,
      event_state_sequence,
   )) {
      log!("fill_rfq_bet: invalid event state");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(!verify_token_account(false, mm_token_account, mm_config_pda, mint, token_program)?) {
      log!("fill_rfq_bet: invalid mm token account");
      return Err(ProgramError::InvalidAccountData);
   }

   if verify_mm_encumbrance_pda(mm_encumbrance_pda, mm_program_account).is_none() {
      log!("fill_rfq_bet: invalid encumbrance pda");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(!verify_token_account(
      false,
      mm_liability_token_account,
      mm_encumbrance_pda,
      mint,
      token_program,
   )?) {
      log!("fill_rfq_bet: invalid mm liability token account");
      return Err(ProgramError::InvalidAccountData);
   }

   if unlikely(!verify_netting_pda_or_placeholder(mm_netting_pda, mm_program_account, &market_id.event_id.as_wire_bytes())) {
      log!("fill_rfq_bet: invalid netting pda");
      return Err(ProgramError::InvalidAccountData);
   }

   let Ok(mm_liability_account_balance_before) = get_token_account_balance(mm_liability_token_account) else {
      log!("fill_rfq_bet: failed to read liability balance");
      return Err(ProgramError::InvalidAccountData);
   };

   let Ok(outstanding_liability) = get_encumbrance(mm_encumbrance_pda) else {
      log!("fill_rfq_bet: failed to read encumbrance");
      return Err(ProgramError::InvalidAccountData);
   };

   let netting_calc: Option<NettingCalc> =
      if !mm_netting_pda.is_data_empty() {
         ensure_netting_space_for_market(mm_netting_pda, &market_id, feepayer, rent_sysvar)?;
         calculate_netting(
            mm_netting_pda,
            &market_id,
            side,
            amount,
            odds_scaled,
         )
      } else {
         None
      };
   let is_potentially_netted = netting_calc.is_some();

   let Ok(gross_margin_u64) = calc_potential_profit(amount, odds_scaled) else {
      log!("fill_rfq_bet: failed to calc potential profit");
      return Err(ProgramError::InvalidInstructionData);
   };
   let gross_margin_i64: i64 = gross_margin_u64.try_into().map_err(|_| {
      log!("fill_rfq_bet: gross margin does not fit i64");
      ProgramError::InvalidInstructionData
   })?;

   let delta_i64: i64 = if is_potentially_netted {
      netting_calc.map(|c| c.delta).unwrap_or(0)
   } else {
      gross_margin_i64
   };

   let (amount_to_send, new_outstanding_liability) = compute_liability_shortfall(
      mm_liability_account_balance_before,
      outstanding_liability,
      delta_i64,
   )?;

   let fill_ix_data = FillRfqIxData {
      instruction_discriminator: FILL_BET_RFQ_IX_DISCRIMINATOR,
      amount_to_send,
   };
   let mut fill_ix_buf = [0u8; FillRfqIxData::WIRE_LEN];
   fill_ix_data.write_wire(&mut fill_ix_buf)?;

   let fill_rfq_ix_account_metas = [
      InstructionAccount::new(user.address(), false, false),
      InstructionAccount::new(mm_market_data_pda.address(), true, false),
      InstructionAccount::new(mm_event_state_pda.address(), true, false),
      InstructionAccount::new(mm_config_pda.address(), true, false),
      InstructionAccount::new(mm_token_account.address(), true, false),
      InstructionAccount::new(mm_liability_token_account.address(), true, false),
      InstructionAccount::new(mint.address(), false, false),
      InstructionAccount::new(token_program.address(), false, false),
      InstructionAccount::new(instructions_sysvar.address(), false, false),
   ];
   let fill_rfq_invoke_accounts = [
      user.as_ref(),
      mm_market_data_pda.as_ref(),
      mm_event_state_pda.as_ref(),
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

   if let Some(NettingCalc { write: netting_write, .. }) = netting_calc {
      apply_netting(mm_netting_pda, &netting_write)?;
   }

   unsafe {
      write_i64_le_unchecked(
         mm_encumbrance_pda.data_mut_ptr(),
         MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
         new_outstanding_liability,
      );
   }

   let filled_payout = calc_potential_payout(amount, odds_scaled)?;

   let filler = BetFiller {
      mm_address,
      amount,
      reserved_profit: gross_margin_u64,
      odds_scaled,
      is_potentially_netted,
   };
   let header = BetAccountHeader {
      discriminator: BET_ACCOUNT_DISCRIMINATOR,
      bump: 0,
      owner: *user.address(),
      feepayer: *feepayer.address(),
      bet_id,
      market_id,
      side,
      amount,
      payout: filled_payout,
      timestamp: now,
      freebet_id: stake.freebet_id,
      event_state_sequence,
      event_game_state,
      result: BetResult::Pending,
      num_fillers: 1,
   };
   create_single_bet_account(
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
      &header,
      core::slice::from_ref(&filler),
      stake.issuer_sign,
      "fill_rfq_bet",
   )?;

   Ok(())
}

