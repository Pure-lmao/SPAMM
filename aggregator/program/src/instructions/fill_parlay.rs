//! Single MM: CPI `get_quote_parlay`, require odds ≥ `min_odds_scaled`, CPI `fill_parlay_quote`, then create parlay bet PDA + ATA.
//!
//! Accounts: **10** fixed, then **6 + 2 × L** for one MM (`L` = `num_legs`).
//! **Fixed (10)**
//! 0. `feepayer` (writable signer)
//! 1. `user` (readonly signer)
//! 2. `user_ata` (writable)
//! 3. `bet_pda` (writable)
//! 4. `bet_ata` (writable)
//! 5. `config_pda` (readonly)
//! 6. `mint` (readonly)
//! 7. `token_program` (readonly)
//! 8. `associated_token_program` (readonly)
//! 9. `system_program` (readonly)
//!
//! **MM (6 + 2 × L)**
//! 0. `mm_program` (readonly)
//! 1. `mm_config_pda` (writable)
//! 2. `mm_parlay_quote_buffer` (writable)
//! 3. `mm_encumbrance_pda` (writable)
//! 4. `mm_liability_token_account` (writable)
//! 5. `mm_token_account` (writable)
//! 6+2*i. `mm_market_data_pda` (writable),
//!    `mm_event_state_pda` (readonly) per leg *i*
//!
//! Data (after router discriminator): [`FillParlayIxData`] — `bet_id`, `amount`, `min_odds_scaled`,
//! `num_legs`, and [`ParlayLegTable`] (`leg_0`..`leg_7` wire as [`ParlayLegWire`](crate::state::ParlayLegWire)).

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{CpiAccount, Seed, Signer, invoke, invoke_unchecked},
   error::ProgramError, hint::unlikely, instruction::{InstructionAccount, InstructionView},
};
use core::mem::MaybeUninit;
use pinocchio_associated_token_account::instructions::Create;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   ID,
   constants::{MAX_PARLAY_LEGS, MAX_PARLAY_QUOTE_CPI_ACCOUNTS},
   helpers::{
      calc_potential_payout, calc_potential_profit, get_rent_local, verify_associated_token_program, verify_config_pda, verify_event_state, verify_mint, verify_mm_config_pda, verify_mm_encumbrance_pda, verify_mm_market_data_pda, verify_parlay_quote_buffer, verify_signer, verify_system_program, verify_token_account, verify_token_program
   },
   instructions::fill_helpers::parse_quote_return_for_mm,
   parsers::{ParsedFillParlay, get_encumbrance, get_token_account_balance, parse_fill_parlay_data},
   state::{
      FILL_QUOTE_PARLAY_IX_DISCRIMINATOR, FillParlayQuoteIxData, GET_QUOTE_PARLAY_IX_DISCRIMINATOR, GetQuoteParlayIxData, PARLAY_BET_ACCOUNT_DISCRIMINATOR, PARLAY_BET_ACCOUNT_LEN, PARLAY_BET_ACCOUNT_SEED, ParlayBetAccountData, ParlayLegTable, ParlayLegWire, account_bet::BetResult, other::MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET
   },
   writers::write_i64_le_unchecked,
};

pub const FILL_PARLAY_IX_DISCRIMINATOR: u8 = 4;

/// Router payload for `fill_parlay` (bytes after the router discriminator in `lib.rs`).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillParlayIxData {
   pub bet_id: u64,
   pub amount: u64,
   pub min_odds_scaled: u32,
   pub num_legs: u8,
   pub legs: ParlayLegTable,
}

pub const FILL_PARLAY_IX_DATA_LEN: usize = <FillParlayIxData as ZeroPodFixed>::SIZE;

impl FillParlayIxData {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != FILL_PARLAY_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data).map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         bet_id: zc.bet_id.get(),
         amount: zc.amount.get(),
         min_odds_scaled: zc.min_odds_scaled.get(),
         num_legs: zc.num_legs,
         legs: ParlayLegTable {
            leg_0: ParlayLegWire::from_zc(&zc.legs.leg_0).ok_or(ProgramError::InvalidInstructionData)?,
            leg_1: ParlayLegWire::from_zc(&zc.legs.leg_1).ok_or(ProgramError::InvalidInstructionData)?,
            leg_2: ParlayLegWire::from_zc(&zc.legs.leg_2).ok_or(ProgramError::InvalidInstructionData)?,
            leg_3: ParlayLegWire::from_zc(&zc.legs.leg_3).ok_or(ProgramError::InvalidInstructionData)?,
            leg_4: ParlayLegWire::from_zc(&zc.legs.leg_4).ok_or(ProgramError::InvalidInstructionData)?,
         },
      })
   }
}

