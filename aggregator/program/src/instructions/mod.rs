use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_log::log;

pub use fill_bet::FILL_BET_IX_DISCRIMINATOR;
pub use fill_parlay::FILL_PARLAY_IX_DISCRIMINATOR;
pub use fill_rfq_bet::FILL_RFQ_BET_IX_DISCRIMINATOR;
pub use fill_rfq_parlay::FILL_RFQ_PARLAY_IX_DISCRIMINATOR;
pub use cashout_bet::FILL_CASHOUT_IX_DISCRIMINATOR;
pub use cashout_parlay::FILL_PARLAY_CASHOUT_IX_DISCRIMINATOR;
pub use cashout_rfq_bet::FILL_RFQ_CASHOUT_IX_DISCRIMINATOR;
pub use cashout_rfq_parlay::FILL_RFQ_PARLAY_CASHOUT_IX_DISCRIMINATOR;
pub use claim_cashout_escrow::CLAIM_CASHOUT_ESCROW_IX_DISCRIMINATOR;
pub use revert_cashout::REVERT_CASHOUT_IX_DISCRIMINATOR;
pub use get_market_quotes_proxy::GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR;
pub use get_parlay_quote_proxy::GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR;
pub use get_quote_proxy::GET_QUOTE_PROXY_IX_DISCRIMINATOR;
pub use get_cashout_quote_proxy::GET_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR;
pub use get_cashout_parlay_quote_proxy::GET_PARLAY_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR;
pub use grade_bets::GRADE_BETS_IX_DISCRIMINATOR;
pub use grade_parlay::GRADE_PARLAY_IX_DISCRIMINATOR;
pub use settle_bet::SETTLE_BET_IX_DISCRIMINATOR;
pub use settle_parlay::SETTLE_PARLAY_IX_DISCRIMINATOR;
pub use settle_freebet::SETTLE_FREEBET_IX_DISCRIMINATOR;
pub use settle_freebet_parlay::SETTLE_FREEBET_PARLAY_IX_DISCRIMINATOR;
pub use freebet_issuer::{
   INIT_FREEBET_ISSUER_IX_DISCRIMINATOR, REMOVE_FREEBET_ISSUER_IX_DISCRIMINATOR,
   WITHDRAW_FREEBET_FUNDS_IX_DISCRIMINATOR,
};
pub use issue_freebet::ISSUE_FREEBET_IX_DISCRIMINATOR;
pub use revoke_freebet::REVOKE_FREEBET_IX_DISCRIMINATOR;
pub use freebet_fill_bet::FREEBET_FILL_BET_IX_DISCRIMINATOR;
pub use freebet_fill_parlay::FREEBET_FILL_PARLAY_IX_DISCRIMINATOR;
pub use freebet_fill_rfq_bet::FREEBET_FILL_RFQ_BET_IX_DISCRIMINATOR;
pub use freebet_fill_rfq_parlay::FREEBET_FILL_RFQ_PARLAY_IX_DISCRIMINATOR;

use crate::instructions::{
   add_line_to_netting_account::ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR,
   change_config_status::CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR,
   close_netting_account::CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR,
   create_netting_account::CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR,
   deregister_mm::DEREGISTER_MM_IX_DISCRIMINATOR,
   init_program::INIT_PROGRAM_IX_DISCRIMINATOR,
   register_mm::REGISTER_MM_IX_DISCRIMINATOR,
   remove_line_from_netting_account::REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR,
   withdraw_from_liability_account::WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR,
};

mod init_program;
mod freebet_issuer;
mod issue_freebet;
mod revoke_freebet;
mod fill_bet;
mod fill_parlay;
mod fill_rfq_bet;
mod fill_rfq_parlay;
mod freebet_fill_bet;
mod freebet_fill_parlay;
mod freebet_fill_rfq_bet;
mod freebet_fill_rfq_parlay;
mod cashout_bet;
mod cashout_parlay;
mod cashout_rfq_bet;
mod cashout_rfq_parlay;
mod claim_cashout_escrow;
mod revert_cashout;
mod get_quote_proxy;
mod get_market_quotes_proxy;
mod get_parlay_quote_proxy;
mod get_cashout_quote_proxy;
mod get_cashout_parlay_quote_proxy;
mod create_netting_account;
mod close_netting_account;
mod remove_line_from_netting_account;
mod add_line_to_netting_account;
mod register_mm;
mod deregister_mm;
mod grade_bets;
mod grade_parlay;
mod settle_bet;
mod settle_parlay;
mod settle_freebet;
mod settle_freebet_parlay;
mod change_config_status;
#[cfg(feature = "devnet")]
mod force_close_pda;
mod withdraw_from_liability_account;
#[cfg(feature = "devnet")]
mod write_arbitrary_data;


pub use crate::state::{
   AddLineToLiabilityNettingIxData, ADD_LINE_TO_LIABILITY_NETTING_IX_LEN,
   FillBetIxData, FILL_BET_IX_DATA_LEN,
   FillParlayIxData, FILL_PARLAY_IX_HEADER_LEN,
   FillRfqBetIxData, FILL_RFQ_BET_IX_DATA_LEN,
   FillRfqParlayIxData, FILL_RFQ_PARLAY_IX_HEADER_LEN,
   FillCashoutIxData, FILL_CASHOUT_IX_DATA_LEN,
   FillParlayCashoutIxData, FILL_PARLAY_CASHOUT_IX_HEADER_LEN, CASHOUT_SNAPSHOT_LEN,
   FillRfqCashoutIxData, FILL_RFQ_CASHOUT_IX_DATA_LEN,
   FillRfqParlayCashoutIxData, FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN,
   IssueFreebetIxData, ISSUE_FREEBET_IX_HEADER_LEN,
   RemoveLineFromLiabilityNettingIxData, REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN,
};

