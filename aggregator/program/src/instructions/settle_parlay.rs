//! Settle the graded parlay and move funds, then close bet ATA and PDA.
//! SPL token moves use one token program batch CPI (p-token), including dust to the user and ATA close.
//!
//! Accounts: **15**
//! 0. `signer` (signer)
//! 1. `bet_account` (writable)
//! 2. `bet_ata` (writable)
//! 3. `bet_feepayer` (writable)
//! 4. `user` (readonly) — ticket owner; on a cashout ticket this is the filling MM program
//! 5. `user_ata` (writable) — user ATA, or filling-MM **liability** ATA on cashout settle
//! 6. `config_pda` (readonly)
//! 7. `mint` (readonly)
//! 8. `token_program` (readonly)
//! 9. `mm_address` (readonly) — must match `ParlayBetAccountData::filler_address`
//! 10. `mm_config_pda` (readonly)
//! 11. `mm_encumbrance_pda` (writable)
//! 12. `mm_liability_token_account` (writable)
//! 13. `cashout_escrow_pda` (readonly) — must be unused for this ticket
//! 14. `dest_encumbrance` (readonly) — filling MM encumbrance when settling a cashout; ignored otherwise
//!
//! Data: None

use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, Address, ProgramResult, address::address_eq, cpi::{Seed, Signer}, error::ProgramError, hint::{unlikely}
};
use pinocchio_log::log;
use pinocchio_token::instructions::{Batch, CloseAccount, IntoBatch, Transfer};
use pinocchio::{cpi::CpiAccount, instruction::InstructionAccount};
use crate::{ID, 
   constants::{SETTLE_PARLAY_TOKEN_BATCH_CPI_ACCOUNTS, SETTLE_PARLAY_TOKEN_BATCH_IX_CAP, SETTLE_TOKEN_BATCH_MAX_INNER_DATA}, 
   errors::SpammError, 
   helpers::{
      close_pda_return_rent, get_encumbrance, get_token_account_balance, push_bet_ata_out, verify_config_pda, verify_mint, verify_mm_config_pda,
      verify_mm_encumbrance_pda, verify_signer, verify_token_account, verify_token_program,
      cashout_helpers::require_no_live_cashout_escrow,
      verify_cashout_parlay_pda, verify_parlay_pda,
      freebet_helpers::{require_is_freebet, require_not_freebet},
      parlay_helpers::{compute_modified_cashout_parlay_settlement_from_account, compute_modified_parlay_settlement_from_account},
   }, 
   state::{
      PARLAY_BET_ACCOUNT_SEED, ParlayBetAccountData,
      CashoutParlayAccountData, CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR, CASHOUT_PARLAY_ACCOUNT_SEED,
      CASHOUT_PARLAY_ACCOUNT_MIN_LEN,
      account_bet::BetResult, 
      other::{MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET, MM_ENCUMBRANCE_PDA_SEED},
   }, writers::write_i64_le_unchecked
};

pub const SETTLE_PARLAY_IX_DISCRIMINATOR: u8 = 26;

pub(crate) struct SettleParlayTicket {
   pub(crate) bump: u8,
   pub(crate) owner: Address,
   pub(crate) feepayer: Address,
   pub(crate) bet_id: u64,
   pub(crate) amount: u64,
   pub(crate) payout: u64,
   pub(crate) freebet_id: u32,
   pub(crate) filler_address: Address,
   pub(crate) bet_result: BetResult,
   pub(crate) num_legs: u8,
   pub(crate) account_seed: &'static [u8],
   pub(crate) escrow_owner: Address,
   pub(crate) escrow_bet_id: u64,
}

