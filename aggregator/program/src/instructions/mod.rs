use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{
   init_program::INIT_PROGRAM_IX_DISCRIMINATOR,
   change_config_status::CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR,
   register_mm::REGISTER_MM_IX_DISCRIMINATOR,
   fill_bet::FILL_BET_IX_DISCRIMINATOR,
   grade_bets::GRADE_BETS_IX_DISCRIMINATOR,
   settle_bet::SETTLE_BET_IX_DISCRIMINATOR,
   create_netting_account::CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR,
   add_line_to_netting_account::ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR, 
   remove_line_from_netting_account::REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR,
   close_netting_account::CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR,
};


mod init_program;
mod fill_bet;
mod create_netting_account;
mod close_netting_account;
mod remove_line_from_netting_account;
mod add_line_to_netting_account;
mod register_mm;
mod grade_bets;
mod settle_bet;
mod change_config_status;
mod force_close_pda;

pub use fill_bet::FillBetIxData;

#[inline(never)]
pub fn dispatch(d: u8, data: &[u8], accounts: &mut [AccountView]) -> ProgramResult {
   match d {
      //set up
      INIT_PROGRAM_IX_DISCRIMINATOR => init_program::process(accounts),
      CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR => change_config_status::process(accounts, data),
      REGISTER_MM_IX_DISCRIMINATOR => register_mm::process(accounts, data),

      //bets
      FILL_BET_IX_DISCRIMINATOR => fill_bet::fill_bet(accounts, data),
      GRADE_BETS_IX_DISCRIMINATOR => grade_bets::process(accounts, data),
      SETTLE_BET_IX_DISCRIMINATOR => settle_bet::process(accounts),

      // netting PDA (per-event netting state)
      CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR => create_netting_account::process(accounts, data),
      ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR => add_line_to_netting_account::process(accounts, data),
      REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR => remove_line_from_netting_account::process(accounts, data),
      CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR => close_netting_account::process(accounts, data),

      255 => force_close_pda::process(accounts),
      _ => {
         log!("unknown instruction discriminator: {}", d);
         Err(ProgramError::InvalidInstructionData)
      }
   }
}
