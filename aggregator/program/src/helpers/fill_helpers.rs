//! Shared fill / RFQ fill helpers (quote return parse, liability shortfall, parlay bet PDA create).

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq,
   cpi::{ReturnData, Seed, Signer, get_return_data, invoke_with_bounds},
   error::ProgramError, hint::unlikely,
   instruction::{InstructionAccount, InstructionView},
};
use pinocchio_associated_token_account::instructions::Create;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer;

use super::derive_pdas::{find_bet_pda, find_parlay_pda};
use super::freebet_helpers::transfer_stake;
use super::{verify_event_state, verify_mm_market_data_pda};
use crate::{
   ID,
   constants::{MAX_PARLAY_LEGS, MAX_PARLAY_QUOTE_CPI_ACCOUNTS, MAX_RFQ_PARLAY_LEGS},
   errors::SpammError,
   helpers::{get_rent, get_token_account_balance, verify_token_account},
   state::{
      account_bet::BetResult, bet_account_len, other::MM_ENCUMBRANCE_PDA_SEED, parlay_bet_account_len,
      BET_ACCOUNT_SEED, BetAccountData, BetAccountHeader, BetFiller,
      PARLAY_BET_ACCOUNT_DISCRIMINATOR, PARLAY_BET_ACCOUNT_SEED,
      ParlayBetAccountData, ParlayBetAccountHeader, ParlayLegWire,
      write_parlay_leg_sels, GET_QUOTE_PARLAY_IX_DISCRIMINATOR, GET_QUOTE_PARLAY_IX_HEADER_LEN,
      GetQuoteParlayIxData, GetQuoteParlayIxHeaderZc, ParlayLegSel,
      mm_quote::{GetParlayQuoteReturnWire, QuoteData},
   },
};

/// CPI return from `mm_program` after a quote/fill CPI. `None` if missing or wrong owner.
/// Callers use `as_slice()` while this value is in scope (the slice cannot outlive it).
#[inline(always)]
pub fn mm_cpi_return_data(mm_program_account: &AccountView) -> Option<ReturnData> {
   let return_data = get_return_data()?;
   if unlikely(!address_eq(return_data.program_id(), mm_program_account.address())) {
      return None;
   }
   Some(return_data)
}

/// Parse CPI return data from a prior MM `get_quote` when the return program id matches.
#[inline(always)]
pub fn parse_quote_return_for_mm(mm_program_account: &AccountView) -> Option<(u64, u32)> {
   let rd = mm_cpi_return_data(mm_program_account)?;
   let slice = rd.as_slice();
   match QuoteData::read_max_amount_and_odds(slice) {
      Ok(parsed) => Some(parsed),
      Err(_) => {
         #[cfg(feature = "log")]
         log!("fill_helpers: parse_quote_return_for_mm: QuoteData peek failed len {}", slice.len());
         None
      }
   }
}

/// Parse parlay CPI return into `leg_odds_out` (live `num_legs` prefix only).
#[inline(always)]
pub fn parse_parlay_quote_return_for_mm(
   mm_program_account: &AccountView,
   leg_odds_out: &mut [u32],
) -> Option<(u64, u32, u8)> {
   let rd = mm_cpi_return_data(mm_program_account)?;
   GetParlayQuoteReturnWire::decode_into(rd.as_slice(), leg_odds_out).ok()
}

/// Liability ATA vs encumbrance. `delta` is Δpeak (netted) or gross profit (unnetted):
/// it drives both `amount_to_send` and the encumbrance PDA.
#[inline(always)]
pub fn compute_liability_shortfall(
   liability_balance: u64,
   outstanding_liability: i64,
   delta: i64,
) -> Result<(u64, i64), ProgramError> {
   let balance_i64: i64 = liability_balance.try_into().map_err(|_| {
      log!("fill_helpers: liability balance does not fit i64");
      ProgramError::InvalidAccountData
   })?;
   let encumbered_i64: i64 = if outstanding_liability < 0 {
      0
   } else {
      outstanding_liability
   };
   let free_i64: i64 = balance_i64
      .checked_sub(encumbered_i64).ok_or_else(|| {
         log!("fill_helpers: free-liability underflow");
         ProgramError::ArithmeticOverflow
      })?;
   let shortfall_i64: i64 = delta.checked_sub(free_i64).ok_or_else(|| {
      log!("fill_helpers: shortfall overflow");
      ProgramError::ArithmeticOverflow
   })?;
   let amount_to_send: u64 = if shortfall_i64 <= 0 {
      0u64
   } else {
      shortfall_i64.try_into().map_err(|_| {
         log!("fill_helpers: shortfall does not fit u64");
         ProgramError::InvalidInstructionData
      })?
   };
   let new_outstanding: i64 = outstanding_liability
      .checked_add(delta).ok_or_else(|| {
         log!("fill_helpers: outstanding liability overflow");
         ProgramError::InvalidInstructionData
      })?;
   Ok((amount_to_send, new_outstanding))
}