/// Single authoritative decode of the parlay/cashout ticket for settle paths.
pub(crate) fn decode_settle_parlay_ticket(
   bet_account: &AccountView,
   expect_freebet: bool,
) -> Result<(SettleParlayTicket, bool), ProgramError> {
   if unlikely(!address_eq(bet_account.owner(), &ID)) {
      log!("settle_parlay: bet account must be owned by this program");
      return Err(ProgramError::InvalidAccountOwner);
   }
   let disc = unsafe { *bet_account.data_ptr() };
   let is_cashout = disc == CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR;
   if expect_freebet && is_cashout {
      log!("settle_parlay: cashout tickets are not freebets");
      return Err(SpammError::InvalidFreebet.into());
   }

   let ticket = if is_cashout {
      if unlikely(bet_account.data_len() < CASHOUT_PARLAY_ACCOUNT_MIN_LEN) {
         return Err(ProgramError::InvalidAccountData);
      }
      let h = {
         let raw = bet_account.try_borrow()?;
         CashoutParlayAccountData::decode_header(raw.as_ref())?
      };
      verify_cashout_parlay_pda(bet_account, &h.mm, h.cashout_id, h.bump)?;
      SettleParlayTicket {
         bump: h.bump,
         owner: h.mm,
         feepayer: h.feepayer,
         bet_id: h.cashout_id,
         amount: h.amount,
         payout: h.payout,
         freebet_id: 0,
         filler_address: h.original_filler_address,
         bet_result: h.result,
         num_legs: h.num_legs,
         account_seed: CASHOUT_PARLAY_ACCOUNT_SEED,
         escrow_owner: h.orig_owner,
         escrow_bet_id: h.orig_bet_id,
      }
   } else {
      let header = {
         let bet_account_data = bet_account.try_borrow()?;
         ParlayBetAccountData::decode_header(bet_account_data.as_ref())?
      };
      verify_parlay_pda(bet_account, &header.owner, header.bet_id, header.bump)?;
      SettleParlayTicket {
         bump: header.bump,
         owner: header.owner,
         feepayer: header.feepayer,
         bet_id: header.bet_id,
         amount: header.amount,
         payout: header.payout,
         freebet_id: header.freebet_id,
         filler_address: header.filler_address,
         bet_result: header.result,
         num_legs: header.num_legs,
         account_seed: PARLAY_BET_ACCOUNT_SEED,
         escrow_owner: header.owner,
         escrow_bet_id: header.bet_id,
      }
   };
   Ok((ticket, is_cashout))
}

