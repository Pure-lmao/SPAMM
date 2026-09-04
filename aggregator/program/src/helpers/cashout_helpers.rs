//! Shared cashout fill / claim / revert helpers.

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, Address, ProgramResult,
   address::address_eq,
   cpi::{Seed, Signer},
   error::ProgramError,
   hint::unlikely,
};
use pinocchio_associated_token_account::instructions::Create;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer;

use super::account_verify::verify_parlay_pda;
use super::derive_pdas::{
   find_cashout_escrow_pda, find_cashout_parlay_pda, find_cashout_pda,
};
use super::fill_helpers::{mm_cpi_return_data, require_exact_token_increase};
use super::freebet_helpers::require_not_freebet;
use crate::{
   ID,
   constants::{MAX_NUMBER_OF_MMS, MAX_RFQ_PARLAY_LEGS},
   errors::SpammError,
   helpers::{
      calc_potential_payout, calc_potential_profit, close_pda_return_rent, ensure_pda_unused,
      get_encumbrance, get_rent, get_token_account_balance, safe_close_ata,
      verify_associated_token_program, verify_clock_sysvar, verify_config_pda, verify_event_state,
      verify_instructions_sysvar, verify_mint, verify_mm_encumbrance_pda, verify_mm_market_data_pda,
      verify_rent_sysvar, verify_signer, verify_system_program, verify_token_account,
      verify_token_program,
   },
   readers::read_u64_le_unchecked,
   state::{
      account_bet::{
         bet_account_len, BetAccountHeader, BetFiller, BetResult, BET_ACCOUNT_HEADER_LEN,
         BET_ACCOUNT_SEED, BET_AMOUNT_OFFSET, BET_FILLER_LEN, BET_PAYOUT_OFFSET, BET_RESULT_OFFSET,
      },
      account_parlay_bet::{
         ParlayBetAccountData, PARLAY_BET_ACCOUNT_SEED, PARLAY_BET_AMOUNT_OFFSET,
         PARLAY_BET_HEADER_LEN, PARLAY_BET_PAYOUT_OFFSET, PARLAY_BET_RESULT_OFFSET,
      },
      cashout_account_len, cashout_parlay_account_len,
      other::{EventGameState, MM_ENCUMBRANCE_PDA_SEED},
      CASHOUT_ACCOUNT_DISCRIMINATOR, CASHOUT_ACCOUNT_SEED, CASHOUT_ESCROW_LEN,
      CASHOUT_ESCROW_SEED, CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR, CASHOUT_PARLAY_ACCOUNT_SEED,
      CashoutAccountData, CashoutAccountHeader, CashoutEscrow, CashoutParlayAccountData,
      CashoutParlayHeader, CashoutParlayLeg, CashoutQuoteReturn,
      ix_fill_parlay_cashout::CashoutSnapshot,
   },
   writers::{write_u64_le_unchecked, write_u8_unchecked},
};

#[inline(always)]
pub fn parse_cashout_quote_return_for_mm(mm_program_account: &AccountView) -> Option<u64> {
   let rd = mm_cpi_return_data(mm_program_account)?;
   CashoutQuoteReturn::read_max_payment(rd.as_slice())
}

/// Live delay when the original market was not pregame, or either sequence is live (`>= 2`).
#[inline(always)]
pub fn cashout_requires_delay(is_pregame: bool, orig_sequence: u16, quoted_sequence: u16) -> bool {
   !is_pregame || orig_sequence >= 2 || quoted_sequence >= 2
}

