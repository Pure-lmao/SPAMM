//! Mollusk SBF integration tests for `spamm_aggregator`.
//! Build programs first: `cargo build-sbf --manifest-path aggregator/program/Cargo.toml`
//! and `cargo build-sbf --manifest-path market_maker/program/Cargo.toml`.
//!
//! Run (from `aggregator/program`): `cargo test -p spamm_aggregator --features test-sbf --test spamm_mollusk -- --test-threads=1`

#![cfg(feature = "test-sbf")]

mod common;
mod ix_admin;
mod ix_change_config;
mod ix_fill_bet;
mod ix_fill_parlay;
mod ix_grade_bets;
mod ix_init_program;
mod ix_netting;
mod ix_register_mm;
mod ix_router;
mod ix_scenarios;
mod ix_settle_bet;
mod ix_settle_parlay;
mod ix_withdraw;