pub fn process<'a>(accounts: &'a mut [AccountView]) -> ProgramResult {
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
      mm_address,
      mm_config_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
      cashout_escrow_pda,
      dest_encumbrance,
   ] = accounts else {
      log!("settle_parlay: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };
   settle_parlay_core(
      signer,
      bet_account,
      bet_ata,
      bet_feepayer,
      user,
      user_ata,
      user_ata,
      our_config_pda,
      mint,
      token_program,
      mm_address,
      mm_config_pda,
      mm_encumbrance_pda,
      mm_liability_token_account,
      Some(cashout_escrow_pda),
      Some(dest_encumbrance),
      false,
      None,
   )
   .map(|_| ())
}

pub(crate) fn settle_parlay_core(
   signer: &AccountView,
   bet_account: &mut AccountView,
   bet_ata: &AccountView,
   bet_feepayer: &mut AccountView,
   user: &AccountView,
   stake_dest_ata: &AccountView,
   profit_dest_ata: &AccountView,
   our_config_pda: &AccountView,
   mint: &AccountView,
   token_program: &AccountView,
   mm_address: &AccountView,
   mm_config_pda: &AccountView,
   mm_encumbrance_pda: &mut AccountView,
   mm_liability_token_account: &AccountView,
   cashout_escrow_pda: Option<&AccountView>,
   dest_encumbrance: Option<&AccountView>,
   expect_freebet: bool,
   prechecked_ticket: Option<SettleParlayTicket>,
) -> Result<(BetResult, u64, u32), ProgramError> {
   verify_signer(&signer)?;
   verify_config_pda(&our_config_pda, true)?;
   verify_token_program(token_program)?;
   verify_mint(&mint)?;

   let freebet_ticket_verified = prechecked_ticket.is_some();
   let (ticket, is_cashout) = match prechecked_ticket {
      Some(ticket) => {
         let is_cashout = ticket.account_seed == CASHOUT_PARLAY_ACCOUNT_SEED;
         (ticket, is_cashout)
      }
      None => decode_settle_parlay_ticket(bet_account, expect_freebet)?,
   };
   let SettleParlayTicket {
      bump,
      owner,
      feepayer,
      bet_id,
      amount,
      payout,
      freebet_id,
      filler_address,
      bet_result,
      num_legs,
      account_seed,
      escrow_owner,
      escrow_bet_id,
   } = ticket;

   let bet_id_bytes = bet_id.to_le_bytes();
   let bet_bump_bytes = bump.to_le_bytes();

   let bet_account_signer_seeds = [
      Seed::from(account_seed),
      Seed::from(user.address().as_ref()),
      Seed::from(&bet_id_bytes),
      Seed::from(&bet_bump_bytes),
   ];

   if unlikely(bet_result == BetResult::Pending) {
      log!("settle_parlay: bet is pending");
      return Err(SpammError::BetNotGraded.into());
   }
   if unlikely(bet_result == BetResult::CashedOut) {
      log!("settle_parlay: CashedOut is not settleable");
      return Err(SpammError::InvalidCashout.into());
   }

   if unlikely(!address_eq(&feepayer, &bet_feepayer.address())) {
      log!("settle_parlay: bet feepayer is invalid");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(!address_eq(&owner, &user.address())) {
      log!("settle_parlay: bet owner is invalid");
      return Err(ProgramError::InvalidInstructionData);
   }
   if !freebet_ticket_verified {
      if expect_freebet {
         require_is_freebet(freebet_id)?;
      } else {
         require_not_freebet(freebet_id)?;
      }
   }

   if !expect_freebet {
      let Some(escrow) = cashout_escrow_pda else {
         return Err(ProgramError::NotEnoughAccountKeys);
      };
      require_no_live_cashout_escrow(escrow, &escrow_owner, escrow_bet_id)?;
   }

   if is_cashout {
      let Some(dest) = dest_encumbrance else {
         return Err(ProgramError::NotEnoughAccountKeys);
      };
      if verify_mm_encumbrance_pda(dest, user).is_none() {
         log!("settle_parlay: cashout dest encumbrance invalid");
         return Err(ProgramError::InvalidInstructionData);
      }
      verify_token_account(true, profit_dest_ata, dest, mint, token_program)?;
   } else {
      verify_token_account(true, profit_dest_ata, user, mint, token_program)?;
   }

   verify_token_account(true,
      &bet_ata, bet_account,
      &mint, &token_program
   )?;

   if unlikely(!address_eq(&filler_address, mm_address.address())) {
      log!("settle_parlay: filler mm address is invalid");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(!verify_mm_config_pda(mm_config_pda, mm_address)) {
      log!("settle_parlay: invalid mm config pda");
      return Err(ProgramError::InvalidInstructionData);
   }

   let Some(valid_mm_encumbrance_pda_bump) = verify_mm_encumbrance_pda(
      mm_encumbrance_pda,
      mm_address,
   ) else {
      return Err(ProgramError::InvalidInstructionData);
   };

   verify_token_account(true,
      &mm_liability_token_account, mm_encumbrance_pda,
      &mint, &token_program
   )?;

   let potential_profit = payout.checked_sub(amount).ok_or_else(|| ProgramError::ArithmeticOverflow)?;
   let num_legs = num_legs as usize;

   let user_return: u64 = match bet_result {
      BetResult::Won => payout,
      BetResult::Lost => 0,
      BetResult::Push | BetResult::Cancelled | BetResult::RolledBack => amount,
      BetResult::ModifiedWin => {
         let raw = bet_account.try_borrow()?;
         let (ret, _lost) = if is_cashout {
            compute_modified_cashout_parlay_settlement_from_account(amount, raw.as_ref(), num_legs)?
         } else {
            compute_modified_parlay_settlement_from_account(amount, raw.as_ref(), num_legs)?
         };
         core::cmp::min(ret, payout)
      }
      BetResult::HalfWon | BetResult::HalfLost => {
         log!("settle_parlay: bet result is half won or half lost at ticket level");
         return Err(ProgramError::InvalidInstructionData);
      }
      BetResult::Pending | BetResult::CashedOut => unreachable!(),
   };

   let amount_to_user_from_bet_ata = core::cmp::min(user_return, amount);
   let amount_to_user_from_filler_liability_token_account =
      user_return.saturating_sub(amount_to_user_from_bet_ata);
   let amount_to_liability_from_bet_ata = amount.saturating_sub(amount_to_user_from_bet_ata);

   let profit_via_liability = amount_to_user_from_filler_liability_token_account > 0
      && !address_eq(mm_liability_token_account.address(), profit_dest_ata.address());

   let encumbrance_pda_bump_seed = [valid_mm_encumbrance_pda_bump];
   let encumbrance_pda_signer_seeds = [
      Seed::from(MM_ENCUMBRANCE_PDA_SEED),
      Seed::from(mm_address.address().as_ref()),
      Seed::from(&encumbrance_pda_bump_seed[..]),
   ];

   let mut bet_ata_remaining = get_token_account_balance(bet_ata)?;

   let mut batch_data = [const { MaybeUninit::<u8>::uninit() }; 1 + SETTLE_PARLAY_TOKEN_BATCH_IX_CAP * (2 + SETTLE_TOKEN_BATCH_MAX_INNER_DATA)];
   let mut batch_ix_accounts = [const { MaybeUninit::<InstructionAccount>::uninit() }; SETTLE_PARLAY_TOKEN_BATCH_CPI_ACCOUNTS];
   let mut batch_accounts = [const { MaybeUninit::<CpiAccount>::uninit() }; SETTLE_PARLAY_TOKEN_BATCH_CPI_ACCOUNTS];

   let mut batch = Batch::new(
      &mut batch_data,
      &mut batch_ix_accounts,
      &mut batch_accounts,
   )?;

   if profit_via_liability {
      Transfer::new(
         mm_liability_token_account,
         profit_dest_ata,
         mm_encumbrance_pda,
         amount_to_user_from_filler_liability_token_account,
      ).into_batch(&mut batch)?;
   }

   push_bet_ata_out(
      &mut batch,
      &mut bet_ata_remaining,
      amount_to_user_from_bet_ata,
      bet_ata,
      stake_dest_ata,
      bet_account,
   )?;
   push_bet_ata_out(
      &mut batch,
      &mut bet_ata_remaining,
      amount_to_liability_from_bet_ata,
      bet_ata,
      mm_liability_token_account,
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
      log!("settle_parlay: bet ata remaining balance after batch");
      return Err(ProgramError::InvalidInstructionData);
   }

   CloseAccount::new(bet_ata, bet_feepayer, bet_account).into_batch(&mut batch)?;

   let signer_bet = Signer::from(&bet_account_signer_seeds);
   if profit_via_liability {
      let signer_enc = Signer::from(&encumbrance_pda_signer_seeds);
      batch.invoke_signed(&[signer_bet, signer_enc])?;
   } else {
      batch.invoke_signed(core::slice::from_ref(&signer_bet))?;
   }

   let encumbrance_delta: i64 = potential_profit.try_into().map_err(|_| ProgramError::ArithmeticOverflow)?;
   if encumbrance_delta != 0 {
      let mut encumbrance = get_encumbrance(mm_encumbrance_pda)?;
      encumbrance = encumbrance
         .checked_sub(encumbrance_delta).ok_or_else(|| ProgramError::ArithmeticOverflow)?;

      unsafe {
         write_i64_le_unchecked(
            mm_encumbrance_pda.data_mut_ptr(),
            MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET,
            encumbrance
         );
      }
   }

   close_pda_return_rent(
      bet_account,
      bet_feepayer,
   )?;

   Ok((bet_result, amount, freebet_id))
}