/// Quoted event-state sequence must not be older than the ticket (or leg) sequence.
#[inline(always)]
pub fn require_cashout_sequence_at_least(quoted: u16, orig: u16) -> ProgramResult {
   if unlikely(quoted < orig) {
      log!("cashout: quoted event_state_sequence must be >= ticket sequence");
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(())
}

/// Refuse settle while a cashout escrow PDA for this ticket exists (FIRM / no-races).
/// Accepts an unused system-owned account.
pub fn require_no_live_cashout_escrow(
   escrow_pda: &AccountView,
   owner: &Address,
   bet_id: u64,
) -> ProgramResult {
   let (expected, _) = find_cashout_escrow_pda(owner, bet_id);
   if unlikely(!address_eq(escrow_pda.address(), &expected)) {
      log!("require_no_live_cashout_escrow: pda mismatch");
      return Err(ProgramError::InvalidSeeds);
   }
   if unlikely(address_eq(escrow_pda.owner(), &ID) || escrow_pda.data_len() > 0) {
      log!("require_no_live_cashout_escrow: live cashout escrow exists");
      return Err(SpammError::InvalidCashout.into());
   }
   Ok(())
}

/// Split `reserved_profit` so remaining + cashed always equal the original reservation.
/// Token payouts may still floor independently (1 atom unfair is accepted).
fn split_reserved_profit(
   reserved: u64,
   cashed_i: u64,
   remain_i: u64,
   odds_scaled: u32,
) -> Result<(u64, u64), ProgramError> {
   if remain_i == 0 {
      return Ok((reserved, 0));
   }
   if cashed_i == 0 {
      return Ok((0, reserved));
   }
   let cashed_p = calc_potential_profit(cashed_i, odds_scaled)?;
   let cashed_p = core::cmp::min(cashed_p, reserved);
   let remain_p = reserved
      .checked_sub(cashed_p).ok_or(ProgramError::ArithmeticOverflow)?;
   Ok((cashed_p, remain_p))
}

/// Split original fillers into remaining vs cashed slices.
///
/// Non-last slots take `floor(orig_i × C / A)`. The last slot takes the remainder so
/// cashed amounts sum to `C`. If that remainder exceeds the last filler's stake,
/// extra is walked backward onto earlier fillers' unused capacity.
/// `reserved_profit` is split so remaining + cashed always sum to the original.
pub fn split_fillers(
   orig: &[BetFiller],
   num: usize,
   orig_amount: u64,
   cashout_amount: u64,
   remaining: &mut [MaybeUninit<BetFiller>],
   cashed: &mut [MaybeUninit<BetFiller>],
) -> Result<u64, ProgramError> {
   if unlikely(num < 1 || num > MAX_NUMBER_OF_MMS || orig.len() < num || remaining.len() < num || cashed.len() < num) {
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(orig_amount == 0 || cashout_amount == 0 || cashout_amount > orig_amount) {
      return Err(SpammError::InvalidCashout.into());
   }
   let mut cashed_amt = [0u64; MAX_NUMBER_OF_MMS];
   let mut cashed_assigned = 0u64;
   for i in 0..num {
      let f = orig[i];
      let cashed_i = if i + 1 == num {
         cashout_amount
            .checked_sub(cashed_assigned).ok_or(ProgramError::ArithmeticOverflow)?
      } else {
         (f.amount as u128)
            .checked_mul(cashout_amount as u128).ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(orig_amount as u128).ok_or(ProgramError::ArithmeticOverflow)? as u64
      };
      cashed_amt[i] = cashed_i;
      cashed_assigned = cashed_assigned
         .checked_add(cashed_i).ok_or(ProgramError::ArithmeticOverflow)?;
   }
   let last = num - 1;
   if cashed_amt[last] > orig[last].amount {
      let mut overflow = cashed_amt[last]
         .checked_sub(orig[last].amount).ok_or(ProgramError::ArithmeticOverflow)?;
      cashed_amt[last] = orig[last].amount;
      let mut i = last;
      while overflow > 0 {
         if i == 0 {
            log!("split_fillers: cannot redistribute last-slot remainder");
            return Err(SpammError::InvalidCashout.into());
         }
         i -= 1;
         let cap = orig[i].amount.saturating_sub(cashed_amt[i]);
         let take = core::cmp::min(overflow, cap);
         cashed_amt[i] = cashed_amt[i]
            .checked_add(take).ok_or(ProgramError::ArithmeticOverflow)?;
         overflow -= take;
      }
   }
   let mut remain_assigned = 0u64;
   let mut payout_removed = 0u64;
   for i in 0..num {
      let f = orig[i];
      let cashed_i = cashed_amt[i];
      let remain_i = f.amount.checked_sub(cashed_i).ok_or_else(|| {
         log!("split_fillers: cashed slice exceeds filler stake");
         SpammError::InvalidCashout
      })?;
      let (cashed_p, remain_p) = split_reserved_profit(
         f.reserved_profit,
         cashed_i,
         remain_i,
         f.odds_scaled,
      )?;
      remaining[i].write(BetFiller {
         mm_address: f.mm_address,
         amount: remain_i,
         reserved_profit: remain_p,
         odds_scaled: f.odds_scaled,
         is_potentially_netted: f.is_potentially_netted,
      });
      cashed[i].write(BetFiller {
         mm_address: f.mm_address,
         amount: cashed_i,
         reserved_profit: cashed_p,
         odds_scaled: f.odds_scaled,
         is_potentially_netted: f.is_potentially_netted,
      });
      remain_assigned = remain_assigned
         .checked_add(remain_i).ok_or(ProgramError::ArithmeticOverflow)?;
      if cashed_i > 0 {
         payout_removed = payout_removed
            .checked_add(calc_potential_payout(cashed_i, f.odds_scaled)?).ok_or(ProgramError::ArithmeticOverflow)?;
      }
   }
   if unlikely(cashed_assigned != cashout_amount) {
      log!("split_fillers: cashed sum != cashout amount");
      return Err(SpammError::InvalidCashout.into());
   }
   let remain_header = orig_amount
      .checked_sub(cashout_amount).ok_or(ProgramError::ArithmeticOverflow)?;
   if unlikely(remain_assigned != remain_header) {
      log!("split_fillers: remaining filler sum != remaining header amount");
      return Err(SpammError::InvalidCashout.into());
   }
   Ok(payout_removed)
}

/// Shared account checks for the four cashout-fill instructions.
pub fn verify_cashout_fill_preamble(
   feepayer: &AccountView,
   user: &AccountView,
   user_ata: &AccountView,
   cashout_pda: &AccountView,
   config_pda: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   associated_token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   instructions_sysvar: &AccountView,
   clock_sysvar: &AccountView,
   label: &str,
) -> ProgramResult {
   verify_signer(feepayer)?;
   verify_signer(user)?;
   verify_token_program(token_program)?;
   verify_associated_token_program(associated_token_program)?;
   verify_rent_sysvar(rent_sysvar)?;
   verify_system_program(system_program)?;
   verify_instructions_sysvar(instructions_sysvar)?;
   verify_clock_sysvar(clock_sysvar)?;
   verify_mint(mint)?;
   verify_token_account(true, user_ata, user, mint, token_program)?;
   verify_config_pda(config_pda, true)?;
   ensure_pda_unused(cashout_pda, label)?;
   Ok(())
}

/// Create the live cashout escrow PDA when delay is required; no-op otherwise.
pub fn maybe_open_live_cashout_escrow(
   delay: bool,
   feepayer: &AccountView,
   user: &AccountView,
   escrow_pda: &mut AccountView,
   escrow_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   orig_bet_id: u64,
   cashout_id: u64,
   timestamp: u32,
   amount: u64,
   payout_removed: u64,
   payment: u64,
   market_maker: Address,
   is_parlay: bool,
) -> ProgramResult {
   if !delay {
      return Ok(());
   }
   let escrow = CashoutEscrow {
      discriminator: crate::state::CASHOUT_ESCROW_DISCRIMINATOR,
      bump: 0,
      owner: *user.address(),
      feepayer: *feepayer.address(),
      orig_bet_id,
      cashout_id,
      timestamp,
      amount,
      payout_removed,
      payment,
      market_maker,
      is_parlay,
   };
   create_cashout_escrow(
      feepayer,
      user.address(),
      escrow_pda,
      escrow_ata,
      mint,
      token_program,
      rent_sysvar,
      system_program,
      &escrow,
   )
}

#[inline(always)]
pub fn cashout_payment_dest<'a>(
   delay: bool,
   escrow_ata: &'a AccountView,
   user_ata: &'a AccountView,
) -> &'a AccountView {
   if delay { escrow_ata } else { user_ata }
}

