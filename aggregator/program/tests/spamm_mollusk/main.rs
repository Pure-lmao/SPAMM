//! Mollusk SBF integration tests for `spamm_aggregator`.
//!
//! **Requires two `cargo build-sbf --arch v3` artifacts** (see `.cursor/rules/mollusk-tests.mdc`):
//! - `aggregator/program/target/deploy/spamm_aggregator.so`
//! - `market_maker/program/target/deploy/spamm_market_maker.so` (copied into aggregator deploy dir by `Env::new`)
//!
//! `cargo check` and `cargo test` without `--features test-sbf` do **not** run these tests.
//!
//! Run (from `aggregator/program`):
//! `cargo test -p spamm_aggregator --features test-sbf --test spamm_mollusk -- --test-threads=1`
//! (`test-sbf` enables this crate, program `log`, and the `devnet` cluster feature.)

#![cfg(feature = "test-sbf")]

mod common;
#[cfg(feature = "devnet")]
mod ix_admin;
mod ix_change_config;
mod ix_claim_revert_cashout;
mod ix_fill_bet;
mod ix_fill_cashout;
mod ix_fill_parlay;
mod ix_fill_parlay_cashout;
mod ix_fill_rfq_bet;
mod ix_fill_rfq_cashout;
mod ix_fill_rfq_parlay;
mod ix_fill_rfq_parlay_cashout;
mod ix_freebet_fill_bet;
mod ix_freebet_fill_parlay;
mod ix_freebet_fill_rfq_bet;
mod ix_freebet_fill_rfq_parlay;
mod ix_freebet_issuer;
mod ix_get_cashout_quote_proxy;
mod ix_get_market_quotes_proxy;
mod ix_get_parlay_cashout_quote_proxy;
mod ix_get_parlay_quote_proxy;
mod ix_get_quote_proxy;
mod ix_grade_bets;
mod ix_grade_parlay;
mod ix_init_program;
mod ix_netting;
mod ix_register_mm;
mod ix_deregister_mm;
mod ix_router;
mod ix_scenarios;
mod ix_settle_bet;
mod ix_settle_freebet;
mod ix_settle_freebet_parlay;
mod ix_settle_parlay;
mod ix_withdraw;
