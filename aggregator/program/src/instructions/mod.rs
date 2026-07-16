use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_log::log;

pub use fill_bet::FILL_BET_IX_DISCRIMINATOR;
pub use fill_parlay::FILL_PARLAY_IX_DISCRIMINATOR;

use crate::instructions::{
   add_address_to_alt::ADD_ADDRESS_TO_ALT_IX_DISCRIMINATOR, 
   add_line_to_netting_account::ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR, 
   change_config_status::CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR, 
   close_netting_account::CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR, 
   create_netting_account::CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR, 
   deregister_mm::DEREGISTER_MM_IX_DISCRIMINATOR, 
   get_market_quotes_proxy::GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR, 
   get_parlay_quote_proxy::GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR, 
   get_quote_proxy::GET_QUOTE_PROXY_IX_DISCRIMINATOR, 
   grade_bets::GRADE_BETS_IX_DISCRIMINATOR, 
   init_program::INIT_PROGRAM_IX_DISCRIMINATOR, 
   register_mm::REGISTER_MM_IX_DISCRIMINATOR, 
   remove_line_from_netting_account::REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR, 
   settle_bet::SETTLE_BET_IX_DISCRIMINATOR, 
   settle_parlay::SETTLE_PARLAY_IX_DISCRIMINATOR, 
   settle_with_tx_line::SETTLE_WITH_TX_LINE_IX_DISCRIMINATOR,
   withdraw_from_liability_account::WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR
};


mod init_program;
mod fill_bet;
mod fill_helpers;
mod fill_parlay;
mod get_quote_proxy;
mod get_market_quotes_proxy;
mod get_parlay_quote_proxy;
mod create_netting_account;
mod close_netting_account;
mod remove_line_from_netting_account;
mod add_line_to_netting_account;
mod add_address_to_alt;
mod register_mm;
mod deregister_mm;
mod grade_bets;
mod settle_bet;
mod settle_parlay;
mod change_config_status;
mod force_close_pda;
mod withdraw_from_liability_account;
mod write_arbitrary_data;
mod settle_with_tx_line;
pub use add_line_to_netting_account::{
   AddLineToLiabilityNettingIxData, ADD_LINE_TO_LIABILITY_NETTING_IX_LEN,
};
pub use fill_bet::{FillBetIxData, FILL_BET_IX_DATA_LEN};
pub use fill_parlay::{FillParlayIxData, FILL_PARLAY_IX_DATA_LEN};
pub use remove_line_from_netting_account::{
   RemoveLineFromLiabilityNettingIxData, REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN,
};


#[inline(never)]
pub fn dispatch(d: u8, data: &[u8], accounts: &mut [AccountView]) -> ProgramResult {
   match d {
      //set up
      INIT_PROGRAM_IX_DISCRIMINATOR => init_program::process(accounts, data),
      CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR => change_config_status::process(accounts, data),
      REGISTER_MM_IX_DISCRIMINATOR => register_mm::process(accounts, data),
      DEREGISTER_MM_IX_DISCRIMINATOR => deregister_mm::process(accounts, data),

      //bets
      FILL_BET_IX_DISCRIMINATOR => fill_bet::fill_bet(accounts, data),
      FILL_PARLAY_IX_DISCRIMINATOR => fill_parlay::fill_parlay(accounts, data),
      GRADE_BETS_IX_DISCRIMINATOR => grade_bets::process(accounts, data),
      SETTLE_BET_IX_DISCRIMINATOR => settle_bet::process(accounts),
      SETTLE_PARLAY_IX_DISCRIMINATOR => settle_parlay::process(accounts),
      GET_QUOTE_PROXY_IX_DISCRIMINATOR => get_quote_proxy::get_quote_proxy(accounts, data),
      GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR => get_parlay_quote_proxy::get_parlay_quote_proxy(accounts, data),
      GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR => get_market_quotes_proxy::get_market_quotes_proxy(accounts, data),

      SETTLE_WITH_TX_LINE_IX_DISCRIMINATOR => settle_with_tx_line::process(accounts, data),

      // netting PDA (per-event netting state)
      CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR => create_netting_account::process(accounts, data),
      ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR => add_line_to_netting_account::process(accounts, data),
      REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR => remove_line_from_netting_account::process(accounts, data),
      CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR => close_netting_account::process(accounts, data),

      WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR => withdraw_from_liability_account::process(accounts, data),

      ADD_ADDRESS_TO_ALT_IX_DISCRIMINATOR => add_address_to_alt::process(accounts, data),

      254 => write_arbitrary_data::process(accounts, data),
      255 => force_close_pda::process(accounts),
      _ => {
         log!("unknown instruction discriminator: {}", d);
         Err(ProgramError::InvalidInstructionData)
      }
   }
}