#[inline(always)]
pub fn proportional_payout(orig_amount: u64, orig_payout: u64, cashout_amount: u64) -> Result<u64, ProgramError> {
   if unlikely(orig_amount == 0) {
      return Err(SpammError::InvalidCashout.into());
   }
   (orig_payout as u128)
      .checked_mul(cashout_amount as u128).ok_or(ProgramError::ArithmeticOverflow)?
      .checked_div(orig_amount as u128).ok_or(ProgramError::ArithmeticOverflow)?
      .try_into()
      .map_err(|_| ProgramError::ArithmeticOverflow)
}

#[inline(always)]
pub fn validate_cashout_size(
   orig_amount: u64,
   cashout_amount: u64,
) -> Result<(), ProgramError> {
   if unlikely(cashout_amount == 0 || cashout_amount > orig_amount) {
      return Err(SpammError::InvalidCashout.into());
   }
   Ok(())
}

/// Original parlay ticket state validated for cashout (auction or RFQ).
pub struct ParlayCashoutOrigTicket {
   pub payout_removed: u64,
   pub delay: bool,
   pub orig_amount: u64,
   pub orig_payout: u64,
   pub orig_bet_id: u64,
   pub orig_bump: u8,
   pub orig_feepayer: Address,
   pub orig_filler: Address,
   pub legs: [CashoutParlayLeg; MAX_RFQ_PARLAY_LEGS],
}

