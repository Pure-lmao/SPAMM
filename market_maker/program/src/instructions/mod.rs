use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{
   init_program::INIT_PROGRAM_IX_DISCRIMINATOR,
   fill_quote::FILL_QUOTE_IX_DISCRIMINATOR,
   fill_parlay_quote::FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
   fill_bet_rfq::FILL_BET_RFQ_IX_DISCRIMINATOR,
   fill_parlay_rfq::FILL_PARLAY_RFQ_IX_DISCRIMINATOR,
   get_quote::GET_QUOTE_IX_DISCRIMINATOR,
   get_quote_parlay::GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
   init_event::INIT_EVENT_IX_DISCRIMINATOR,
   init_market::INIT_MARKET_IX_DISCRIMINATOR,
   close_event::CLOSE_EVENT_IX_DISCRIMINATOR,
   close_market::CLOSE_MARKET_IX_DISCRIMINATOR,
   update_event_state::UPDATE_EVENT_STATE_IX_DISCRIMINATOR,
   set_rfq_signer::SET_RFQ_SIGNER_IX_DISCRIMINATOR,
   write_arbitrary_data::WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR,
};

mod close_event;
mod close_market;
mod fill_quote;
mod fill_bet_rfq;
mod fill_parlay_rfq;
mod rfq_helpers;
mod set_rfq_signer;
mod write_arbitrary_data;
mod fill_parlay_quote;
mod get_quote;
mod get_quote_parlay;
mod init_event;
mod init_market;
mod init_program;
mod force_close_pda;
mod update_event_state;
mod quote_helpers;
mod withdraw_from_token_account;

use spamm_aggregator::quote_ok;

#[inline(never)]
pub fn dispatch(program_id: &Address, d: u8, data: &[u8], accounts: &mut [AccountView]) -> ProgramResult {
   match d {
      // Discriminator `0` (`getUpdateOracleIx` / `encodeMarketMakerInstructionData` `updateOracle`): normal
      // Solana ix from the MM SDK (`market_maker/client/admin.ts`). Handled in `entrypoint` before this table
      // (Doppler path); do not add a `0` arm here.
      INIT_PROGRAM_IX_DISCRIMINATOR => init_program::process(program_id, accounts, data),

      // Discriminators 2-4 are reserved for SPAMM-specific instructions. Aggregator CPI quote
      // instructions use 5-6 (single leg) and 7-8 (parlay); see `spamm_aggregator::state` ix discs.

      // Aggregator CPI (`lib.rs` strips router byte): MUST match `GET_QUOTE_IX_DISCRIMINATOR` /
      // `FILL_QUOTE_IX_DISCRIMINATOR` in `spamm_aggregator`.
      GET_QUOTE_IX_DISCRIMINATOR => quote_ok(get_quote::process(program_id, accounts, data)),
      FILL_QUOTE_IX_DISCRIMINATOR => fill_quote::process(program_id, accounts, data),
      GET_QUOTE_PARLAY_IX_DISCRIMINATOR => quote_ok(get_quote_parlay::process(program_id, accounts, data)),
      FILL_QUOTE_PARLAY_IX_DISCRIMINATOR => fill_parlay_quote::process(program_id, accounts, data),
      FILL_BET_RFQ_IX_DISCRIMINATOR => fill_bet_rfq::process(program_id, accounts, data),
      FILL_PARLAY_RFQ_IX_DISCRIMINATOR => fill_parlay_rfq::process(program_id, accounts, data),

      INIT_EVENT_IX_DISCRIMINATOR => init_event::process(program_id, accounts, data),
      INIT_MARKET_IX_DISCRIMINATOR => init_market::process(program_id, accounts, data),
      CLOSE_EVENT_IX_DISCRIMINATOR => close_event::process(program_id, accounts, data),
      CLOSE_MARKET_IX_DISCRIMINATOR => close_market::process(program_id, accounts, data),

      UPDATE_EVENT_STATE_IX_DISCRIMINATOR => update_event_state::process(program_id, accounts, data),

      SET_RFQ_SIGNER_IX_DISCRIMINATOR => set_rfq_signer::process(program_id, accounts, data),

      250 => withdraw_from_token_account::process(program_id, accounts, data),

      WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR => write_arbitrary_data::process(program_id, accounts, data),

      255 => force_close_pda::process(program_id, accounts),

      _ => {
         log!("unknown instruction discriminator");
         Err(ProgramError::InvalidInstructionData)
      }
   }
}
