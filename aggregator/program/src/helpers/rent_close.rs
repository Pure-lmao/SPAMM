use core::mem::MaybeUninit;

use pinocchio::{
   AccountView, ProgramResult, cpi::{CpiAccount, Signer}, error::ProgramError, hint::unlikely,
   instruction::InstructionAccount,
};
use pinocchio_log::log;
use pinocchio_token::instructions::{Batch, CloseAccount, IntoBatch, Transfer as TokenTransfer};

use crate::{
   constants::{
      SAFE_CLOSE_ATA_BATCH_CPI_ACCOUNTS, SAFE_CLOSE_ATA_BATCH_IX_CAP, SETTLE_TOKEN_BATCH_MAX_INNER_DATA,
   },
   readers::read_u64_le_unchecked,
};

use super::account_reads::get_token_account_balance;

/// Push a bet-ATA transfer into a token batch and track remaining balance.
#[inline(always)]
pub fn push_bet_ata_out<'acc, 'buf>(
   batch: &mut Batch<'acc, 'buf>,
   bet_ata_remaining: &mut u64,
   amount: u64,
   bet_ata: &'acc AccountView,
   to: &'acc AccountView,
   bet_authority: &'acc AccountView,
) -> ProgramResult
where
   'acc: 'buf,
{
   if amount == 0 {
      return Ok(());
   }
   *bet_ata_remaining = bet_ata_remaining.checked_sub(amount).ok_or_else(|| {
      log!("push_bet_ata_out: arithmetic overflow");
      ProgramError::ArithmeticOverflow
   })?;
   TokenTransfer::new(bet_ata, to, bet_authority, amount).into_batch(batch)?;
   Ok(())
}

/// Move all lamports from `pda` to `recipient`, then [`AccountView::close`].
/// Pass `system_program` on the instruction so the runtime can credit the recipient.
#[inline(never)]
pub fn close_pda_return_rent(
   pda: &mut AccountView,
   recipient: &mut AccountView,
) -> ProgramResult {
   let dest_lamports = recipient.lamports();
   let pda_lamports = pda.lamports();

   pda.set_lamports(0);
   recipient.set_lamports(dest_lamports + pda_lamports);
   pda.close()?;
   Ok(())
}

#[inline(always)]
pub fn safe_close_ata(
   ata: &mut AccountView,
   lamport_dest: &mut AccountView,
   token_dest: &mut AccountView,
   authority: &AccountView,
   signers: &[Signer],
) -> ProgramResult {
   let token_balance = get_token_account_balance(ata)?;
   let mut batch_data = [const {
      MaybeUninit::<u8>::uninit()
   }; 1 + SAFE_CLOSE_ATA_BATCH_IX_CAP * (2 + SETTLE_TOKEN_BATCH_MAX_INNER_DATA)];
   let mut batch_ix_accounts =
      [const { MaybeUninit::<InstructionAccount>::uninit() }; SAFE_CLOSE_ATA_BATCH_CPI_ACCOUNTS];
   let mut batch_accounts =
      [const { MaybeUninit::<CpiAccount>::uninit() }; SAFE_CLOSE_ATA_BATCH_CPI_ACCOUNTS];
   let mut batch = Batch::new(
      &mut batch_data,
      &mut batch_ix_accounts,
      &mut batch_accounts,
   )?;
   if token_balance > 0 {
      TokenTransfer::new(ata, token_dest, authority, token_balance).into_batch(&mut batch)?;
   }
   CloseAccount::new(ata, lamport_dest, authority).into_batch(&mut batch)?;
   batch.invoke_signed(signers)?;
   Ok(())
}

pub fn get_rent(rent_sysvar: &AccountView, space: u64) -> Result<u64, ProgramError> {
   // SAFETY: rent account is verified in verify_rent_sysvar by caller
   if unlikely(space == 0) {
      return Ok(0);
   }
   let lamports_per_byte = unsafe { read_u64_le_unchecked(rent_sysvar.data_ptr(), 0) };
   // (overhead + space) * lamports_per_byte
   let rent = (128 + space) * lamports_per_byte;
   Ok(rent)
}