//! `get_cashout_quote_proxy` Mollusk coverage.

use solana_instruction::AccountMeta;
use solana_pubkey::Pubkey;

use spamm_aggregator::errors::SpammError;
use spamm_aggregator::instructions::{FillBetIxData, FillCashoutIxData};
use spamm_aggregator::state::EventGameState;

use crate::common::{
   assert_spamm_err, bet_pda_for, bet_token_ata, decode_proxy_cashout_quote_return, event_id_soccer,
   fill_bet_instruction, fill_bet_netting_placeholder, get_cashout_quote_proxy_instruction,
   get_cashout_quote_proxy_metas, market_spread_pregame, mm_program_id, record_cu_success,
   system_owned_empty, user, Env,
};

fn open_bet(env: &mut Env, bet_id: u64) -> (Pubkey, spamm_aggregator::state::MarketId) {
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   assert!(env
      .run_ix(fill_bet_instruction(
         &data,
         bet,
         bat,
         &mid,
         fill_bet_netting_placeholder(),
      ))
      .program_result
      .is_ok());
   (bet, mid)
}

#[test]
fn get_cashout_quote_proxy_one_mm_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, mid) = open_bet(&mut env, 3301);
   let data = FillCashoutIxData {
      orig_bet_id: 3301,
      cashout_id: 0,
      amount: 10_000_000,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(get_cashout_quote_proxy_instruction(&data, bet, &mid));
   assert!(r.program_result.is_ok(), "{:?}", r);
   let quotes = decode_proxy_cashout_quote_return(&r.return_data);
   assert_eq!(quotes.len(), 1);
   assert_eq!(quotes[0].0, mm_program_id());
   assert!(quotes[0].1 > 0);
   record_cu_success("get_cashout_quote_proxy/1_mm", &r);
}

#[test]
fn get_cashout_quote_proxy_skips_dead_mm_then_no_quotes() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, mid) = open_bet(&mut env, 3302);
   let data = FillCashoutIxData {
      orig_bet_id: 3302,
      cashout_id: 0,
      amount: 10_000_000,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut metas = get_cashout_quote_proxy_metas(bet, &mid);
   let bad = Pubkey::new_unique();
   env.upsert(bad, system_owned_empty());
   // Replace mm_config so verify_mm_config_pda fails → soft-skip → NoQuotesAvailable.
   metas[4] = AccountMeta::new_readonly(bad, false);
   let mut buf = vec![spamm_aggregator::instructions::GET_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR];
   let mut payload = [0u8; spamm_aggregator::instructions::FILL_CASHOUT_IX_DATA_LEN];
   data.write_wire(&mut payload).unwrap();
   buf.extend_from_slice(&payload);
   let ix = solana_instruction::Instruction::new_with_bytes(
      crate::common::agg_program_id(),
      &buf,
      metas,
   );
   let r = env.run_ix(ix);
   assert_spamm_err(&r, SpammError::NoQuotesAvailable);
}

#[test]
fn get_cashout_quote_proxy_skips_dead_mm_keeps_valid() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let (bet, mid) = open_bet(&mut env, 3303);
   let data = FillCashoutIxData {
      orig_bet_id: 3303,
      cashout_id: 0,
      amount: 10_000_000,
      min_payout: 1,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   // Append a second dead MM group after the live one — soft-skip must not fail the tx.
   let mut metas = get_cashout_quote_proxy_metas(bet, &mid);
   let bad = Pubkey::new_unique();
   env.upsert(bad, system_owned_empty());
   metas.extend_from_slice(&[
      AccountMeta::new_readonly(bad, false),
      AccountMeta::new_readonly(bad, false),
      AccountMeta::new_readonly(bad, false),
      AccountMeta::new_readonly(bad, false),
      AccountMeta::new(bad, false),
   ]);
   let mut buf = vec![spamm_aggregator::instructions::GET_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR];
   let mut payload = [0u8; spamm_aggregator::instructions::FILL_CASHOUT_IX_DATA_LEN];
   data.write_wire(&mut payload).unwrap();
   buf.extend_from_slice(&payload);
   let ix = solana_instruction::Instruction::new_with_bytes(
      crate::common::agg_program_id(),
      &buf,
      metas,
   );
   let r = env.run_ix(ix);
   assert!(r.program_result.is_ok(), "{:?}", r);
   let quotes = decode_proxy_cashout_quote_return(&r.return_data);
   assert_eq!(quotes.len(), 1);
   assert_eq!(quotes[0].0, mm_program_id());
   record_cu_success("get_cashout_quote_proxy/skip_dead_mm", &r);
}
