use anchor_spl::{
   associated_token::AssociatedToken,
   token::{Mint, Token, TokenAccount},
};

use crate::constants::{MM_PARLAY_QUOTE_BUFFER_SEED, MM_QUOTE_BUFFER_SEED};
use crate::errors::TemplateError;
use crate::state::{Config, EventState, Market, QuoteBuffer};
use spamm_aggregator::{
   state::{
      other::{MM_MARKET_DATA_PDA_MIN_LEN, MM_MARKET_DATA_PDA_SEED},
      EVENT_STATE_HEADER_LEN, EVENT_STATE_SEED, MM_ACCOUNT_CONFIG_SEED, MM_CONFIG_PDA_HEADER_LEN,
      MM_PARLAY_QUOTE_BUFFER_LEN, MM_QUOTE_BUFFER_LEN,
   },
};

#[derive(Accounts)]
#[instruction(admin: Pubkey, rfq_signer: Pubkey)]
pub struct InitProgram<'info> {
   #[account(mut, constraint = feepayer.key() == admin @ TemplateError::NotAdmin)]
   pub feepayer: Signer<'info>,
   #[account(init, payer = feepayer, space = MM_CONFIG_PDA_HEADER_LEN, seeds = [MM_ACCOUNT_CONFIG_SEED], bump)]
   pub config: Account<'info, Config>,
   #[account(init, payer = feepayer, space = MM_QUOTE_BUFFER_LEN, seeds = [MM_QUOTE_BUFFER_SEED], bump)]
   pub quote_buffer: Account<'info, QuoteBuffer>,
   /// CHECK: parlay quote buffer is a raw leg table, not a Borsh account
   #[account(init, payer = feepayer, space = MM_PARLAY_QUOTE_BUFFER_LEN, seeds = [MM_PARLAY_QUOTE_BUFFER_SEED], bump)]
   pub parlay_buffer: UncheckedAccount<'info>,
   pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateTokenAccount<'info> {
   #[account(mut)]
   pub admin: Signer<'info>,
   #[account(
      seeds = [MM_ACCOUNT_CONFIG_SEED],
      bump = config.bump,
      constraint = config.admin == admin.key() @ TemplateError::NotAdmin
   )]
   pub config: Account<'info, Config>,
   #[account(
      init_if_needed,
      payer = admin,
      associated_token::mint = mint,
      associated_token::authority = config,
   )]
   pub token_account: Account<'info, TokenAccount>,
   pub mint: Account<'info, Mint>,
   pub token_program: Program<'info, Token>,
   pub associated_token_program: Program<'info, AssociatedToken>,
   pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetRfqSigner<'info> {
   pub admin: Signer<'info>,
   #[account(
      mut,
      seeds = [MM_ACCOUNT_CONFIG_SEED],
      bump = config.bump,
      constraint = config.admin == admin.key() @ TemplateError::NotAdmin
   )]
   pub config: Account<'info, Config>,
   /// CHECK: pubkey copied onto config; not a PDA
   pub rfq_signer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(event_id: EventIdArg)]
pub struct InitEvent<'info> {
   #[account(mut)]
   pub feepayer: Signer<'info>,
   #[account(
      seeds = [MM_ACCOUNT_CONFIG_SEED],
      bump = config.bump,
      constraint = config.admin == feepayer.key() @ TemplateError::NotAdmin
   )]
   pub config: Account<'info, Config>,
   #[account(
      init,
      payer = feepayer,
      space = EVENT_STATE_HEADER_LEN,
      seeds = [EVENT_STATE_SEED, event_id.wire.as_ref()],
      bump
   )]
   pub event_state: Account<'info, EventState>,
   pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: MarketIdArg)]
pub struct InitMarket<'info> {
   #[account(mut)]
   pub feepayer: Signer<'info>,
   #[account(
      seeds = [MM_ACCOUNT_CONFIG_SEED],
      bump = config.bump,
      constraint = config.admin == feepayer.key() @ TemplateError::NotAdmin
   )]
   pub config: Account<'info, Config>,
   #[account(
      init,
      payer = feepayer,
      space = MM_MARKET_DATA_PDA_MIN_LEN,
      seeds = [MM_MARKET_DATA_PDA_SEED, market_id.body(), market_id.operator(), market_id.mint()],
      bump
   )]
   pub market: Account<'info, Market>,
   pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(event_id: EventIdArg)]
