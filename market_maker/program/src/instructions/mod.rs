use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{
   close_event::CLOSE_EVENT_IX_DISCRIMINATOR,
   close_market::CLOSE_MARKET_IX_DISCRIMINATOR,
   init_event::INIT_EVENT_IX_DISCRIMINATOR,
   init_market::INIT_MARKET_IX_DISCRIMINATOR,
   init_program::INIT_PROGRAM_IX_DISCRIMINATOR,
   set_rfq_signer::SET_RFQ_SIGNER_IX_DISCRIMINATOR,
   update_event_state::UPDATE_EVENT_STATE_IX_DISCRIMINATOR,
   withdraw_from_token_account::WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR,
   write_arbitrary_data::WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR,
};

mod close_event;
mod close_market;
mod fill_quote;
mod fill_bet_rfq;
mod fill_parlay_rfq;
mod token_transfer;
mod rfq_helpers;
mod set_rfq_signer;
mod write_arbitrary_data;
mod fill_parlay_quote;
mod get_quote;
mod get_quote_parlay;
mod get_cashout_quote;
mod fill_cashout_quote;
mod get_cashout_quote_parlay;
mod fill_cashout_quote_parlay;
mod fill_cashout_rfq;
mod fill_parlay_cashout_rfq;
mod init_event;
mod init_market;
mod init_program;
mod force_close_pda;
mod update_event_state;
mod quote_helpers;
mod withdraw_from_token_account;

use spamm_aggregator::{
   quote_ok,
   state::{
      FILL_BET_RFQ_IX_DISCRIMINATOR,
      FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR,
      FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
      FILL_CASHOUT_RFQ_IX_DISCRIMINATOR,
      FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR,
      FILL_PARLAY_RFQ_IX_DISCRIMINATOR,
      FILL_QUOTE_IX_DISCRIMINATOR,
      FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
      GET_CASHOUT_QUOTE_IX_DISCRIMINATOR,
      GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
      GET_QUOTE_IX_DISCRIMINATOR,
      GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
   },
};

#[inline(never)]
pub fn dispatch(program_id: &Address, d: u8, data: &[u8], accounts: &mut [AccountView]) -> ProgramResult {
   match d {
      // admin — 100–101
      INIT_PROGRAM_IX_DISCRIMINATOR => init_program::process(program_id, accounts, data),
      SET_RFQ_SIGNER_IX_DISCRIMINATOR => set_rfq_signer::process(program_id, accounts),

      // event / market — 110–114
      INIT_EVENT_IX_DISCRIMINATOR => init_event::process(program_id, accounts, data),
      INIT_MARKET_IX_DISCRIMINATOR => init_market::process(program_id, accounts, data),
      CLOSE_EVENT_IX_DISCRIMINATOR => close_event::process(program_id, accounts, data),
      CLOSE_MARKET_IX_DISCRIMINATOR => close_market::process(program_id, accounts, data),
      UPDATE_EVENT_STATE_IX_DISCRIMINATOR => update_event_state::process(program_id, accounts, data),

      // auction CPI — 120–123
      GET_QUOTE_IX_DISCRIMINATOR => quote_ok(get_quote::process(program_id, accounts, data)),
      FILL_QUOTE_IX_DISCRIMINATOR => fill_quote::process(program_id, accounts, data),
      GET_QUOTE_PARLAY_IX_DISCRIMINATOR => quote_ok(get_quote_parlay::process(program_id, accounts, data)),
      FILL_QUOTE_PARLAY_IX_DISCRIMINATOR => fill_parlay_quote::process(program_id, accounts, data),

      // RFQ CPI — 130–131
      FILL_BET_RFQ_IX_DISCRIMINATOR => fill_bet_rfq::process(program_id, accounts, data),
      FILL_PARLAY_RFQ_IX_DISCRIMINATOR => fill_parlay_rfq::process(program_id, accounts, data),

      // cashout CPI — 140–145
      GET_CASHOUT_QUOTE_IX_DISCRIMINATOR => {
         quote_ok(get_cashout_quote::process(program_id, accounts, data))
      }
      FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR => fill_cashout_quote::process(program_id, accounts, data),
      GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR => {
         quote_ok(get_cashout_quote_parlay::process(program_id, accounts, data))
      }
      FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR => {
         fill_cashout_quote_parlay::process(program_id, accounts, data)
      }
      FILL_CASHOUT_RFQ_IX_DISCRIMINATOR => fill_cashout_rfq::process(program_id, accounts, data),
      FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR => {
         fill_parlay_cashout_rfq::process(program_id, accounts, data)
      }

      // funds — 150
      WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR => {
         withdraw_from_token_account::process(program_id, accounts, data)
      }

      // dev tooling
      WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR => write_arbitrary_data::process(program_id, accounts, data),
      255 => force_close_pda::process(program_id, accounts),

      _ => {
         log!("unknown instruction discriminator");
         Err(ProgramError::InvalidInstructionData)
      }
   }
}
