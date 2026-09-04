//! Settle the graded bet and move funds to the winner then close bet/ata to the feepayer.
//!
//! One pipeline:
//! 1. Verify the bet is graded and the accounts match.
//! 2. For each filler MM: move that MM's tokens (one SPL token batch CPI).
//! 3. Unwind each filler's encumbrance.
//! 4. Close the bet PDA; rent to the original feepayer.
//!
//! Accounts: **11** then **5 × N** (`N` = `num_fillers` on the bet)
//! 0. `signer` (signer)
//! 1. `bet_account` (writable)
//! 2. `bet_ata` (writable)
//! 3. `bet_feepayer` (writable)
//! 4. `user` (readonly) — ticket owner; on a cashout ticket this is the filling MM program
//! 5. `user_ata` (writable) — user ATA, or filling-MM **liability** ATA on cashout settle
//! 6. `config_pda` (readonly)
//! 7. `mint` (readonly)
//! 8. `token_program` (readonly)
//! 9. `cashout_escrow_pda` (readonly) — must be unused for this ticket
//! 10. `dest_encumbrance` (readonly) — filling MM encumbrance when settling a cashout; ignored otherwise
//!
//! Per filler:
//! 0. `mm_address` (readonly)
//! 1. `mm_config_pda` (readonly)
//! 2. `mm_encumbrance_pda` (writable)
//! 3. `mm_liability_token_account` (writable)
//! 4. `mm_netting_pda` (writable) — real netting PDA if the fill was netted, else system program
//!
//! No Data

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError, hint::unlikely
};
use pinocchio_log::log;
use pinocchio_system::ID as SYSTEM_ID;
use pinocchio_token::instructions::{Batch, CloseAccount, IntoBatch, Transfer};
use pinocchio::{cpi::CpiAccount, instruction::InstructionAccount};
use crate::{
   ID,
   constants::{
      MAX_NUMBER_OF_MMS, SETTLE_BET_TOKEN_BATCH_CPI_ACCOUNTS, SETTLE_BET_TOKEN_BATCH_IX_CAP,
      SETTLE_TOKEN_BATCH_MAX_INNER_DATA,
   },
   errors::SpammError,
   helpers::{
      calc_potential_profit, close_pda_return_rent, get_encumbrance, get_token_account_balance, push_bet_ata_out, verify_config_pda, verify_mint,
      verify_mm_config_pda, verify_mm_encumbrance_pda, verify_netting_pda, verify_signer, verify_token_account,
      verify_token_program,
      cashout_helpers::require_no_live_cashout_escrow,
      verify_bet_pda, verify_cashout_pda,
      freebet_helpers::require_not_freebet,
   },
   state::{
      BET_ACCOUNT_SEED, BetAccountData, BetAccountHeader, BetFiller, CashoutAccountData, CASHOUT_ACCOUNT_DISCRIMINATOR,
      CASHOUT_ACCOUNT_SEED,
      account_bet::BetResult,
      account_netting::apply_settle_netting,
      other::{MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, MM_ENCUMBRANCE_PDA_SEED},
   },
   writers::write_i64_le_unchecked,
};

pub const SETTLE_BET_IX_DISCRIMINATOR: u8 = 25;

pub(crate) const ACCOUNTS_PER_FILLER: usize = 5;

pub(crate) struct SettleBetTicket {
   pub header: BetAccountHeader,
   pub is_cashout: bool,
   pub escrow_owner: Address,
   pub escrow_bet_id: u64,
}