/// Shared original parlay ticket validation for auction and RFQ parlay cashout.
/// When `leg_pda_check` is `Some`, verifies per-leg MM market/event PDAs (auction path).
///
/// Writes into `out` — do not return [`ParlayCashoutOrigTicket`] by value (~3944B; return slot
/// doubles past the 4096-byte SBF frame).
#[inline(never)]
pub fn validate_parlay_cashout_orig_ticket(
   user: &AccountView,
   bet_pda: &AccountView,
   bet_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   orig_bet_id: u64,
   cashout_amount: u64,
   num_legs: u8,
   snapshots: &[CashoutSnapshot],
   leg_pda_check: Option<(&AccountView, &[AccountView])>,
   out: &mut ParlayCashoutOrigTicket,
) -> Result<(), ProgramError> {
   let n = num_legs as usize;
   let raw = bet_pda.try_borrow()?;
   let header = ParlayBetAccountData::decode_header(raw.as_ref())?;
   require_not_freebet(header.freebet_id)?;
   if unlikely(!address_eq(&header.owner, user.address()) || header.bet_id != orig_bet_id) {
      return Err(ProgramError::InvalidInstructionData);
   }
   verify_parlay_pda(
      bet_pda,
      user.address(),
      header.bet_id,
      header.bump,
   )?;
   if header.result != BetResult::Pending || header.num_legs != num_legs {
      return Err(SpammError::InvalidCashout.into());
   }
   validate_cashout_size(header.amount, cashout_amount)?;
   verify_token_account(true, bet_ata, bet_pda, mint, token_program)?;

   out.payout_removed = 0;
   out.delay = false;
   out.orig_amount = header.amount;
   out.orig_payout = header.payout;
   out.orig_bet_id = header.bet_id;
   out.orig_bump = header.bump;
   out.orig_feepayer = header.feepayer;
   out.orig_filler = header.filler_address;
   unsafe {
      core::ptr::write_bytes(out.legs.as_mut_ptr(), 0, MAX_RFQ_PARLAY_LEGS);
   }
   for i in 0..n {
      let leg = ParlayBetAccountData::decode_leg(raw.as_ref(), i)?;
      if leg.result != BetResult::Pending {
         return Err(SpammError::InvalidCashout.into());
      }
      if let Some((mm_program, leg_accounts)) = leg_pda_check {
         if !verify_mm_market_data_pda(&leg_accounts[2 * i], mm_program, &leg.market_id.as_bytes()) {
            return Err(ProgramError::InvalidAccountData);
         }
         if !verify_event_state(
            &leg_accounts[2 * i + 1],
            mm_program,
            &leg.market_id.event_id.as_wire_bytes(),
            &snapshots[i].event_game_state,
            snapshots[i].event_state_sequence,
         ) {
            return Err(ProgramError::InvalidAccountData);
         }
      }
      require_cashout_sequence_at_least(snapshots[i].event_state_sequence, leg.event_state_sequence)?;
      if cashout_requires_delay(
         leg.market_id.is_pregame(),
         leg.event_state_sequence,
         snapshots[i].event_state_sequence,
      ) {
         out.delay = true;
      }
      out.legs[i] = CashoutParlayLeg {
         market_id: leg.market_id,
         side: leg.side,
         orig_event_state_sequence: leg.event_state_sequence,
         orig_event_game_state: leg.event_game_state,
         cashout_event_state_sequence: snapshots[i].event_state_sequence,
         cashout_event_game_state: snapshots[i].event_game_state,
         odds_scaled: leg.odds_scaled,
         result: BetResult::Pending,
      };
   }
   drop(raw);

   out.payout_removed = proportional_payout(header.amount, header.payout, cashout_amount)?;
   Ok(())
}

/// Accept a cashout quote only when it sits in `(0, payout_removed]` and meets `min_payout`.
#[inline(always)]
pub fn accept_cashout_payment(max_payment: u64, min_payout: u64, payout_removed: u64) -> bool {
   max_payment > 0 && max_payment >= min_payout && max_payment <= payout_removed
}

#[inline(always)]
pub fn verify_ticket_feepayer(ticket_feepayer: &AccountView, stored: &Address) -> ProgramResult {
   if unlikely(!address_eq(ticket_feepayer.address(), stored)) {
      log!("ticket_feepayer must match the original ticket feepayer");
      return Err(ProgramError::InvalidInstructionData);
   }
   Ok(())
}

/// `find_cashout_pda` once (new PDA, no stored bump). Cashout bump is this find, not the original ticket bump.
pub fn create_cashout_account(
   feepayer: &AccountView,
   filling_mm: &Address,
   cashout_pda: &mut AccountView,
   cashout_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   header: &CashoutAccountHeader,
   fillers: &[BetFiller],
) -> ProgramResult {
   let cashout_id_bytes = header.cashout_id.to_le_bytes();
   let (expected, bump) = find_cashout_pda(filling_mm, header.cashout_id);
   if !address_eq(cashout_pda.address(), &expected) {
      log!("create_cashout_account: pda mismatch");
      return Err(ProgramError::InvalidSeeds);
   }
   let bump_bytes = [bump];
   let signer_seed = [
      Seed::from(CASHOUT_ACCOUNT_SEED),
      Seed::from(filling_mm.as_ref()),
      Seed::from(&cashout_id_bytes),
      Seed::from(&bump_bytes),
   ];
   let signers = [Signer::from(&signer_seed)];
   let n = header.num_fillers as usize;
   let space = cashout_account_len(n) as u64;
   CreateAccount {
      from: feepayer,
      to: cashout_pda,
      lamports: get_rent(rent_sysvar, space)?,
      space,
      owner: &ID,
   }
   .invoke_signed(&signers)?;
   {
      let mut data = cashout_pda.try_borrow_mut()?;
      let mut header = *header;
      header.bump = bump;
      CashoutAccountData::write_header_and_fillers(&mut data, &header, fillers)?;
   }
   Create {
      funding_account: feepayer,
      account: cashout_ata,
      wallet: cashout_pda,
      mint,
      system_program,
      token_program,
   }
   .invoke()?;
   verify_token_account(true, cashout_ata, cashout_pda, mint, token_program)?;
   Ok(())
}

