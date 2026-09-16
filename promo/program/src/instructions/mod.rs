use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{
   init_program::INIT_PROGRAM_IX_DISCRIMINATOR,
   fill_quote::FILL_QUOTE_IX_DISCRIMINATOR,
   fill_parlay_quote::FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
   get_quote::GET_QUOTE_IX_DISCRIMINATOR,
   get_quote_parlay::GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
   init_event::INIT_EVENT_IX_DISCRIMINATOR,
   init_market::INIT_MARKET_IX_DISCRIMINATOR,
   close_event::CLOSE_EVENT_IX_DISCRIMINATOR,
   close_market::CLOSE_MARKET_IX_DISCRIMINATOR,
   update_event_state::UPDATE_EVENT_STATE_IX_DISCRIMINATOR,
   update_oracle::UPDATE_ORACLE_IX_DISCRIMINATOR,
   update_status::UPDATE_STATUS_IX_DISCRIMINATOR,
   set_config_values::SET_CONFIG_VALUES_IX_DISCRIMINATOR,
   set_market_max_amount::SET_MARKET_MAX_AMOUNT_IX_DISCRIMINATOR,
   set_market_max_total_amount::SET_MARKET_MAX_TOTAL_AMOUNT_IX_DISCRIMINATOR,
   set_rfq_signer::SET_RFQ_SIGNER_IX_DISCRIMINATOR,
   withdraw_from_token_account::WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR,
};

mod close_event;
mod close_market;
mod fill_quote;
mod fill_parlay_quote;
mod get_quote;
mod get_quote_parlay;
mod init_event;
mod init_market;
mod init_program;
mod force_close_pda;
mod update_event_state;
mod update_oracle;
mod update_status;
mod set_config_values;
mod set_market_max_amount;
mod set_market_max_total_amount;
mod set_rfq_signer;
mod withdraw_from_token_account;
mod write_arbitrary_data;

#[inline(never)]
pub fn dispatch(program_id: &Address, d: u8, data: &[u8], accounts: &mut [AccountView]) -> ProgramResult {
   match d {
      UPDATE_ORACLE_IX_DISCRIMINATOR => update_oracle::process(program_id, accounts, data),
      INIT_PROGRAM_IX_DISCRIMINATOR => init_program::process(program_id, accounts, data),
      SET_RFQ_SIGNER_IX_DISCRIMINATOR => set_rfq_signer::process(program_id, accounts),

      UPDATE_STATUS_IX_DISCRIMINATOR => update_status::process(program_id, accounts, data),
      SET_CONFIG_VALUES_IX_DISCRIMINATOR => set_config_values::process(program_id, accounts, data),

      GET_QUOTE_IX_DISCRIMINATOR => get_quote::process(program_id, accounts, data),
      FILL_QUOTE_IX_DISCRIMINATOR => fill_quote::process(program_id, accounts, data),
      GET_QUOTE_PARLAY_IX_DISCRIMINATOR => get_quote_parlay::process(program_id, accounts, data),
      FILL_QUOTE_PARLAY_IX_DISCRIMINATOR => fill_parlay_quote::process(program_id, accounts, data),

      INIT_EVENT_IX_DISCRIMINATOR => init_event::process(program_id, accounts, data),
      INIT_MARKET_IX_DISCRIMINATOR => init_market::process(program_id, accounts, data),
      CLOSE_EVENT_IX_DISCRIMINATOR => close_event::process(program_id, accounts, data),
      CLOSE_MARKET_IX_DISCRIMINATOR => close_market::process(program_id, accounts, data),

      UPDATE_EVENT_STATE_IX_DISCRIMINATOR => update_event_state::process(program_id, accounts, data),

      SET_MARKET_MAX_AMOUNT_IX_DISCRIMINATOR => set_market_max_amount::process(program_id, accounts, data),
      SET_MARKET_MAX_TOTAL_AMOUNT_IX_DISCRIMINATOR => {
         set_market_max_total_amount::process(program_id, accounts, data)
      }

      WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR => {
         withdraw_from_token_account::process(program_id, accounts, data)
      }

      254 => write_arbitrary_data::process(program_id, accounts, data),
      255 => force_close_pda::process(program_id, accounts),

      _ => {
         log!("unknown instruction discriminator");
         Err(ProgramError::InvalidInstructionData)
      }
   }
}