/// Decode a single-bet or cashout ticket header + live fillers for settle paths.
pub(crate) fn decode_settle_bet_ticket(
   bet_account: &AccountView,
   fillers_buf: &mut [MaybeUninit<BetFiller>],
   allow_cashout: bool,
) -> Result<SettleBetTicket, ProgramError> {
   if unlikely(!address_eq(bet_account.owner(), &ID)) {
      log!("settle_bet: bet account must be owned by this program");
      return Err(ProgramError::InvalidAccountOwner);
   }
   let disc = unsafe { *bet_account.data_ptr() };
   let is_cashout = disc == CASHOUT_ACCOUNT_DISCRIMINATOR;
   if !allow_cashout && is_cashout {
      log!("settle_bet: cashout tickets are not freebets");
      return Err(SpammError::InvalidFreebet.into());
   }

   if is_cashout {
      let co = {
         let raw = bet_account.try_borrow()?;
         let h = CashoutAccountData::decode_header(raw.as_ref())?;
         let n = h.num_fillers as usize;
         CashoutAccountData::decode_fillers_into(raw.as_ref(), n, fillers_buf)?;
         h
      };
      verify_cashout_pda(bet_account, &co.mm, co.cashout_id, co.bump)?;
      let escrow_owner = co.orig_owner;
      let escrow_bet_id = co.orig_bet_id;
      let header = co.as_bet_header();
      Ok(SettleBetTicket {
         header,
         is_cashout: true,
         escrow_owner,
         escrow_bet_id,
      })
   } else {
      let bet_account_data = bet_account.try_borrow()?;
      let h = BetAccountData::decode_header(bet_account_data.as_ref())?;
      let n = h.num_fillers as usize;
      BetAccountData::decode_fillers_into(bet_account_data.as_ref(), n, fillers_buf)?;
      verify_bet_pda(bet_account, &h.owner, h.bet_id, h.bump)?;
      Ok(SettleBetTicket {
         escrow_owner: h.owner,
         escrow_bet_id: h.bet_id,
         header: h,
         is_cashout: false,
      })
   }
}