/// Require `dest` token balance increased by exactly `expected` since `before`.
#[inline(always)]
pub fn require_exact_token_increase(
   dest: &AccountView,
   before: u64,
   expected: u64,
) -> ProgramResult {
   let after = get_token_account_balance(dest)?;
   let increase = after.checked_sub(before).ok_or(ProgramError::ArithmeticOverflow)?;
   if unlikely(increase != expected) {
      return Err(SpammError::InsufficientMmLiquidity.into());
   }
   Ok(())
}

/// Auction `fill_bet` refund context when the MM deposit does not match `amount_to_send`.
pub struct AuctionLiabilityRefund<'a> {
   pub mm_encumbrance_pda: &'a mut AccountView,
   pub encumbrance_bump: u8,
   pub mm_address: &'a Address,
   pub mm_liability: &'a AccountView,
   pub mm_token: &'a AccountView,
}

/// After fill CPI: exact liability ATA increase.
///
/// Auction path: returns `false` on mismatch (refunds unexpected deposit when possible).
#[inline(always)]
pub fn try_auction_liability_deposit(
   dest: &AccountView,
   before: u64,
   expected: u64,
   refund: AuctionLiabilityRefund<'_>,
) -> bool {
   if require_exact_token_increase(dest, before, expected).is_ok() {
      return true;
   }
   let Ok(after) = get_token_account_balance(dest) else {
      return false;
   };
   let Some(increase) = after.checked_sub(before) else {
      return false;
   };
   if refund_liability_deposit_mismatch(
      refund.mm_encumbrance_pda,
      refund.encumbrance_bump,
      refund.mm_address,
      refund.mm_liability,
      refund.mm_token,
      increase,
   )
   .is_err()
   {
      log!("fill_helpers: refund after deposit mismatch failed");
   }
   false
}

/// CPI `get_quote_parlay` / `cashout-parlay quote`: invoke using fixed header + 2×leg accounts.
#[inline(never)]
pub fn invoke_parlay_quote_cpi(
   num_legs: usize,
   ix: &InstructionView,
   user: &AccountView,
   clock_sysvar: &AccountView,
   mm_config: &AccountView,
   mm_buf: &AccountView,
   leg_accounts: &[AccountView],
) -> bool {
   let n = 4 + 2 * num_legs;
   if unlikely(
      leg_accounts.len() < 2 * num_legs
         || num_legs < 2
         || n > MAX_PARLAY_QUOTE_CPI_ACCOUNTS,
   ) {
      return false;
   }

   let mut accounts =
      [const { MaybeUninit::<&AccountView>::uninit() }; MAX_PARLAY_QUOTE_CPI_ACCOUNTS];
   accounts[0].write(user);
   accounts[1].write(clock_sysvar);
   accounts[2].write(mm_config);
   accounts[3].write(mm_buf);
   for i in 0..(2 * num_legs) {
      accounts[4 + i].write(&leg_accounts[i]);
   }
   let accounts = unsafe {
      core::slice::from_raw_parts(accounts.as_ptr().cast::<&AccountView>(), n)
   };

   invoke_with_bounds::<MAX_PARLAY_QUOTE_CPI_ACCOUNTS, _>(ix, accounts).is_ok()
}