pub fn create_cashout_parlay_account(
   feepayer: &AccountView,
   filling_mm: &Address,
   cashout_pda: &mut AccountView,
   cashout_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   header: &CashoutParlayHeader,
   legs: &[CashoutParlayLeg],
) -> ProgramResult {
   let cashout_id_bytes = header.cashout_id.to_le_bytes();
   let (expected, bump) = find_cashout_parlay_pda(filling_mm, header.cashout_id);
   if !address_eq(cashout_pda.address(), &expected) {
      log!("create_cashout_parlay_account: pda mismatch");
      return Err(ProgramError::InvalidSeeds);
   }
   let bump_bytes = [bump];
   let signer_seed = [
      Seed::from(CASHOUT_PARLAY_ACCOUNT_SEED),
      Seed::from(filling_mm.as_ref()),
      Seed::from(&cashout_id_bytes),
      Seed::from(&bump_bytes),
   ];
   let signers = [Signer::from(&signer_seed)];
   let n = header.num_legs as usize;
   let space = cashout_parlay_account_len(n) as u64;
   CreateAccount {
      from: feepayer,
      to: cashout_pda,
      lamports: get_rent(rent_sysvar, space)?,
      space,
      owner: &ID,
   }
   .invoke_signed(&signers)?;
   {
      let mut data = cashout_pda.try_borrow_mut()?;
      let mut header = *header;
      header.bump = bump;
      CashoutParlayAccountData::write_header_and_legs(&mut data, &header, legs)?;
   }
   Create {
      funding_account: feepayer,
      account: cashout_ata,
      wallet: cashout_pda,
      mint,
      system_program,
      token_program,
   }
   .invoke()?;
   verify_token_account(true, cashout_ata, cashout_pda, mint, token_program)?;
   Ok(())
}

pub fn create_cashout_escrow(
   feepayer: &AccountView,
   owner: &Address,
   escrow_pda: &mut AccountView,
   escrow_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   escrow: &CashoutEscrow,
) -> ProgramResult {
   let orig_id_bytes = escrow.orig_bet_id.to_le_bytes();
   let (expected, bump) = find_cashout_escrow_pda(owner, escrow.orig_bet_id);
   if !address_eq(escrow_pda.address(), &expected) {
      log!("create_cashout_escrow: pda mismatch");
      return Err(ProgramError::InvalidSeeds);
   }
   let bump_bytes = [bump];
   let signer_seed = [
      Seed::from(CASHOUT_ESCROW_SEED),
      Seed::from(owner.as_ref()),
      Seed::from(&orig_id_bytes),
      Seed::from(&bump_bytes),
   ];
   let signers = [Signer::from(&signer_seed)];
   ensure_pda_unused(escrow_pda, "create_cashout_escrow")?;
   let space = CASHOUT_ESCROW_LEN as u64;
   CreateAccount {
      from: feepayer,
      to: escrow_pda,
      lamports: get_rent(rent_sysvar, space)?,
      space,
      owner: &ID,
   }
   .invoke_signed(&signers)?;
   {
      let mut data = escrow_pda.try_borrow_mut()?;
      let mut escrow = *escrow;
      escrow.bump = bump;
      escrow.write_to_account(&mut data)?;
   }
   Create {
      funding_account: feepayer,
      account: escrow_ata,
      wallet: escrow_pda,
      mint,
      system_program,
      token_program,
   }
   .invoke()?;
   verify_token_account(true, escrow_ata, escrow_pda, mint, token_program)?;
   Ok(())
}

pub fn transfer_stake_to_cashout(
   bet_ata: &AccountView,
   cashout_ata: &AccountView,
   bet_pda: &AccountView,
   amount: u64,
   seed: &[u8],
   owner: &Address,
   id_le: &[u8],
   bump: u8,
) -> ProgramResult {
   if amount == 0 {
      return Ok(());
   }
   let bump_bytes = [bump];
   let signer_seed = [
      Seed::from(seed),
      Seed::from(owner.as_ref()),
      Seed::from(id_le),
      Seed::from(&bump_bytes),
   ];
   let signers = [Signer::from(&signer_seed)];
   Transfer::new(bet_ata, cashout_ata, bet_pda, amount).invoke_signed(&signers)?;
   Ok(())
}