/// Quote CPI + return parse. Large `maybe_metas` / `cpi_accounts` / ix buffer live **only** in this frame.
#[inline(never)]
fn cpi_get_quote_parlay(
   num_legs: usize,
   amount: u64,
   min_odds_scaled: u32,
   legs: ParlayLegTable,
   user: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   mm_program_account: &AccountView,
   mm_config_pda: &AccountView,
   mm_parlay_quote_buffer: &AccountView,
   mm_encumbrance_pda: &AccountView,
   mm_liability_token_account: &AccountView,
   mm_token_account: &AccountView,
   leg_accounts: &mut [AccountView],
) -> Result<(u64, u32, Address), ProgramError> {
   if !verify_mm_config_pda(mm_config_pda, mm_program_account) {
      #[cfg(feature = "log")]
      log!("fill_parlay: invalid mm config pda");
      return Err(ProgramError::InvalidInstructionData);
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

   let get_quote_ix_data = GetQuoteParlayIxData {
      instruction_discriminator: GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
      amount,
      odds_scaled: min_odds_scaled,
      num_legs: num_legs as u8,
      legs,
   };

   let mut get_quote_ix_buf = [0u8; GetQuoteParlayIxData::WIRE_LEN];
   let Ok(()) = get_quote_ix_data.write_wire(&mut get_quote_ix_buf) else {
      #[cfg(feature = "log")]
      log!("fill_parlay: invalid get quote parlay ix data");
      return Err(ProgramError::InvalidInstructionData);
   };

   let mut maybe_metas: [MaybeUninit<InstructionAccount>; MAX_PARLAY_QUOTE_CPI_ACCOUNTS] = unsafe {
      MaybeUninit::uninit().assume_init()
   };
   let mut cpi_accounts: [MaybeUninit<CpiAccount>; MAX_PARLAY_QUOTE_CPI_ACCOUNTS] = unsafe {
      MaybeUninit::uninit().assume_init()
   };
   maybe_metas[0].write(InstructionAccount::new(user.address(), false, false));
   CpiAccount::init_from_account_view(user, &mut cpi_accounts[0]);
   maybe_metas[1].write(InstructionAccount::new(mm_config_pda.address(), false, false));
   CpiAccount::init_from_account_view(mm_config_pda, &mut cpi_accounts[1]);
   maybe_metas[2].write(InstructionAccount::new(mm_parlay_quote_buffer.address(), true, false));
   CpiAccount::init_from_account_view(mm_parlay_quote_buffer, &mut cpi_accounts[2]);

   for (leg_i, leg_pair) in leg_accounts.chunks_exact_mut(2).enumerate().take(num_legs) {
      let market_data_pda = &leg_pair[0];
      let event_state_pda = &leg_pair[1];
      let md_index = 3 + leg_i * 2;
      let es_index = 4 + leg_i * 2;
      let Some(leg) = legs.get(leg_i) else {
         return Err(ProgramError::InvalidInstructionData);
      };
      let market_id = &leg.market_id;
      if !verify_mm_market_data_pda(market_data_pda, mm_program_account, market_id) {
         #[cfg(feature = "log")]
         log!("fill_parlay: invalid market data pda");
         return Err(ProgramError::InvalidInstructionData);
      }
      if !verify_event_state(
         event_state_pda,
         mm_program_account,
         &market_id.event_id,
         &leg.event_state_hash,
         &leg.event_state_sequence,
      ) {
         #[cfg(feature = "log")]
         log!("fill_parlay: invalid event state");
         return Err(ProgramError::InvalidInstructionData);
      }

      maybe_metas[md_index].write(InstructionAccount::new(market_data_pda.address(), false, false));
      CpiAccount::init_from_account_view(market_data_pda, &mut cpi_accounts[md_index]);
      maybe_metas[es_index].write(InstructionAccount::new(event_state_pda.address(), false, false));
      CpiAccount::init_from_account_view(event_state_pda, &mut cpi_accounts[es_index]);
   }

   let number_of_accounts: usize = 3 + 2 * num_legs;
   let metas_slice: &[InstructionAccount] = unsafe {
      core::slice::from_raw_parts(maybe_metas.as_ptr().cast::<InstructionAccount>(), number_of_accounts)
   };

   let ix = InstructionView {
      program_id: mm_program_account.address(),
      accounts: metas_slice,
      data: &get_quote_ix_buf,
   };
   let cpi_slice =
      unsafe { core::slice::from_raw_parts(cpi_accounts.as_ptr() as *const CpiAccount, number_of_accounts) };

   unsafe { invoke_unchecked(&ix, cpi_slice) };

   let mut max_amount = 0u64;
   let mut odds_scaled = 0u32;
   if let Some(parsed_ret) = parse_quote_return_for_mm(mm_program_account) {
      (max_amount, odds_scaled) = parsed_ret;
   }

   #[cfg(feature = "log")]
   log!("fill_parlay: max_amount: {}, odds_scaled: {}", max_amount, odds_scaled);

   if max_amount == 0 && odds_scaled == 0 {
      #[cfg(feature = "log")]
      log!("fill_parlay: empty quote from mm");
      return Err(ProgramError::InvalidInstructionData);
   }
   if odds_scaled < min_odds_scaled {
      #[cfg(feature = "log")]
      log!("fill_parlay: quoted odds below min_odds_scaled");
      return Err(ProgramError::InvalidInstructionData);
   }

   Ok((max_amount, odds_scaled, *mm_program_account.address()))
}

/// CPI `fill_parlay_quote`, refund check, encumbrance write. Fill ix buffer + metas live only in this frame.
#[inline(never)]
fn cpi_fill_parlay_quote_apply(
   max_amount: u64,
   amount: u64,
   odds_scaled: u32,
   mm_address: Address,
   user: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   mm_program_account: &AccountView,
   mm_config_pda: &AccountView,
   mm_parlay_quote_buffer: &AccountView,
   mm_encumbrance_pda: &mut AccountView,
   mm_liability_token_account: &AccountView,
   mm_token_account: &AccountView,
) -> Result<(u64, u64), ProgramError> {
   if unlikely(!address_eq(mm_program_account.address(), &mm_address)) {
      return Err(ProgramError::InvalidAccountData);
   }
   let amount_to_fill = if max_amount > amount { amount } else { max_amount };
   if unlikely(amount_to_fill == 0) {
      log!("fill_parlay: amount_to_fill is zero");
      return Err(ProgramError::InvalidInstructionData);
   }

   let Ok(mm_liability_account_balance_before) = get_token_account_balance(mm_liability_token_account) else {
      #[cfg(feature = "log")]
      log!("fill_parlay: failed to get mm liability account balance before");
      return Err(ProgramError::InvalidAccountData);
   };
   let Ok(mm_liability_account_balance_i64): Result<i64, _> = mm_liability_account_balance_before.try_into() else {
      return Err(ProgramError::InvalidAccountData);
   };

   let Ok(outstanding_liability) = get_encumbrance(mm_encumbrance_pda) else {
      return Err(ProgramError::InvalidAccountData);
   };

   let Ok(gross_margin_u64) = calc_potential_profit(amount_to_fill, odds_scaled) else {
      return Err(ProgramError::InvalidInstructionData);
   };
   let gross_margin_i64: i64 = gross_margin_u64.try_into().map_err(|_| ProgramError::InvalidInstructionData)?;

   let encumbered_i64: i64 = if outstanding_liability < 0 {
      0
   } else {
      outstanding_liability
   };
   let free_i64: i64 = mm_liability_account_balance_i64.saturating_sub(encumbered_i64);
   let shortfall_i64: i64 = gross_margin_i64.saturating_sub(free_i64);
   let amount_to_send: u64 = if shortfall_i64 <= 0 {
      0u64
   } else {
      shortfall_i64.try_into().map_err(|_| ProgramError::InvalidInstructionData)?
   };

   let new_outstanding_liability: i64 = outstanding_liability
      .checked_add(gross_margin_i64)
      .ok_or(ProgramError::InvalidInstructionData)?;

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
   ];
   let fill_quote_invoke_accounts = [
      user.as_ref(),
      mm_config_pda.as_ref(),
      mm_parlay_quote_buffer.as_ref(),
      mm_token_account.as_ref(),
      mm_liability_token_account.as_ref(),
      mint.as_ref(),
      token_program.as_ref(),
   ];
   let fill_quote_ix = InstructionView {
      program_id: &mm_address,
      accounts: &fill_quote_ix_account_metas,
      data: &fill_ix_buf,
   };
   let Ok(()) = invoke(&fill_quote_ix, &fill_quote_invoke_accounts) else {
      return Err(ProgramError::InvalidInstructionData);
   };

   let Ok(mm_liability_account_balance_after) = get_token_account_balance(mm_liability_token_account) else {
      return Err(ProgramError::InvalidAccountData);
   };
   let Some(mm_liability_token_account_increase) =
      mm_liability_account_balance_after.checked_sub(mm_liability_account_balance_before)
   else {
      return Err(ProgramError::InvalidInstructionData);
   };

   if unlikely(mm_liability_token_account_increase != amount_to_send) {
      log!("fill_parlay: refund liability deposit mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }

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
fn finalize_parlay_bet(
   feepayer: &mut AccountView,
   user: &AccountView,
   user_ata: &mut AccountView,
   bet_pda: &mut AccountView,
   bet_ata: &mut AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   system_program: &AccountView,
   bet_id: u64,
   bet_id_bytes: [u8; 8],
   filled_amount: u64,
   filled_payout: u64,
   num_legs: usize,
   legs: ParlayLegTable,
   filler_address: Address,
) -> ProgramResult {
   let bet_pda_seed = [PARLAY_BET_ACCOUNT_SEED, user.address().as_ref(), bet_id_bytes.as_slice()];

   let (expected_bet_pda, bet_bump) = Address::find_program_address(&bet_pda_seed, &ID);
   if !address_eq(bet_pda.address(), &expected_bet_pda) {
      log!("fill_parlay: bet pda mismatch");
      return Err(ProgramError::InvalidSeeds);
   }

   let bet_bump_bytes = [bet_bump];
   let bet_pda_signer_seed = [
      Seed::from(PARLAY_BET_ACCOUNT_SEED),
      Seed::from(user.address().as_ref()),
      Seed::from(&bet_id_bytes),
      Seed::from(&bet_bump_bytes),
   ];
   let bet_pda_signers = [Signer::from(&bet_pda_signer_seed)];

   let bet_account_data = ParlayBetAccountData {
      discriminator: PARLAY_BET_ACCOUNT_DISCRIMINATOR,
      bump: bet_bump,
      owner: *user.address(),
      feepayer: *feepayer.address(),
      bet_id,
      amount: filled_amount,
      payout: filled_payout,
      filler_address,
      result: BetResult::Pending,
      num_legs: num_legs as u8,
      legs,
   };

   let lamports = get_rent_local(PARLAY_BET_ACCOUNT_LEN);
   CreateAccount {
      from: feepayer,
      to: bet_pda,
      lamports,
      space: PARLAY_BET_ACCOUNT_LEN,
      owner: &ID,
   }
   .invoke_signed(&bet_pda_signers)?;

   {
      let mut bet_pda_data = bet_pda.try_borrow_mut()?;
      bet_account_data.write_to_account(&mut bet_pda_data)?;
   }

   Create {
      funding_account: feepayer,
      account: bet_ata,
      wallet: bet_pda,
      mint,
      system_program,
      token_program,
   }
   .invoke()?;

   verify_token_account(true, bet_ata, bet_pda, mint, token_program)?;
   Transfer::new(user_ata, bet_ata, user, filled_amount).invoke()?;

   Ok(())
}

#[inline(never)]
pub fn fill_parlay(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
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
      system_program,
      mm_program_account,
      mm_config_pda,
      mm_parlay_quote_buffer,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
      leg_accounts @ ..,
   ] = accounts else {
      #[cfg(feature = "log")]
      log!("fill_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(feepayer)?;
   verify_signer(user)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;
   verify_system_program(system_program)?;
   verify_mint(mint)?;
   verify_token_account(true, user_ata, user, mint, token_program)?;
   verify_config_pda(config_pda, true)?;

   let ParsedFillParlay {
      bet_id,
      amount,
      min_odds_scaled,
      num_legs: num_legs_u8,
      legs,
   } = parse_fill_parlay_data(data)?;
   let num_legs = num_legs_u8 as usize;
   if num_legs > MAX_PARLAY_LEGS {
      #[cfg(feature = "log")]
      log!("fill_parlay: num legs must be less than or equal to MAX_PARLAY_LEGS");
      return Err(ProgramError::InvalidInstructionData);
   }

   let expected_leg_accounts = num_legs.saturating_mul(2);
   if leg_accounts.len() != expected_leg_accounts {
      #[cfg(feature = "log")]
      log!("fill_parlay: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   }

   let bet_id_bytes = bet_id.to_le_bytes();

   let (max_amount, odds_scaled, mm_address) = cpi_get_quote_parlay(
      num_legs,
      amount,
      min_odds_scaled,
      legs,
      user,
      mint,
      token_program,
      mm_program_account,
      mm_config_pda,
      mm_parlay_quote_buffer,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
      leg_accounts,
   )?;

   let (filled_amount, filled_payout) = cpi_fill_parlay_quote_apply(
      max_amount,
      amount,
      odds_scaled,
      mm_address,
      user,
      mint,
      token_program,
      mm_program_account,
      mm_config_pda,
      mm_parlay_quote_buffer,
      mm_encumbrance_pda,
      mm_liability_token_account,
      mm_token_account,
   )?;

   finalize_parlay_bet(
      feepayer,
      user,
      user_ata,
      bet_pda,
      bet_ata,
      mint,
      token_program,
      system_program,
      bet_id,
      bet_id_bytes,
      filled_amount,
      filled_payout,
      num_legs,
      legs,
      mm_address,
   )
}