#[inline(never)]
pub fn dispatch(d: u8, data: &[u8], accounts: &mut [AccountView]) -> ProgramResult {
   match d {
      // set up - 0-3
      INIT_PROGRAM_IX_DISCRIMINATOR => init_program::process(accounts, data),
      CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR => change_config_status::process(accounts, data),
      REGISTER_MM_IX_DISCRIMINATOR => register_mm::process(accounts, data),
      DEREGISTER_MM_IX_DISCRIMINATOR => deregister_mm::process(accounts, data),

      // bets - 10-13
      FILL_BET_IX_DISCRIMINATOR => fill_bet::process(accounts, data),
      FILL_PARLAY_IX_DISCRIMINATOR => fill_parlay::process(accounts, data),
      FILL_RFQ_BET_IX_DISCRIMINATOR => fill_rfq_bet::process(accounts, data),
      FILL_RFQ_PARLAY_IX_DISCRIMINATOR => fill_rfq_parlay::process(accounts, data),

      // freebet fill - 15-18
      FREEBET_FILL_BET_IX_DISCRIMINATOR => freebet_fill_bet::process(accounts, data),
      FREEBET_FILL_PARLAY_IX_DISCRIMINATOR => freebet_fill_parlay::process(accounts, data),
      FREEBET_FILL_RFQ_BET_IX_DISCRIMINATOR => freebet_fill_rfq_bet::process(accounts, data),
      FREEBET_FILL_RFQ_PARLAY_IX_DISCRIMINATOR => freebet_fill_rfq_parlay::process(accounts, data),

      // grading - 20-21
      GRADE_BETS_IX_DISCRIMINATOR => grade_bets::process(accounts, data),
      GRADE_PARLAY_IX_DISCRIMINATOR => grade_parlay::process(accounts, data),

      // settle - 25-28
      SETTLE_BET_IX_DISCRIMINATOR => settle_bet::process(accounts),
      SETTLE_PARLAY_IX_DISCRIMINATOR => settle_parlay::process(accounts),
      SETTLE_FREEBET_IX_DISCRIMINATOR => settle_freebet::process(accounts),
      SETTLE_FREEBET_PARLAY_IX_DISCRIMINATOR => settle_freebet_parlay::process(accounts),

      // proxies - 30-34
      GET_QUOTE_PROXY_IX_DISCRIMINATOR => get_quote_proxy::process(accounts, data),
      GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR => get_parlay_quote_proxy::process(accounts, data),
      GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR => get_market_quotes_proxy::process(accounts, data),
      GET_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR => get_cashout_quote_proxy::process(accounts, data),
      GET_PARLAY_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR => {
         get_cashout_parlay_quote_proxy::process(accounts, data)
      }

      // netting PDA - 40-43
      CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR => create_netting_account::process(accounts, data),
      ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR => add_line_to_netting_account::process(accounts, data),
      REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR => {
         remove_line_from_netting_account::process(accounts, data)
      }
      CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR => close_netting_account::process(accounts, data),

      // liability account - 50
      WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR => {
         withdraw_from_liability_account::process(accounts, data)
      }

      // freebet issuer admin - 60-64
      INIT_FREEBET_ISSUER_IX_DISCRIMINATOR => freebet_issuer::process_init(accounts, data),
      REMOVE_FREEBET_ISSUER_IX_DISCRIMINATOR => freebet_issuer::process_remove(accounts, data),
      WITHDRAW_FREEBET_FUNDS_IX_DISCRIMINATOR => freebet_issuer::process_withdraw(accounts, data),
      ISSUE_FREEBET_IX_DISCRIMINATOR => issue_freebet::process(accounts, data),
      REVOKE_FREEBET_IX_DISCRIMINATOR => revoke_freebet::process(accounts, data),

      // cashout - 70-75
      FILL_CASHOUT_IX_DISCRIMINATOR => cashout_bet::process(accounts, data),
      FILL_PARLAY_CASHOUT_IX_DISCRIMINATOR => cashout_parlay::process(accounts, data),
      FILL_RFQ_CASHOUT_IX_DISCRIMINATOR => cashout_rfq_bet::process(accounts, data),
      FILL_RFQ_PARLAY_CASHOUT_IX_DISCRIMINATOR => cashout_rfq_parlay::process(accounts, data),
      CLAIM_CASHOUT_ESCROW_IX_DISCRIMINATOR => claim_cashout_escrow::process(accounts),
      REVERT_CASHOUT_IX_DISCRIMINATOR => revert_cashout::process(accounts),

      // devnet-only admin tooling (254 / 255)
      #[cfg(feature = "devnet")]
      254 => write_arbitrary_data::process(accounts, data),
      #[cfg(feature = "devnet")]
      255 => force_close_pda::process(accounts),
      _ => {
         log!("unknown instruction discriminator: {}", d);
         Err(ProgramError::InvalidInstructionData)
      }
   }
}