/// Pack `get_quote_parlay` CPI wire + metas and invoke. Returns false on packing or CPI failure.
#[inline(never)]
pub fn invoke_mm_get_quote_parlay(
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
) -> bool {
   if unlikely(legs.len() < num_legs || num_legs < 2 || num_legs > MAX_PARLAY_LEGS) {
      return false;
   }
   if unlikely(leg_accounts.len() < 2 * num_legs) {
      return false;
   }

   let wire_len = GetQuoteParlayIxData::wire_len(num_legs);
   let mut get_quote_ix_buf = [0u8; GetQuoteParlayIxData::WIRE_LEN];
   {
      let hzc = GetQuoteParlayIxHeaderZc {
         instruction_discriminator: GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
         amount: amount.into(),
         odds_scaled: min_odds_scaled.into(),
         num_legs: num_legs as u8,
      };
      unsafe {
         core::ptr::write(get_quote_ix_buf.as_mut_ptr().cast(), hzc);
      }
      if write_parlay_leg_sels(
         &mut get_quote_ix_buf[GET_QUOTE_PARLAY_IX_HEADER_LEN..wire_len],
         &legs[..num_legs],
      )
      .is_err()
      {
         return false;
      }
   }

   let mut maybe_metas: [MaybeUninit<InstructionAccount>; MAX_PARLAY_QUOTE_CPI_ACCOUNTS] =
      [const { MaybeUninit::uninit() }; MAX_PARLAY_QUOTE_CPI_ACCOUNTS];
   maybe_metas[0].write(InstructionAccount::new(user.address(), false, false));
   maybe_metas[1].write(InstructionAccount::new(clock_sysvar.address(), false, false));
   maybe_metas[2].write(InstructionAccount::new(mm_config_pda.address(), false, false));
   maybe_metas[3].write(InstructionAccount::new(mm_parlay_quote_buffer.address(), true, false));

   for (leg_i, leg_pair) in leg_accounts.chunks_exact(2).enumerate().take(num_legs) {
      let market_data_pda = &leg_pair[0];
      let event_state_pda = &leg_pair[1];
      let md_index = 4 + leg_i * 2;
      let es_index = 5 + leg_i * 2;
      let Some(leg) = legs.get(leg_i) else {
         return false;
      };
      let market_id = &leg.market_id;
      if !verify_mm_market_data_pda(market_data_pda, mm_program_account, &market_id.as_bytes()) {
         return false;
      }
      if !verify_event_state(
         event_state_pda,
         mm_program_account,
         &market_id.event_id.as_wire_bytes(),
         &leg.event_game_state,
         leg.event_state_sequence,
      ) {
         return false;
      }
      maybe_metas[md_index].write(InstructionAccount::new(market_data_pda.address(), false, false));
      maybe_metas[es_index].write(InstructionAccount::new(event_state_pda.address(), false, false));
   }

   let number_of_accounts: usize = 4 + 2 * num_legs;
   let metas_slice: &[InstructionAccount] = unsafe {
      core::slice::from_raw_parts(maybe_metas.as_ptr().cast::<InstructionAccount>(), number_of_accounts)
   };
   let ix = InstructionView {
      program_id: mm_program_account.address(),
      accounts: metas_slice,
      data: &get_quote_ix_buf[..wire_len],
   };

   invoke_parlay_quote_cpi(
      num_legs,
      &ix,
      user,
      clock_sysvar,
      mm_config_pda,
      mm_parlay_quote_buffer,
      leg_accounts,
   )
}

/// Sweep an unexpected liability ATA increase back to the MM token account.
/// Caller already observed `increase != amount_to_send` (multi-MM `fill_bet` soft-continue path).
#[inline(always)]
pub fn refund_liability_deposit_mismatch(
   mm_encumbrance_pda: &mut AccountView,
   encumbrance_bump: u8,
   mm_address: &Address,
   mm_liability_token_account: &AccountView,
   mm_token_account: &AccountView,
   mm_liability_token_account_increase: u64,
) -> ProgramResult {
   let bump_seed = &[encumbrance_bump];
   let enc_seeds = [
      Seed::from(MM_ENCUMBRANCE_PDA_SEED),
      Seed::from(mm_address.as_ref()),
      Seed::from(bump_seed),
   ];
   let signers = [Signer::from(&enc_seeds)];
   Transfer::new(
      mm_liability_token_account,
      mm_token_account,
      mm_encumbrance_pda,
      mm_liability_token_account_increase,
   )
   .invoke_signed(&signers)?;
   #[cfg(feature = "log")]
   log!("fill_helpers: refunded unexpected liability token movement");
   Ok(())
}