pub struct CloseEvent<'info> {
   #[account(mut)]
   pub admin: Signer<'info>,
   #[account(
      seeds = [MM_ACCOUNT_CONFIG_SEED],
      bump = config.bump,
      constraint = config.admin == admin.key() @ TemplateError::NotAdmin
   )]
   pub config: Account<'info, Config>,
   #[account(
      mut,
      seeds = [EVENT_STATE_SEED, event_id.wire.as_ref()],
      bump = event_state.bump,
      close = admin
   )]
   pub event_state: Account<'info, EventState>,
}

#[derive(Accounts)]
#[instruction(market_id: MarketIdArg)]
pub struct CloseMarket<'info> {
   #[account(mut)]
   pub admin: Signer<'info>,
   #[account(
      seeds = [MM_ACCOUNT_CONFIG_SEED],
      bump = config.bump,
      constraint = config.admin == admin.key() @ TemplateError::NotAdmin
   )]
   pub config: Account<'info, Config>,
   #[account(
      mut,
      seeds = [MM_MARKET_DATA_PDA_SEED, market_id.body(), market_id.operator(), market_id.mint()],
      bump = market.bump,
      close = admin
   )]
   pub market: Account<'info, Market>,
}

#[derive(Accounts)]
#[instruction(event_id: EventIdArg)]
pub struct UpdateEventState<'info> {
   pub admin: Signer<'info>,
   #[account(
      seeds = [MM_ACCOUNT_CONFIG_SEED],
      bump = config.bump,
      constraint = config.admin == admin.key() @ TemplateError::NotAdmin
   )]
   pub config: Account<'info, Config>,
   #[account(
      mut,
      seeds = [EVENT_STATE_SEED, event_id.wire.as_ref()],
      bump = event_state.bump
   )]
   pub event_state: Account<'info, EventState>,
}