/// Patch amount / payout / result / fillers in place (no re-decode).
pub fn patch_bet_amounts(
   bet_pda: &mut AccountView,
   amount: u64,
   payout: u64,
   fillers: &[BetFiller],
   num_fillers: u8,
   result: BetResult,
) -> ProgramResult {
   let n = num_fillers as usize;
   let expected = bet_account_len(n);
   if unlikely(bet_pda.data_len() != expected || n < 1 || fillers.len() < n) {
      return Err(ProgramError::InvalidAccountData);
   }
   let mut data = bet_pda.try_borrow_mut()?;
   unsafe {
      write_u64_le_unchecked(data.as_mut_ptr(), BET_AMOUNT_OFFSET, amount);
      write_u64_le_unchecked(data.as_mut_ptr(), BET_PAYOUT_OFFSET, payout);
      write_u8_unchecked(data.as_mut_ptr(), BET_RESULT_OFFSET, result as u8);
   }
   for i in 0..n {
      let off = BET_ACCOUNT_HEADER_LEN + i * BET_FILLER_LEN;
      let zc = fillers[i].to_zc();
      unsafe {
         core::ptr::write(data.as_mut_ptr().add(off).cast(), zc);
      }
   }
   Ok(())
}

/// Patch parlay amount / payout / result in place (no leg decode).
pub fn patch_parlay_amounts(
   bet_pda: &mut AccountView,
   amount: u64,
   payout: u64,
   result: BetResult,
) -> ProgramResult {
   if unlikely(bet_pda.data_len() < PARLAY_BET_HEADER_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }
   let mut data = bet_pda.try_borrow_mut()?;
   unsafe {
      write_u64_le_unchecked(data.as_mut_ptr(), PARLAY_BET_AMOUNT_OFFSET, amount);
      write_u64_le_unchecked(data.as_mut_ptr(), PARLAY_BET_PAYOUT_OFFSET, payout);
      write_u8_unchecked(data.as_mut_ptr(), PARLAY_BET_RESULT_OFFSET, result as u8);
   }
   Ok(())
}

/// Add A'/P' onto a parlay header without decoding legs.
pub fn add_parlay_amounts(
   bet_pda: &mut AccountView,
   add_amount: u64,
   add_payout: u64,
   result: BetResult,
) -> ProgramResult {
   if unlikely(bet_pda.data_len() < PARLAY_BET_HEADER_LEN) {
      return Err(ProgramError::InvalidAccountData);
   }
   let mut data = bet_pda.try_borrow_mut()?;
   unsafe {
      let amount = read_u64_le_unchecked(data.as_ptr(), PARLAY_BET_AMOUNT_OFFSET)
         .checked_add(add_amount).ok_or(ProgramError::ArithmeticOverflow)?;
      let payout = read_u64_le_unchecked(data.as_ptr(), PARLAY_BET_PAYOUT_OFFSET)
         .checked_add(add_payout).ok_or(ProgramError::ArithmeticOverflow)?;
      write_u64_le_unchecked(data.as_mut_ptr(), PARLAY_BET_AMOUNT_OFFSET, amount);
      write_u64_le_unchecked(data.as_mut_ptr(), PARLAY_BET_PAYOUT_OFFSET, payout);
      write_u8_unchecked(data.as_mut_ptr(), PARLAY_BET_RESULT_OFFSET, result as u8);
   }
   Ok(())
}

/// Cashout bump is filled by [`create_cashout_account`] (`find_cashout_pda` once).
pub fn cashout_header_from_bet(
   filling_mm: &Address,
   feepayer: Address,
   orig: &BetAccountHeader,
   cashout_id: u64,
   amount: u64,
   payout: u64,
   timestamp: u32,
   cashout_event_state_sequence: u16,
   cashout_event_game_state: EventGameState,
   num_fillers: u8,
) -> CashoutAccountHeader {
   CashoutAccountHeader {
      discriminator: CASHOUT_ACCOUNT_DISCRIMINATOR,
      bump: 0,
      mm: *filling_mm,
      feepayer,
      orig_bet_id: orig.bet_id,
      orig_owner: orig.owner,
      cashout_id,
      market_id: orig.market_id,
      side: orig.side,
      amount,
      payout,
      timestamp,
      orig_event_state_sequence: orig.event_state_sequence,
      orig_event_game_state: orig.event_game_state,
      cashout_event_state_sequence,
      cashout_event_game_state,
      result: BetResult::Pending,
      num_fillers,
   }
}

/// Encumbrance PDA + liability ATA owned by it (registration). `None` = skip auction MM.
#[inline(always)]
pub fn verify_cashout_mm_encumbrance(
   mm_encumbrance_pda: &AccountView,
   mm_liability_token_account: &AccountView,
   mm_program: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
) -> Result<Option<u8>, ProgramError> {
   let Some(encumbrance_pda_bump) = verify_mm_encumbrance_pda(mm_encumbrance_pda, mm_program) else {
      return Ok(None);
   };
   if !verify_token_account(
      false,
      mm_liability_token_account,
      mm_encumbrance_pda,
      mint,
      token_program,
   )? {
      return Ok(None);
   }
   Ok(Some(encumbrance_pda_bump))
}