/// Shared graded-ticket + filler-account checks after decode.
pub(crate) fn validate_settle_bet_ticket(
   header: &BetAccountHeader,
   bet_feepayer: &AccountView,
   user: &AccountView,
   filler_accounts: &[AccountView],
) -> ProgramResult {
   let num_fillers = header.num_fillers as usize;
   if filler_accounts.len() < ACCOUNTS_PER_FILLER || filler_accounts.len() % ACCOUNTS_PER_FILLER != 0 {
      log!("settle_bet: mm accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   if filler_accounts.len() / ACCOUNTS_PER_FILLER != num_fillers {
      log!("settle_bet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   if unlikely(header.result == BetResult::Pending) {
      log!("settle_bet: bet is pending");
      return Err(SpammError::BetNotGraded.into());
   }
   if unlikely(header.result == BetResult::CashedOut) {
      log!("settle_bet: CashedOut is not settleable");
      return Err(SpammError::InvalidCashout.into());
   }
   if unlikely(!address_eq(&header.feepayer, bet_feepayer.address())) {
      log!("settle_bet: bet feepayer is invalid");
      return Err(ProgramError::InvalidAccountData);
   }
   if unlikely(!address_eq(&header.owner, user.address())) {
      log!("settle_bet: bet owner is invalid");
      return Err(ProgramError::InvalidAccountData);
   }
   Ok(())
}

pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
   let [
      signer,
      bet_account,
      bet_ata,
      bet_feepayer,
      user,
      user_ata,
      our_config_pda,
      mint,
      token_program,
      cashout_escrow_pda,
      dest_encumbrance,
      filler_accounts @ ..,
   ] = accounts else {
      log!("settle_bet: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(&signer)?;
   verify_config_pda(&our_config_pda, true)?;
   verify_token_program(token_program)?;
   verify_mint(&mint)?;

   let mut fillers_buf = [const { MaybeUninit::<BetFiller>::uninit() }; MAX_NUMBER_OF_MMS];
   let SettleBetTicket {
      header,
      is_cashout,
      escrow_owner,
      escrow_bet_id,
   } = decode_settle_bet_ticket(bet_account, &mut fillers_buf, true)?;
   require_no_live_cashout_escrow(cashout_escrow_pda, &escrow_owner, escrow_bet_id)?;
   let num_fillers = header.num_fillers as usize;
   let fillers = unsafe {
      core::slice::from_raw_parts(fillers_buf.as_ptr().cast::<BetFiller>(), num_fillers)
   };
   validate_settle_bet_ticket(&header, bet_feepayer, user, filler_accounts)?;

   let account_seed = if is_cashout {
      if verify_mm_encumbrance_pda(dest_encumbrance, user).is_none() {
         log!("settle_bet: cashout dest encumbrance invalid");
         return Err(ProgramError::InvalidAccountData);
      }
      verify_token_account(true, &user_ata, dest_encumbrance, &mint, &token_program)?;
      CASHOUT_ACCOUNT_SEED
   } else {
      require_not_freebet(header.freebet_id)?;
      verify_token_account(true, &user_ata, &user, &mint, &token_program)?;
      BET_ACCOUNT_SEED
   };
   verify_token_account(true, &bet_ata, bet_account, &mint, &token_program)?;

   let amount_to_user_from_bet_ata = user_stake_from_bet_ata(header.result, header.amount)?;
   let bet_ata_start = get_token_account_balance(bet_ata)?;

   // Pay each filler, return leftover stake (+ dust) to the user, close the bet ATA.
   settle_fillers(
      &header,
      fillers,
      amount_to_user_from_bet_ata,
      bet_ata_start,
      user,
      bet_account,
      bet_ata,
      bet_feepayer,
      user_ata,
      user_ata,
      mint,
      token_program,
      filler_accounts,
      account_seed,
   )?;

   unwind_fillers_encumbrance_after_settle(&header, fillers, filler_accounts)?;

   close_pda_return_rent(bet_account, bet_feepayer)?;
   Ok(())
}

/// Stake returned from the bet ATA (profit comes from each filler's liability ATA).
pub(crate) fn user_stake_from_bet_ata(result: BetResult, amount: u64) -> Result<u64, ProgramError> {
   match result {
      BetResult::Won | BetResult::HalfWon |
         BetResult::Push | BetResult::Cancelled | BetResult::RolledBack => Ok(amount),
      BetResult::Lost => Ok(0),
      BetResult::HalfLost => Ok(amount / 2),
      BetResult::ModifiedWin => {
         log!("settle_bet: ModifiedWin is parlay-only");
         Err(ProgramError::InvalidAccountData)
      }
      // process() already rejected Pending / CashedOut.
      _ => Err(ProgramError::InvalidAccountData),
   }
}

/// Per-filler token legs: `(liability → user, bet ATA → liability ATA)`.
fn filler_token_amounts(result: BetResult, filler: &BetFiller) -> Result<(u64, u64), ProgramError> {
   match result {
      BetResult::Won => {
         let user_profit = calc_potential_profit(filler.amount, filler.odds_scaled)?;
         Ok((user_profit, 0))
      }
      BetResult::Lost => Ok((0, filler.amount)),
      BetResult::HalfWon => {
         let half_amount = filler.amount.checked_div(2).ok_or(ProgramError::ArithmeticOverflow)?;
         let user_profit = calc_potential_profit(half_amount, filler.odds_scaled)?;
         Ok((user_profit, 0))
      }
      BetResult::HalfLost => {
         let half_amount = filler.amount.checked_div(2).ok_or(ProgramError::ArithmeticOverflow)?;
         Ok((0, half_amount))
      }
      BetResult::Push | BetResult::Cancelled | BetResult::RolledBack => Ok((0, 0)),
      BetResult::ModifiedWin => {
         log!("settle_bet: ModifiedWin is parlay-only");
         Err(ProgramError::InvalidAccountData)
      }
      // process() already rejected Pending / CashedOut.
      _ => Err(ProgramError::InvalidAccountData),
   }
}

pub(crate) fn unwind_encumbrance(mm_encumbrance_pda: &mut AccountView, delta: i64) -> ProgramResult {
   if delta == 0 {
      return Ok(());
   }
   let encumbrance = get_encumbrance(mm_encumbrance_pda)?
      .checked_sub(delta).ok_or(ProgramError::ArithmeticOverflow)?;
   unsafe {
      write_i64_le_unchecked(
         mm_encumbrance_pda.data_mut_ptr(),
         MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
         encumbrance,
      );
   }
   Ok(())
}

/// After token CPI, unwind each filler's encumbrance / netting book.
pub(crate) fn unwind_fillers_encumbrance_after_settle(
   header: &BetAccountHeader,
   fillers: &[BetFiller],
   filler_accounts: &mut [AccountView],
) -> ProgramResult {
   let num_fillers = fillers.len();
   let event_id_wire = header.market_id.event_id.as_wire_bytes();
   for i in 0..num_fillers {
      let filler = fillers[i];
      if filler.amount == 0 && filler.reserved_profit == 0 {
         continue;
      }
      if unlikely(address_eq(&filler.mm_address, &SYSTEM_ID)) {
         log!("settle_bet: filler mm address is invalid");
         return Err(ProgramError::InvalidAccountData);
      }
      let profit = filler.reserved_profit;
      let base = i * ACCOUNTS_PER_FILLER;
      let drop = if filler.is_potentially_netted {
         if !verify_netting_pda(
            &filler_accounts[base + 4],
            &filler_accounts[base],
            &event_id_wire,
         ) {
            log!("settle_bet: invalid netting pda");
            return Err(ProgramError::InvalidAccountData);
         }
         let peak_delta = apply_settle_netting(
            &mut filler_accounts[base + 4],
            &header.market_id,
            header.side,
            profit,
         )?;
         peak_delta.checked_neg().ok_or(ProgramError::ArithmeticOverflow)?
      } else {
         if unlikely(!address_eq(filler_accounts[base + 4].address(), &SYSTEM_ID)) {
            log!("settle_bet: unnetted filler must pass system program as netting");
            return Err(ProgramError::InvalidAccountData);
         }
         profit.try_into().map_err(|_| ProgramError::ArithmeticOverflow)?
      };
      unwind_encumbrance(&mut filler_accounts[base + 2], drop)?;
   }
   Ok(())
}

/// SPL token batch CPI. `#[inline(never)]` so the large `MaybeUninit` buffers are not on `process`'s stack.
#[inline(never)]
pub(crate) fn settle_fillers<'a>(
   header: &BetAccountHeader,
   fillers: &[BetFiller],
   amount_to_user_from_bet_ata: u64,
   bet_ata_start: u64,
   user: &'a AccountView,
   bet_account: &'a AccountView,
   bet_ata: &'a AccountView,
   bet_feepayer: &'a AccountView,
   stake_dest_ata: &'a AccountView,
   profit_dest_ata: &'a AccountView,
   mint: &'a AccountView,
   token_program: &'a AccountView,
   filler_accounts: &'a [AccountView],
   account_seed: &'static [u8],
) -> ProgramResult {
   let bet_id_bytes = header.bet_id.to_le_bytes();
   let bet_bump_bytes = [header.bump];
   let bet_account_signer_seeds = [
      Seed::from(account_seed),
      Seed::from(user.address().as_ref()),
      Seed::from(&bet_id_bytes),
      Seed::from(&bet_bump_bytes),
   ];

   let mut bet_ata_remaining = bet_ata_start;
   let mut enc_needed = [false; MAX_NUMBER_OF_MMS];
   let mut enc_bumps = [0u8; MAX_NUMBER_OF_MMS];
   let mut enc_seed_bufs = [const { MaybeUninit::<[Seed; 3]>::uninit() }; MAX_NUMBER_OF_MMS];

   let mut batch_data = [const { MaybeUninit::<u8>::uninit() }; 1 + SETTLE_BET_TOKEN_BATCH_IX_CAP * (2 + SETTLE_TOKEN_BATCH_MAX_INNER_DATA)];
   let mut batch_ix_accounts = [const { MaybeUninit::<InstructionAccount>::uninit() }; SETTLE_BET_TOKEN_BATCH_CPI_ACCOUNTS];
   let mut batch_accounts = [const { MaybeUninit::<CpiAccount>::uninit() }; SETTLE_BET_TOKEN_BATCH_CPI_ACCOUNTS];
   let mut batch = Batch::new(
      &mut batch_data,
      &mut batch_ix_accounts,
      &mut batch_accounts,
   )?;

   let num_fillers = fillers.len();
   for i in 0..num_fillers {
      let filler = fillers[i];
      // Partial cashout can leave a slot at 0. Keep the filler for revert-by-index; skip work.
      if filler.amount == 0 {
         continue;
      }
      if unlikely(address_eq(&filler.mm_address, &SYSTEM_ID)) {
         log!("settle_bet: filler mm address is invalid");
         return Err(ProgramError::InvalidAccountData);
      }

      let base = i * ACCOUNTS_PER_FILLER;
      let mm = &filler_accounts[base];
      let mm_config = &filler_accounts[base + 1];
      let mm_enc = &filler_accounts[base + 2];
      let mm_liab = &filler_accounts[base + 3];

      if unlikely(!address_eq(&filler.mm_address, &mm.address())) {
         log!("settle_bet: filler mm address is invalid");
         return Err(ProgramError::InvalidAccountData);
      }
      if unlikely(!verify_mm_config_pda(mm_config, mm)) {
         log!("settle_bet: invalid mm config pda");
         return Err(ProgramError::InvalidAccountData);
      }
      let Some(enc_bump) = verify_mm_encumbrance_pda(mm_enc, mm) else {
         return Err(ProgramError::InvalidAccountData);
      };
      verify_token_account(true, mm_liab, mm_enc, mint, token_program)?;

      let (liability_to_user, bet_to_liability) =
         filler_token_amounts(header.result, &filler)?;

      // Win (or half-win): pay profit from this MM's reserved liability.
      // Cashout dest is the filling MM liability ATA (may equal this ATA when the same MM cashed out).
      if liability_to_user > 0 && !address_eq(mm_liab.address(), profit_dest_ata.address()) {
         Transfer::new(mm_liab, profit_dest_ata, mm_enc, liability_to_user).into_batch(&mut batch)?;
         enc_needed[i] = true;
         enc_bumps[i] = enc_bump;
      }

      // Loss: lost stake goes into the liability ATA (never the MM wallet).
      push_bet_ata_out(
         &mut batch,
         &mut bet_ata_remaining,
         bet_to_liability,
         bet_ata,
         mm_liab,
         bet_account,
      )?;
   }

   push_bet_ata_out(
      &mut batch,
      &mut bet_ata_remaining,
      amount_to_user_from_bet_ata,
      bet_ata,
      stake_dest_ata,
      bet_account,
   )?;

   let dust_to_user = bet_ata_remaining;
   if dust_to_user > 0 {
      push_bet_ata_out(
         &mut batch,
         &mut bet_ata_remaining,
         dust_to_user,
         bet_ata,
         stake_dest_ata,
         bet_account,
      )?;
   }
   if unlikely(bet_ata_remaining != 0) {
      log!("settle_bet: bet ata remaining balance after batch");
      return Err(ProgramError::InvalidAccountData);
   }

   CloseAccount::new(bet_ata, bet_feepayer, bet_account).into_batch(&mut batch)?;

   for i in 0..num_fillers {
      if enc_needed[i] {
         let mm = &filler_accounts[i * ACCOUNTS_PER_FILLER];
         enc_seed_bufs[i].write([
            Seed::from(MM_ENCUMBRANCE_PDA_SEED),
            Seed::from(mm.address().as_ref()),
            Seed::from(core::slice::from_ref(&enc_bumps[i])),
         ]);
      }
   }

   let mut signers = [const { MaybeUninit::<Signer>::uninit() }; 1 + MAX_NUMBER_OF_MMS];
   signers[0].write(Signer::from(&bet_account_signer_seeds));
   let mut n_signers = 1usize;
   for i in 0..num_fillers {
      if enc_needed[i] {
         signers[n_signers].write(Signer::from(unsafe { enc_seed_bufs[i].assume_init_ref() }));
         n_signers += 1;
      }
   }
   batch.invoke_signed(unsafe {
      core::slice::from_raw_parts(signers.as_ptr().cast::<Signer>(), n_signers)
   })?;
   Ok(())
}
