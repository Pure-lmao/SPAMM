pub mod constants;
pub mod errors;
pub mod instructions;
pub mod price;
pub mod state;
pub mod wire;

mod addr;
mod checks;

use anchor_lang::prelude::*;

pub use state::SingleQuote;
pub use wire::{EventGameStateArg, EventIdArg, MarketIdArg, WireRest};

declare_id!("4ADgF21dBH2wwtaSkEYq37uYJuio73xnKLc94mv9BQkV");

include!("contexts.rs");

#[program]
pub mod spamm_template_market_maker_anchor {
   use super::*;

   #[instruction(discriminator = 100)]
   pub fn init_program(ctx: Context<InitProgram>, admin: Pubkey, rfq_signer: Pubkey) -> Result<()> {
      instructions::init_program::handler(ctx, admin, rfq_signer)
   }

   #[instruction(discriminator = 101)]
   pub fn set_rfq_signer(ctx: Context<SetRfqSigner>) -> Result<()> {
      instructions::set_rfq_signer::handler(ctx)
   }

   #[instruction(discriminator = 110)]
   pub fn init_event(ctx: Context<InitEvent>, event_id: EventIdArg) -> Result<()> {
      instructions::init_event::handler(ctx, event_id)
   }

   #[instruction(discriminator = 111)]
   pub fn init_market(ctx: Context<InitMarket>, market_id: MarketIdArg) -> Result<()> {
      instructions::init_market::handler(ctx, market_id)
   }

   #[instruction(discriminator = 112)]
   pub fn close_event(ctx: Context<CloseEvent>, event_id: EventIdArg) -> Result<()> {
      instructions::close_event::handler(ctx, event_id)
   }

   #[instruction(discriminator = 113)]
   pub fn close_market(ctx: Context<CloseMarket>, market_id: MarketIdArg) -> Result<()> {
      instructions::close_market::handler(ctx, market_id)
   }

   #[instruction(discriminator = 114)]
   pub fn update_event_state(
      ctx: Context<UpdateEventState>,
      event_id: EventIdArg,
      sequence: u16,
      game_state: EventGameStateArg,
   ) -> Result<()> {
      instructions::update_event_state::handler(ctx, event_id, sequence, game_state)
   }

   #[instruction(discriminator = 115)]
   pub fn update_market(ctx: Context<UpdateMarket>, market_id: MarketIdArg) -> Result<()> {
      instructions::update_market::handler(ctx, market_id)
   }

   #[instruction(discriminator = 120)]
   pub fn get_quote(ctx: Context<GetQuote>, rest: WireRest) -> Result<SingleQuote> {
      instructions::get_quote::handler(ctx, rest)
   }

   #[instruction(discriminator = 121)]
   pub fn fill_bet_quote(ctx: Context<FillBetQuote>, rest: WireRest) -> Result<()> {
      instructions::fill_bet_quote::handler(ctx, rest)
   }

   #[instruction(discriminator = 122)]
   pub fn get_quote_parlay(ctx: Context<GetQuoteParlay>, rest: WireRest) -> Result<()> {
      instructions::get_quote_parlay::handler(ctx, rest)
   }

   #[instruction(discriminator = 123)]
   pub fn fill_parlay_quote(ctx: Context<FillParlayQuote>, rest: WireRest) -> Result<()> {
      instructions::fill_parlay_quote::handler(ctx, rest)
   }

   #[instruction(discriminator = 130)]
   pub fn fill_bet_rfq(ctx: Context<FillBetRfq>, rest: WireRest) -> Result<()> {
      instructions::fill_bet_rfq::handler(ctx, rest)
   }

   #[instruction(discriminator = 131)]
   pub fn fill_parlay_rfq(ctx: Context<FillParlayRfq>, rest: WireRest) -> Result<()> {
      instructions::fill_parlay_rfq::handler(ctx, rest)
   }

   #[instruction(discriminator = 140)]
   pub fn get_cashout_quote(ctx: Context<GetCashoutQuote>, rest: WireRest) -> Result<u64> {
      instructions::get_cashout_quote::handler(ctx, rest)
   }

   #[instruction(discriminator = 141)]
   pub fn fill_cashout_quote(ctx: Context<FillCashoutQuote>, rest: WireRest) -> Result<()> {
      instructions::fill_cashout_quote::handler(ctx, rest)
   }

   #[instruction(discriminator = 142)]
   pub fn get_cashout_quote_parlay(ctx: Context<GetCashoutQuoteParlay>, rest: WireRest) -> Result<u64> {
      instructions::get_cashout_quote_parlay::handler(ctx, rest)
   }

   #[instruction(discriminator = 143)]
   pub fn fill_cashout_parlay_quote(ctx: Context<FillCashoutParlayQuote>, rest: WireRest) -> Result<()> {
      instructions::fill_cashout_parlay_quote::handler(ctx, rest)
   }

   #[instruction(discriminator = 144)]
   pub fn fill_cashout_rfq(ctx: Context<FillCashoutRfq>, rest: WireRest) -> Result<()> {
      instructions::fill_cashout_rfq::handler(ctx, rest)
   }

   #[instruction(discriminator = 145)]
   pub fn fill_cashout_parlay_rfq(ctx: Context<FillCashoutParlayRfq>, rest: WireRest) -> Result<()> {
      instructions::fill_cashout_parlay_rfq::handler(ctx, rest)
   }

   #[instruction(discriminator = 150)]
   pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
      instructions::withdraw::handler(ctx)
   }
}
