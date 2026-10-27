use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{
   close_event::CLOSE_EVENT_IX_DISCRIMINATOR,
   close_market::CLOSE_MARKET_IX_DISCRIMINATOR,
   fill_bet_quote::process as fill_bet_quote,
   fill_bet_rfq::process as fill_bet_rfq,
   fill_cashout_parlay_quote::process as fill_cashout_parlay_quote,
   fill_cashout_parlay_rfq::process as fill_cashout_parlay_rfq,
   fill_cashout_quote::process as fill_cashout_quote,
   fill_cashout_rfq::process as fill_cashout_rfq,
   fill_parlay_quote::process as fill_parlay_quote,
   fill_parlay_rfq::process as fill_parlay_rfq,
   get_cashout_quote::process as get_cashout_quote,
   get_cashout_quote_parlay::process as get_cashout_quote_parlay,
   get_quote::process as get_quote,
   get_quote_parlay::process as get_quote_parlay,
   init_event::INIT_EVENT_IX_DISCRIMINATOR,
   init_market::INIT_MARKET_IX_DISCRIMINATOR,
   create_token_account::CREATE_TOKEN_ACCOUNT_IX_DISCRIMINATOR,
   init_program::INIT_PROGRAM_IX_DISCRIMINATOR,
   set_rfq_signer::SET_RFQ_SIGNER_IX_DISCRIMINATOR,
   update_event_state::UPDATE_EVENT_STATE_IX_DISCRIMINATOR,
   update_market::UPDATE_MARKET_IX_DISCRIMINATOR,
   withdraw::WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR,
};
use spamm_aggregator::{
   quote_ok,
   state::{
      FILL_BET_QUOTE_IX_DISCRIMINATOR, FILL_BET_RFQ_IX_DISCRIMINATOR, FILL_CASHOUT_PARLAY_QUOTE_IX_DISCRIMINATOR,
      FILL_CASHOUT_PARLAY_RFQ_IX_DISCRIMINATOR, FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR, FILL_CASHOUT_RFQ_IX_DISCRIMINATOR,
      FILL_PARLAY_RFQ_IX_DISCRIMINATOR, FILL_QUOTE_PARLAY_IX_DISCRIMINATOR, GET_CASHOUT_QUOTE_IX_DISCRIMINATOR,
      GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR, GET_QUOTE_IX_DISCRIMINATOR, GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
   },
};

mod close_event;
mod close_market;
mod fill_bet_quote;
mod fill_bet_rfq;
mod fill_cashout_parlay_quote;
mod fill_cashout_parlay_rfq;
mod fill_cashout_quote;
mod fill_cashout_rfq;
mod fill_parlay_quote;
mod fill_parlay_rfq;
mod get_cashout_quote;
mod get_cashout_quote_parlay;
mod get_quote;
mod get_quote_parlay;
mod init_event;
mod init_market;
mod init_program;
mod create_token_account;
mod returns;
mod set_rfq_signer;
mod token;
mod update_event_state;
mod update_market;
mod withdraw;

#[inline(never)]
pub fn dispatch(
   program_id: &Address,
   discriminator: u8,
   data: &[u8],
   full_data: &[u8],
   accounts: &mut [AccountView],
) -> ProgramResult {
   match discriminator {
      INIT_PROGRAM_IX_DISCRIMINATOR => init_program::process(program_id, accounts, data),
      CREATE_TOKEN_ACCOUNT_IX_DISCRIMINATOR => create_token_account::process(program_id, accounts, data),
      SET_RFQ_SIGNER_IX_DISCRIMINATOR => set_rfq_signer::process(program_id, accounts),
      INIT_EVENT_IX_DISCRIMINATOR => init_event::process(program_id, accounts, data),
      INIT_MARKET_IX_DISCRIMINATOR => init_market::process(program_id, accounts, data),
      CLOSE_EVENT_IX_DISCRIMINATOR => close_event::process(program_id, accounts, data),
      CLOSE_MARKET_IX_DISCRIMINATOR => close_market::process(program_id, accounts, data),
      UPDATE_EVENT_STATE_IX_DISCRIMINATOR => update_event_state::process(program_id, accounts, data),
      UPDATE_MARKET_IX_DISCRIMINATOR => update_market::process(program_id, accounts, data),

      GET_QUOTE_IX_DISCRIMINATOR => quote_ok(get_quote(program_id, accounts, full_data)),
      FILL_BET_QUOTE_IX_DISCRIMINATOR => fill_bet_quote(program_id, accounts, full_data),
      GET_QUOTE_PARLAY_IX_DISCRIMINATOR => quote_ok(get_quote_parlay(program_id, accounts, full_data)),
      FILL_QUOTE_PARLAY_IX_DISCRIMINATOR => fill_parlay_quote(program_id, accounts, full_data),

      FILL_BET_RFQ_IX_DISCRIMINATOR => fill_bet_rfq(program_id, accounts, full_data),
      FILL_PARLAY_RFQ_IX_DISCRIMINATOR => fill_parlay_rfq(program_id, accounts, full_data),

      GET_CASHOUT_QUOTE_IX_DISCRIMINATOR => quote_ok(get_cashout_quote(program_id, accounts, full_data)),
      FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR => fill_cashout_quote(program_id, accounts, full_data),
      GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR => {
         quote_ok(get_cashout_quote_parlay(program_id, accounts, full_data))
      }
      FILL_CASHOUT_PARLAY_QUOTE_IX_DISCRIMINATOR => fill_cashout_parlay_quote(program_id, accounts, full_data),
      FILL_CASHOUT_RFQ_IX_DISCRIMINATOR => fill_cashout_rfq(program_id, accounts, full_data),
      FILL_CASHOUT_PARLAY_RFQ_IX_DISCRIMINATOR => fill_cashout_parlay_rfq(program_id, accounts, full_data),

      WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR => withdraw::process(program_id, accounts, data),

      _ => {
         log!("unknown instruction");
         Err(ProgramError::InvalidInstructionData)
      }
   }
}