/// Create parlay bet PDA + ATA and pull stake from `stake_from` (`user` or issuer ATA).
#[inline(never)]
pub fn create_parlay_bet_account(
   feepayer: &AccountView,
   user: &AccountView,
   stake_from: &AccountView,
   stake_authority: &AccountView,
   bet_pda: &mut AccountView,
   bet_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   bet_id: u64,
   amount: u64,
   payout: u64,
   timestamp: u32,
   freebet_id: u32,
   num_legs: usize,
   legs: &[ParlayLegWire],
   filler_address: &Address,
   issuer_sign: Option<(u8, Address)>,
   log_label: &str,
) -> ProgramResult {
   if unlikely(num_legs < 2 || num_legs > MAX_RFQ_PARLAY_LEGS || legs.len() < num_legs) {
      return Err(ProgramError::InvalidInstructionData);
   }

   let bet_id_bytes = bet_id.to_le_bytes();
   let (expected_bet_pda, bet_bump) = find_parlay_pda(user.address(), bet_id);
   if !address_eq(bet_pda.address(), &expected_bet_pda) {
      log!("{}: bet pda mismatch", log_label);
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

   let header = ParlayBetAccountHeader {
      discriminator: PARLAY_BET_ACCOUNT_DISCRIMINATOR,
      bump: bet_bump,
      owner: *user.address(),
      feepayer: *feepayer.address(),
      bet_id,
      amount,
      payout,
      timestamp,
      freebet_id,
      filler_address: *filler_address,
      result: BetResult::Pending,
      num_legs: num_legs as u8,
   };

   let space = parlay_bet_account_len(num_legs) as u64;
   CreateAccount {
      from: feepayer,
      to: bet_pda,
      lamports: get_rent(rent_sysvar, space)?,
      space,
      owner: &ID,
   }
   .invoke_signed(&bet_pda_signers)?;

   {
      let mut bet_pda_data = bet_pda.try_borrow_mut()?;
      ParlayBetAccountData::write_header_and_legs(&mut bet_pda_data, &header, &legs[..num_legs])?;
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
   transfer_stake(stake_from, bet_ata, stake_authority, amount, issuer_sign)?;
   Ok(())
}

/// Create single-bet PDA + ATA and pull stake from `stake_from`.
#[inline(never)]
pub fn create_single_bet_account(
   feepayer: &AccountView,
   user: &AccountView,
   stake_from: &AccountView,
   stake_authority: &AccountView,
   bet_pda: &mut AccountView,
   bet_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   header: &BetAccountHeader,
   fillers: &[BetFiller],
   issuer_sign: Option<(u8, Address)>,
   log_label: &str,
) -> ProgramResult {
   let n = header.num_fillers as usize;
   if unlikely(n < 1 || fillers.len() < n) {
      return Err(ProgramError::InvalidInstructionData);
   }
   let bet_id_bytes = header.bet_id.to_le_bytes();
   let (expected_bet_pda, bet_bump) = find_bet_pda(user.address(), header.bet_id);
   if !address_eq(bet_pda.address(), &expected_bet_pda) {
      log!("{}: bet pda mismatch", log_label);
      return Err(ProgramError::InvalidSeeds);
   }

   let bet_bump_bytes = [bet_bump];
   let bet_pda_signer_seed = [
      Seed::from(BET_ACCOUNT_SEED),
      Seed::from(user.address().as_ref()),
      Seed::from(&bet_id_bytes),
      Seed::from(&bet_bump_bytes),
   ];
   let bet_pda_signers = [Signer::from(&bet_pda_signer_seed)];
   let space = bet_account_len(n) as u64;
   CreateAccount {
      from: feepayer,
      to: bet_pda,
      lamports: get_rent(rent_sysvar, space)?,
      space,
      owner: &ID,
   }
   .invoke_signed(&bet_pda_signers)?;

   {
      let mut bet_pda_data = bet_pda.try_borrow_mut()?;
      let mut header = *header;
      header.bump = bet_bump;
      BetAccountData::write_header_and_fillers(&mut bet_pda_data, &header, &fillers[..n])?;
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
   transfer_stake(stake_from, bet_ata, stake_authority, header.amount, issuer_sign)?;
   Ok(())
}