#[derive(Accounts)]
#[instruction(market_id: MarketIdArg)]
pub struct UpdateMarket<'info> {
   pub admin: Signer<'info>,
   #[account(
      seeds = [MM_ACCOUNT_CONFIG_SEED],
      bump = config.bump,
      constraint = config.admin == admin.key() @ TemplateError::NotAdmin
   )]
   pub config: Account<'info, Config>,
   #[account(
      mut,
      seeds = [MM_MARKET_DATA_PDA_SEED, market_id.body(), market_id.operator(), market_id.mint()],
      bump = market.bump
   )]
   pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct GetQuote<'info> {
   /// CHECK: copied into the quote buffer
   pub user: UncheckedAccount<'info>,
   pub clock: Sysvar<'info, Clock>,
   /// CHECK: `market_ok` in handler (zero quote if bad)
   pub market: UncheckedAccount<'info>,
   /// CHECK: `event_ok` in handler (zero quote if bad)
   pub event_state: UncheckedAccount<'info>,
   /// CHECK: `config_ok` in handler (zero quote if bad)
   pub config: UncheckedAccount<'info>,
   /// CHECK: `quote_buffer_ok` in handler (zero quote if bad)
   #[account(mut)]
   pub quote_buffer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct GetQuoteParlay<'info> {
   /// CHECK: copied into the parlay quote buffer
   pub user: UncheckedAccount<'info>,
   pub clock: Sysvar<'info, Clock>,
   /// CHECK: `config_ok` in handler
   pub config: UncheckedAccount<'info>,
   /// CHECK: `parlay_buffer_ok` in handler
   #[account(mut)]
   pub parlay_buffer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct GetCashoutQuote<'info> {
   /// CHECK: copied into the quote buffer
   pub user: UncheckedAccount<'info>,
   pub clock: Sysvar<'info, Clock>,
   /// CHECK: `market_ok` in handler
   pub market: UncheckedAccount<'info>,
   /// CHECK: `event_ok` in handler
   pub event_state: UncheckedAccount<'info>,
   /// CHECK: `config_ok` in handler
   pub config: UncheckedAccount<'info>,
   /// CHECK: `quote_buffer_ok` in handler
   #[account(mut)]
   pub quote_buffer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct GetCashoutQuoteParlay<'info> {
   /// CHECK: copied into the parlay quote buffer
   pub user: UncheckedAccount<'info>,
   pub clock: Sysvar<'info, Clock>,
   /// CHECK: `config_ok` in handler
   pub config: UncheckedAccount<'info>,
   /// CHECK: `parlay_buffer_ok` in handler
   #[account(mut)]
   pub parlay_buffer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FillBetQuote<'info> {
   /// CHECK: matched to the quote buffer
   pub user: UncheckedAccount<'info>,
   /// CHECK: aggregator config PDA signer
   pub agg_config: UncheckedAccount<'info>,
   /// CHECK: aggregator `verify_mm_market_data_pda`
   pub market: UncheckedAccount<'info>,
   /// CHECK: aggregator `verify_event_state`
   pub event_state: UncheckedAccount<'info>,
   #[account(seeds = [MM_ACCOUNT_CONFIG_SEED], bump = config.bump)]
   pub config: Account<'info, Config>,
   #[account(mut, seeds = [MM_QUOTE_BUFFER_SEED], bump)]
   pub quote_buffer: Account<'info, QuoteBuffer>,
   #[account(mut, token::mint = mint, token::authority = config)]
   pub source: Account<'info, TokenAccount>,
   #[account(
      mut,
      token::mint = mint,
      constraint = liability.owner == crate::checks::encumbrance_pda(mint.key())
   )]
   pub liability: Account<'info, TokenAccount>,
   pub mint: Account<'info, Mint>,
   pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FillBetRfq<'info> {
   /// CHECK: aggregator passes the bet user
   pub user: UncheckedAccount<'info>,
   /// CHECK: aggregator config PDA signer
   pub agg_config: UncheckedAccount<'info>,
   /// CHECK: aggregator `verify_mm_market_data_pda`
   pub market: UncheckedAccount<'info>,
   /// CHECK: aggregator `verify_event_state`
   pub event_state: UncheckedAccount<'info>,
   #[account(seeds = [MM_ACCOUNT_CONFIG_SEED], bump = config.bump)]
   pub config: Account<'info, Config>,
   #[account(mut, token::mint = mint, token::authority = config)]
   pub source: Account<'info, TokenAccount>,
   #[account(
      mut,
      token::mint = mint,
      constraint = liability.owner == crate::checks::encumbrance_pda(mint.key())
   )]
   pub liability: Account<'info, TokenAccount>,
   pub mint: Account<'info, Mint>,
   pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FillParlayQuote<'info> {
   /// CHECK: matched to the parlay quote buffer
   pub user: UncheckedAccount<'info>,
   /// CHECK: aggregator config PDA signer
   pub agg_config: UncheckedAccount<'info>,
   #[account(seeds = [MM_ACCOUNT_CONFIG_SEED], bump = config.bump)]
   pub config: Account<'info, Config>,
   /// CHECK: parlay quote buffer is a raw leg table
   #[account(mut, seeds = [MM_PARLAY_QUOTE_BUFFER_SEED], bump)]
   pub parlay_buffer: UncheckedAccount<'info>,
   #[account(mut, token::mint = mint, token::authority = config)]
   pub source: Account<'info, TokenAccount>,
   #[account(
      mut,
      token::mint = mint,
      constraint = liability.owner == crate::checks::encumbrance_pda(mint.key())
   )]
   pub liability: Account<'info, TokenAccount>,
   pub mint: Account<'info, Mint>,
   pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FillParlayRfq<'info> {
   /// CHECK: aggregator passes the bet user
   pub user: UncheckedAccount<'info>,
   /// CHECK: aggregator config PDA signer
   pub agg_config: UncheckedAccount<'info>,
   #[account(seeds = [MM_ACCOUNT_CONFIG_SEED], bump = config.bump)]
   pub config: Account<'info, Config>,
   #[account(mut, token::mint = mint, token::authority = config)]
   pub source: Account<'info, TokenAccount>,
   #[account(
      mut,
      token::mint = mint,
      constraint = liability.owner == crate::checks::encumbrance_pda(mint.key())
   )]
   pub liability: Account<'info, TokenAccount>,
   pub mint: Account<'info, Mint>,
   pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FillCashoutQuote<'info> {
   /// CHECK: matched to the quote buffer
   pub user: UncheckedAccount<'info>,
   /// CHECK: aggregator config PDA signer
   pub agg_config: UncheckedAccount<'info>,
   /// CHECK: aggregator `verify_mm_market_data_pda`
   pub market: UncheckedAccount<'info>,
   /// CHECK: aggregator `verify_event_state`
   pub event_state: UncheckedAccount<'info>,
   #[account(seeds = [MM_ACCOUNT_CONFIG_SEED], bump = config.bump)]
   pub config: Account<'info, Config>,
   #[account(mut, seeds = [MM_QUOTE_BUFFER_SEED], bump)]
   pub quote_buffer: Account<'info, QuoteBuffer>,
   #[account(mut, token::mint = mint, token::authority = config)]
   pub source: Account<'info, TokenAccount>,
   #[account(mut, token::mint = mint)]
   pub payment_dest: Account<'info, TokenAccount>,
   pub mint: Account<'info, Mint>,
   pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FillCashoutRfq<'info> {
   /// CHECK: aggregator passes the ticket user
   pub user: UncheckedAccount<'info>,
   /// CHECK: aggregator config PDA signer
   pub agg_config: UncheckedAccount<'info>,
   /// CHECK: aggregator `verify_mm_market_data_pda`
   pub market: UncheckedAccount<'info>,
   /// CHECK: aggregator `verify_event_state`
   pub event_state: UncheckedAccount<'info>,
   #[account(seeds = [MM_ACCOUNT_CONFIG_SEED], bump = config.bump)]
   pub config: Account<'info, Config>,
   #[account(mut, token::mint = mint, token::authority = config)]
   pub source: Account<'info, TokenAccount>,
   #[account(mut, token::mint = mint)]
   pub payment_dest: Account<'info, TokenAccount>,
   pub mint: Account<'info, Mint>,
   pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FillCashoutParlayQuote<'info> {
   /// CHECK: matched to the parlay quote buffer
   pub user: UncheckedAccount<'info>,
   /// CHECK: aggregator config PDA signer
   pub agg_config: UncheckedAccount<'info>,
   #[account(seeds = [MM_ACCOUNT_CONFIG_SEED], bump = config.bump)]
   pub config: Account<'info, Config>,
   /// CHECK: parlay quote buffer is a raw leg table
   #[account(mut, seeds = [MM_PARLAY_QUOTE_BUFFER_SEED], bump)]
   pub parlay_buffer: UncheckedAccount<'info>,
   #[account(mut, token::mint = mint, token::authority = config)]
   pub source: Account<'info, TokenAccount>,
   #[account(mut, token::mint = mint)]
   pub payment_dest: Account<'info, TokenAccount>,
   pub mint: Account<'info, Mint>,
   pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FillCashoutParlayRfq<'info> {
   /// CHECK: aggregator passes the ticket user
   pub user: UncheckedAccount<'info>,
   /// CHECK: aggregator config PDA signer
   pub agg_config: UncheckedAccount<'info>,
   #[account(seeds = [MM_ACCOUNT_CONFIG_SEED], bump = config.bump)]
   pub config: Account<'info, Config>,
   #[account(mut, token::mint = mint, token::authority = config)]
   pub source: Account<'info, TokenAccount>,
   #[account(mut, token::mint = mint)]
   pub payment_dest: Account<'info, TokenAccount>,
   pub mint: Account<'info, Mint>,
   pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
   pub admin: Signer<'info>,
   #[account(
      seeds = [MM_ACCOUNT_CONFIG_SEED],
      bump = config.bump,
      constraint = config.admin == admin.key() @ TemplateError::NotAdmin
   )]
   pub config: Account<'info, Config>,
   #[account(mut, token::mint = mint, token::authority = config)]
   pub source: Account<'info, TokenAccount>,
   pub mint: Account<'info, Mint>,
   pub token_program: Program<'info, Token>,
   #[account(mut, token::mint = mint)]
   pub destination: Account<'info, TokenAccount>,
}