/// Free liability vs reserved profit. Returns `(amount_from_liability, amount_to_send)`.
/// Does not write encumbrance.
#[inline(always)]
pub fn cashout_amount_to_send(
   mm_liability_account_balance_before: u64,
   outstanding_liability: i64,
   cashout_payment: u64,
) -> Result<(u64, u64), ProgramError> {
   let reserved_profit: u64 = if outstanding_liability < 0 {
      0
   } else {
      outstanding_liability.try_into().map_err(|_| {
         log!("cashout: reserved profit does not fit u64");
         ProgramError::ArithmeticOverflow
      })?
   };
   let free_balance = mm_liability_account_balance_before.saturating_sub(reserved_profit);
   let amount_from_liability = core::cmp::min(cashout_payment, free_balance);
   let amount_to_send = cashout_payment
      .checked_sub(amount_from_liability)
      .ok_or(ProgramError::ArithmeticOverflow)?;
   Ok((amount_from_liability, amount_to_send))
}

/// Spend free collateral from the MM liability ATA toward `cashout_payment`.
/// Returns `amount_to_send` for the MM CPI (remainder; may be 0). Encumbrance i64 is not written.
#[inline(never)]
pub fn pay_cashout_from_free_liability(
   mm_encumbrance_pda: &AccountView,
   encumbrance_pda_bump: u8,
   mm_program: &Address,
   mm_liability_token_account: &AccountView,
   payment_dest: &AccountView,
   cashout_payment: u64,
) -> Result<u64, ProgramError> {
   let mm_liability_account_balance_before =
      get_token_account_balance(mm_liability_token_account)?;
   let outstanding_liability = get_encumbrance(mm_encumbrance_pda)?;
   let (amount_from_liability, amount_to_send) = cashout_amount_to_send(
      mm_liability_account_balance_before,
      outstanding_liability,
      cashout_payment,
   )?;
   #[cfg(feature = "log")]
   log!(
      "cashout: amount_from_liability: {}, amount_to_send: {}",
      amount_from_liability,
      amount_to_send
   );
   if amount_from_liability > 0 {
      let mm_encumbrance_pda_bump_seed = [encumbrance_pda_bump];
      let encumbrance_pda_seeds = [
         Seed::from(MM_ENCUMBRANCE_PDA_SEED),
         Seed::from(mm_program.as_ref()),
         Seed::from(&mm_encumbrance_pda_bump_seed),
      ];
      let encumbrance_pda_signer = Signer::from(&encumbrance_pda_seeds);
      Transfer::new(
         mm_liability_token_account,
         payment_dest,
         mm_encumbrance_pda,
         amount_from_liability,
      )
      .invoke_signed(&[encumbrance_pda_signer])?;
   }
   Ok(amount_to_send)
}

/// Dest must have risen by the full quoted payment; then novate the slice.
#[inline(never)]
pub fn finish_cashout_single(
   feepayer: &AccountView,
   ticket_feepayer: &mut AccountView,
   user: &AccountView,
   user_ata: &mut AccountView,
   bet_pda: &mut AccountView,
   bet_ata: &mut AccountView,
   cashout_pda: &mut AccountView,
   cashout_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   filling_mm: &Address,
   orig: &BetAccountHeader,
   cashout_id: u64,
   amount: u64,
   payout_removed: u64,
   timestamp: u32,
   cashout_event_state_sequence: u16,
   cashout_event_game_state: EventGameState,
   remaining: &[BetFiller],
   cashed: &[BetFiller],
   delay: bool,
   escrow_ata: &AccountView,
   payment_before: u64,
   payment: u64,
) -> ProgramResult {
   if delay {
      require_exact_token_increase(
         escrow_ata,
         payment_before,
         payment,
      )?;
   } else {
      require_exact_token_increase(
         user_ata,
         payment_before,
         payment,
      )?;
   }
   let header = cashout_header_from_bet(
      filling_mm,
      *feepayer.address(),
      orig,
      cashout_id,
      amount,
      payout_removed,
      timestamp,
      cashout_event_state_sequence,
      cashout_event_game_state,
      orig.num_fillers,
   );
   create_cashout_account(
      feepayer,
      filling_mm,
      cashout_pda,
      cashout_ata,
      mint,
      token_program,
      rent_sysvar,
      system_program,
      &header,
      &cashed[..orig.num_fillers as usize],
   )?;
   let bet_id_bytes = orig.bet_id.to_le_bytes();
   transfer_stake_to_cashout(
      bet_ata,
      cashout_ata,
      bet_pda,
      amount,
      BET_ACCOUNT_SEED,
      user.address(),
      &bet_id_bytes,
      orig.bump,
   )?;
   let remain_amount = orig.amount
      .checked_sub(amount).ok_or(ProgramError::ArithmeticOverflow)?;
   let remain_payout = orig.payout
      .checked_sub(payout_removed).ok_or(ProgramError::ArithmeticOverflow)?;
   let is_full = remain_amount == 0;
   if delay {
      patch_bet_amounts(
         bet_pda,
         remain_amount,
         remain_payout,
         remaining,
         orig.num_fillers,
         if is_full {
            BetResult::CashedOut
         } else {
            BetResult::Pending
         },
      )?;
   } else if is_full {
      let bump_bytes = [orig.bump];
      let signer_seed = [
         Seed::from(BET_ACCOUNT_SEED),
         Seed::from(user.address().as_ref()),
         Seed::from(&bet_id_bytes),
         Seed::from(&bump_bytes),
      ];
      let signers = [Signer::from(&signer_seed)];
      safe_close_ata(bet_ata, ticket_feepayer, user_ata, bet_pda, &signers)?;
      close_pda_return_rent(bet_pda, ticket_feepayer)?;
   } else {
      patch_bet_amounts(
         bet_pda,
         remain_amount,
         remain_payout,
         remaining,
         orig.num_fillers,
         BetResult::Pending,
      )?;
   }
   Ok(())
}

/// Dest must have risen by the full quoted payment; then novate.
#[inline(never)]
pub fn finish_cashout_parlay(
   feepayer: &AccountView,
   ticket_feepayer: &mut AccountView,
   user: &AccountView,
   user_ata: &mut AccountView,
   bet_pda: &mut AccountView,
   bet_ata: &mut AccountView,
   cashout_pda: &mut AccountView,
   cashout_ata: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   rent_sysvar: &AccountView,
   system_program: &AccountView,
   filling_mm: &Address,
   cashout_id: u64,
   amount: u64,
   num_legs: u8,
   legs: &[CashoutParlayLeg],
   payout_removed: u64,
   delay: bool,
   orig_amount: u64,
   orig_payout: u64,
   orig_bet_id: u64,
   orig_bump: u8,
   _orig_feepayer: Address,
   orig_filler: Address,
   timestamp: u32,
   escrow_ata: &AccountView,
   payment_before: u64,
   payment: u64,
) -> ProgramResult {
   if delay {
      require_exact_token_increase(
         escrow_ata,
         payment_before,
         payment,
      )?;
   } else {
      require_exact_token_increase(
         user_ata,
         payment_before,
         payment,
      )?;
   }
   let n = num_legs as usize;
   if unlikely(legs.len() < n) {
      return Err(ProgramError::InvalidInstructionData);
   }
   let header = CashoutParlayHeader {
      discriminator: CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR,
      bump: 0,
      mm: *filling_mm,
      feepayer: *feepayer.address(),
      orig_owner: *user.address(),
      orig_bet_id,
      cashout_id,
      amount,
      payout: payout_removed,
      timestamp,
      result: BetResult::Pending,
      original_filler_address: orig_filler,
      num_legs,
   };
   create_cashout_parlay_account(
      feepayer,
      filling_mm,
      cashout_pda,
      cashout_ata,
      mint,
      token_program,
      rent_sysvar,
      system_program,
      &header,
      &legs[..n],
   )?;
   let bet_id_bytes = orig_bet_id.to_le_bytes();
   transfer_stake_to_cashout(
      bet_ata,
      cashout_ata,
      bet_pda,
      amount,
      PARLAY_BET_ACCOUNT_SEED,
      user.address(),
      &bet_id_bytes,
      orig_bump,
   )?;
   let remain_amount = orig_amount
      .checked_sub(amount).ok_or(ProgramError::ArithmeticOverflow)?;
   let remain_payout = orig_payout
      .checked_sub(payout_removed).ok_or(ProgramError::ArithmeticOverflow)?;
   let is_full = remain_amount == 0;
   if delay {
      patch_parlay_amounts(
         bet_pda,
         remain_amount,
         remain_payout,
         if is_full {
            BetResult::CashedOut
         } else {
            BetResult::Pending
         },
      )?;
   } else if is_full {
      let bump_bytes = [orig_bump];
      let signer_seed = [
         Seed::from(PARLAY_BET_ACCOUNT_SEED),
         Seed::from(user.address().as_ref()),
         Seed::from(&bet_id_bytes),
         Seed::from(&bump_bytes),
      ];
      let signers = [Signer::from(&signer_seed)];
      safe_close_ata(bet_ata, ticket_feepayer, user_ata, bet_pda, &signers)?;
      close_pda_return_rent(bet_pda, ticket_feepayer)?;
   } else {
      patch_parlay_amounts(
         bet_pda,
         remain_amount,
         remain_payout,
         BetResult::Pending,
      )?;
   }
   Ok(())
}
