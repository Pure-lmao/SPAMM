//! `fill_bet` coverage (success + representative failures).

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;
use solana_program_option::COption;
use mollusk_svm_programs_token::token;
use solana_pubkey::Pubkey;
use spl_associated_token_account_interface::address::get_associated_token_address_with_program_id;
use spl_token_interface::state::{Account as SplTokenAccount, AccountState, Mint};

use spamm_aggregator::constants::{MAX_NUMBER_OF_MMS, ODDS_SCALE};
use spamm_aggregator::errors::SpammError;
use spamm_aggregator::helpers::calc_potential_profit;
use spamm_aggregator::instructions::{FillBetIxData, FILL_BET_IX_DISCRIMINATOR};
use spamm_aggregator::state::{EventGameState, MarketId};
use crate::common::{
   admin, assert_bet_after_fill, assert_fill_bet_single_mm_economics, assert_ok_record_cu, assert_program_err,
   assert_spamm_err, bet_pda_for, bet_token_ata, config_pda, decode_bet, encumbrance_pda, event_id_soccer,
   fill_bet_instruction, fill_bet_metas_one_mm, fill_bet_netting_placeholder, FILL_BET_MM_ACCOUNTS,
   FILL_MM_GROUP_OFFSET, add_line_account_metas, market_spread_pregame, mm_program_id, netting_pda_for_event,
   oracle_body_three_outcome, oracle_body_two_outcome, read_encumbrance, read_netting_soccer_header_and_lines, read_token_balance,
   system_owned_empty, user, user_collateral_ata, Env,
};

fn run_fill_bet(
   env: &mut Env,
   bet_id: u64,
   market: spamm_aggregator::state::MarketId,
   side: u8,
   amount: u64,
   min_odds: u32,
   mm_netting: solana_pubkey::Pubkey,
) -> mollusk_svm::result::InstructionResult {
   let bet = bet_pda_for(&user(), bet_id);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id,
      market_id: market,
      side,
      amount,
      min_odds_scaled: min_odds,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let ix = fill_bet_instruction(&data, bet, bat, &market, mm_netting);
   env.run_ix(ix)
}

#[test]
fn fill_bet_one_mm_spread_success() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let enc_pre = read_encumbrance(&env, &encumbrance_pda());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let r = run_fill_bet(
      &mut env,
      crate::common::BET_ID_BASIC,
      mid,
      0,
      10_000_000,
      15_000,
      fill_bet_netting_placeholder(),
   );
   assert_ok_record_cu("fill_bet/1_mm/no_netting", &r);
   let bet = bet_pda_for(&user(), crate::common::BET_ID_BASIC);
   let bat = bet_token_ata(&bet);
   assert_bet_after_fill(&env, &bet, 10_000_000, 0);
   let odds_scaled = 20_000u32;
   assert_fill_bet_single_mm_economics(
      &env,
      &bet,
      &bat,
      mid,
      pre_u,
      enc_pre,
      odds_scaled,
   );
}

#[test]
fn fill_bet_aggregator_paused() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let pause = env.agg_ix(
      1,
      vec![0u8],
      vec![
         AccountMeta::new(admin(), true),
         AccountMeta::new(config_pda(), false),
      ],
   );
   assert!(env.run_ix(pause).program_result.is_ok());
   let mid = market_spread_pregame(event_id_soccer());
   let r = run_fill_bet(&mut env, 99, mid, 0, 10_000_000, 15_000, fill_bet_netting_placeholder());
   assert_spamm_err(&r, SpammError::ProgramPaused);
}

/// MM quotes below `min_odds_scaled`: every MM iteration `continue`s → `filled_amount == 0` → `NoQuotesAvailable`.
#[test]
fn fill_bet_min_odds_too_high_no_fill() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let r = run_fill_bet(&mut env, 101, mid, 0, 10_000_000, 500_000_000, fill_bet_netting_placeholder());
   assert_spamm_err(&r, SpammError::NoQuotesAvailable);
}

#[test]
fn fill_bet_wrong_user_signer() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 102);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 102,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut metas = fill_bet_metas_one_mm(bet, bat, &mid, fill_bet_netting_placeholder());
   metas[1] = AccountMeta::new_readonly(crate::common::wrong_signer(), true);
   let mut buf = vec![FILL_BET_IX_DISCRIMINATOR];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

#[test]
fn fill_bet_invalid_sport_wire_byte_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 818);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 818,
      market_id: mid,
      side: 0,
      amount: 1_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   // `EventId.sport` wire byte inside `MarketId` (after `bet_id` + `event` + `league`).
   pay[18] = 99;
   let mut buf = vec![FILL_BET_IX_DISCRIMINATOR];
   buf.extend_from_slice(&pay);
   let ix = solana_instruction::Instruction::new_with_bytes(
      crate::common::agg_program_id(),
      &buf,
      fill_bet_metas_one_mm(bet, bat, &mid, fill_bet_netting_placeholder()),
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_bet_live_market_sequence_two_success() {
   let mut env = Env::new();
   let mut mid_live = market_spread_pregame(event_id_soccer());
   mid_live.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid_live, body.as_slice())]);
   env.patch_event_state_sequence(&event_id_soccer(), 2);

   let enc_pre = read_encumbrance(&env, &encumbrance_pda());
   let pre_u = read_token_balance(&env, &user_collateral_ata());
   let bet = bet_pda_for(&user(), 920);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 920,
      market_id: mid_live,
      side: 0,
      amount: 3_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   let ix = fill_bet_instruction(&data, bet, bat, &mid_live, fill_bet_netting_placeholder());
   let r = env.run_ix(ix);
   assert_ok_record_cu("fill_bet/1_mm/live_sequence_ok", &r);
   assert_bet_after_fill(&env, &bet, 3_000_000, 0);
   assert_fill_bet_single_mm_economics(
      &env,
      &bet,
      &bat,
      mid_live,
      pre_u,
      enc_pre,
      20_000u32,
   );
}

#[test]
fn fill_bet_live_spread_nets() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let mut mid_live = market_spread_pregame(eid);
   mid_live.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid_live, body.as_slice())]);
   env.create_netting_for_soccer_event();
   env.patch_event_state_sequence(&eid, 2);
   let np = netting_pda_for_event(&eid);
   let enc_pre = read_encumbrance(&env, &encumbrance_pda());
   let bet = bet_pda_for(&user(), 921);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 921,
      market_id: mid_live,
      side: 0,
      amount: 3_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_bet_instruction(&data, bet, bat, &mid_live, np));
   assert_ok_record_cu("fill_bet/1_mm/live_nets", &r);
   let b = decode_bet(&env, &bet);
   assert!(b.fillers[0].is_potentially_netted);
   let profit = calc_potential_profit(3_000_000, 20_000).unwrap() as i64;
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc_pre + profit);
   let (_ft, lines) = read_netting_soccer_header_and_lines(&env, &np);
   assert_eq!(lines, vec![(1u8, 400u16, profit, 0)]);
}

#[test]
fn fill_bet_mm_accounts_not_multiple_of_nine() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 103);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 103,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut metas = fill_bet_metas_one_mm(bet, bat, &mid, fill_bet_netting_placeholder());
   metas.pop();
   let mut buf = vec![FILL_BET_IX_DISCRIMINATOR];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::NotEnoughAccountKeys);
}

#[test]
fn fill_bet_duplicate_mm_program_in_tail() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 104);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 104,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut metas = fill_bet_metas_one_mm(bet, bat, &mid, fill_bet_netting_placeholder());
   let tail = metas[FILL_MM_GROUP_OFFSET..].to_vec();
   metas.extend(tail);
   let mut buf = vec![FILL_BET_IX_DISCRIMINATOR];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_bet_pregame_sequence_mismatch() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 105);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 105,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 2,
      event_game_state: EventGameState::zeroed(),
   };
   let ix = fill_bet_instruction(&data, bet, bat, &mid, fill_bet_netting_placeholder());
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_bet_wrong_user_collateral_owner() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 106);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 106,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut metas = fill_bet_metas_one_mm(bet, bat, &mid, fill_bet_netting_placeholder());
   let bad_ata = crate::common::mm_collateral_ata();
   metas[2] = AccountMeta::new(bad_ata, false);
   let mut buf = vec![FILL_BET_IX_DISCRIMINATOR];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::IncorrectAuthority);
}

#[test]
fn fill_bet_wrong_user_collateral_mint() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let wrong_mint_key = Pubkey::new_unique();
   let wrong_mint_acct = token::create_account_for_mint(Mint {
      mint_authority: COption::Some(admin()),
      supply: 0,
      decimals: 6,
      is_initialized: true,
      freeze_authority: COption::None,
   });
   env.upsert(wrong_mint_key, wrong_mint_acct);
   let wrong_ata = get_associated_token_address_with_program_id(&user(), &wrong_mint_key, &token::ID);
   let wrong_tok_acct = token::create_account_for_token_account(SplTokenAccount {
      mint: wrong_mint_key,
      owner: user(),
      amount: 50_000_000_000_000,
      delegate: COption::None,
      state: AccountState::Initialized,
      is_native: COption::None,
      delegated_amount: 0,
      close_authority: COption::None,
   });
   env.upsert(wrong_ata, wrong_tok_acct);

   let bet = bet_pda_for(&user(), 816);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 816,
      market_id: mid,
      side: 0,
      amount: 10_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut metas = fill_bet_metas_one_mm(bet, bat, &mid, fill_bet_netting_placeholder());
   metas[2] = AccountMeta::new(wrong_ata, false);
   let mut buf = vec![FILL_BET_IX_DISCRIMINATOR];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

#[test]
fn fill_bet_with_netting_line_m4() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let mid = spamm_aggregator::state::MarketId {
      event_id: eid,
      player: 0,
      mkt: 4,
      period: 1,
      is_pregame: true,
      operator: crate::common::fixtures::market_operator(),
   };
   let body = crate::common::oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.create_netting_for_soccer_event();
   use spamm_aggregator::instructions::{AddLineToLiabilityNettingIxData, ADD_LINE_TO_LIABILITY_NETTING_IX_LEN};
   let add = AddLineToLiabilityNettingIxData {
      event_id: eid,
      period: 1,
      mkt: 4,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix = env.agg_ix(
      41,
      w.to_vec(),
      add_line_account_metas(crate::common::netting_pda_for_event(&eid)),
   );
   assert!(env.run_ix(ix).program_result.is_ok());
   let np = netting_pda_for_event(&eid);
   let odds = 20_000u32;

   let enc0 = read_encumbrance(&env, &encumbrance_pda());
   let r = run_fill_bet(
      &mut env,
      crate::common::BET_ID_NET_A,
      mid,
      0,
      8_000_000,
      15_000,
      netting_pda_for_event(&eid),
   );
   assert_ok_record_cu("fill_bet/1_mm/netting_m4", &r);
   assert_bet_after_fill(&env, &bet_pda_for(&user(), crate::common::BET_ID_NET_A), 8_000_000, 0);
   let b1 = decode_bet(&env, &bet_pda_for(&user(), crate::common::BET_ID_NET_A));
   assert!(b1.fillers[0].is_potentially_netted);
   let p8 = calc_potential_profit(8_000_000, odds).unwrap() as i64;
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc0 + p8);
   let (_, lines1) = read_netting_soccer_header_and_lines(&env, &np);
   assert_eq!(lines1.len(), 1);
   assert_eq!(lines1[0].0, 1u8);
   assert_eq!(lines1[0].1, 4u16);
   assert_eq!(lines1[0].2, p8);
   assert_eq!(lines1[0].3, 0);
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc0 + p8);

   let enc1 = read_encumbrance(&env, &encumbrance_pda());
   let r2 = run_fill_bet(
      &mut env,
      crate::common::BET_ID_NET_B,
      mid,
      0,
      6_000_000,
      15_000,
      netting_pda_for_event(&eid),
   );
   assert_ok_record_cu("fill_bet/1_mm/netting_m4_accumulate", &r2);
   assert_bet_after_fill(&env, &bet_pda_for(&user(), crate::common::BET_ID_NET_B), 6_000_000, 0);
   let b2 = decode_bet(&env, &bet_pda_for(&user(), crate::common::BET_ID_NET_B));
   assert!(b2.fillers[0].is_potentially_netted);
   let p6 = calc_potential_profit(6_000_000, odds).unwrap() as i64;
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc1 + p6);
   let (_, lines2) = read_netting_soccer_header_and_lines(&env, &np);
   assert_eq!(lines2.len(), 1);
   let o0 = lines2[0].2;
   let o1 = lines2[0].3;
   assert_eq!(o0, p8 + p6);
   assert_eq!(o1, 0);
}

#[test]
fn fill_bet_netting_m4_offset_opposing_sides() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let mid = spamm_aggregator::state::MarketId {
      event_id: eid,
      player: 0,
      mkt: 4,
      period: 1,
      is_pregame: true,
      operator: crate::common::fixtures::market_operator(),
   };
   let body = crate::common::oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.create_netting_for_soccer_event();
   use spamm_aggregator::instructions::{AddLineToLiabilityNettingIxData, ADD_LINE_TO_LIABILITY_NETTING_IX_LEN};
   let add = AddLineToLiabilityNettingIxData {
      event_id: eid,
      period: 1,
      mkt: 4,
   };
   let mut w = [0u8; ADD_LINE_TO_LIABILITY_NETTING_IX_LEN];
   add.write_wire(&mut w).unwrap();
   let ix = env.agg_ix(
      41,
      w.to_vec(),
      add_line_account_metas(crate::common::netting_pda_for_event(&eid)),
   );
   assert!(env.run_ix(ix).program_result.is_ok());

   let np = netting_pda_for_event(&eid);
   let odds = 20_000u32;
   let enc0 = read_encumbrance(&env, &encumbrance_pda());

   let r1 = run_fill_bet(&mut env, 710, mid, 0, 5_000_000, 15_000, netting_pda_for_event(&eid));
   assert!(r1.program_result.is_ok(), "{:?}", r1);
   assert_bet_after_fill(&env, &bet_pda_for(&user(), 710), 5_000_000, 0);
   let b1 = decode_bet(&env, &bet_pda_for(&user(), 710));
   let p5 = calc_potential_profit(5_000_000, odds).unwrap() as i64;
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc0 + p5);
   let (_, lines_after_1) = read_netting_soccer_header_and_lines(&env, &np);
   assert_eq!(lines_after_1[0].2, p5);
   assert_eq!(lines_after_1[0].3, 0);
   assert!(b1.fillers[0].is_potentially_netted);

   let r2 = run_fill_bet(&mut env, 711, mid, 1, 4_000_000, 15_000, netting_pda_for_event(&eid));
   assert_ok_record_cu("fill_bet/1_mm/netting_m4_offset", &r2);
   assert_bet_after_fill(&env, &bet_pda_for(&user(), 711), 4_000_000, 1);
   let b2 = decode_bet(&env, &bet_pda_for(&user(), 711));
   let p4 = calc_potential_profit(4_000_000, odds).unwrap() as i64;
   assert_eq!(
      read_encumbrance(&env, &encumbrance_pda()),
      enc0 + p5,
      "hedge does not raise peak; reserved stays first-side P"
   );
   let (_, lines_after_2) = read_netting_soccer_header_and_lines(&env, &np);
   let o0 = lines_after_2[0].2;
   let o1 = lines_after_2[0].3;
   assert_eq!(o0, p5);
   assert_eq!(o1, p4);
   assert!(b2.fillers[0].is_potentially_netted);
}

#[test]
fn fill_bet_netting_skips_first_half_ml() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let mid = MarketId {
      event_id: eid,
      player: 0,
      mkt: 1,
      period: 2,
      is_pregame: true,
      operator: crate::common::fixtures::market_operator(),
   };
   let body = oracle_body_three_outcome(20_000, 20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.create_netting_for_soccer_event();
   let enc0 = read_encumbrance(&env, &encumbrance_pda());
   let r = run_fill_bet(&mut env, 720, mid, 0, 5_000_000, 15_000, netting_pda_for_event(&eid));
   assert!(r.program_result.is_ok(), "{:?}", r);
   let b = decode_bet(&env, &bet_pda_for(&user(), 720));
   assert!(!b.fillers[0].is_potentially_netted);
   let profit = calc_potential_profit(5_000_000, 20_000).unwrap() as i64;
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc0 + profit);
}

#[test]
fn fill_bet_netting_first_half_ah() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let mid = MarketId {
      event_id: eid,
      player: 0,
      mkt: 400,
      period: 2,
      is_pregame: true,
      operator: crate::common::fixtures::market_operator(),
   };
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.create_netting_for_soccer_event();
   let np = netting_pda_for_event(&eid);
   let enc0 = read_encumbrance(&env, &encumbrance_pda());
   let r = run_fill_bet(&mut env, 722, mid, 0, 5_000_000, 15_000, np);
   assert!(r.program_result.is_ok(), "{:?}", r);
   let b = decode_bet(&env, &bet_pda_for(&user(), 722));
   assert!(b.fillers[0].is_potentially_netted);
   let p = calc_potential_profit(5_000_000, 20_000).unwrap() as i64;
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc0 + p);
   let (_, lines) = read_netting_soccer_header_and_lines(&env, &np);
   assert_eq!(lines.len(), 1);
   assert_eq!(lines[0].0, 2u8);
   assert_eq!(lines[0].1, 400u16);
   assert_eq!(lines[0].2, p);
   assert_eq!(lines[0].3, 0);
}

#[test]
fn fill_bet_netting_skips_player_market() {
   let mut env = Env::new();
   let eid = event_id_soccer();
   let mid = MarketId {
      event_id: eid,
      player: 1,
      mkt: 200,
      period: 1,
      is_pregame: true,
      operator: crate::common::fixtures::market_operator(),
   };
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid, body.as_slice())]);
   env.create_netting_for_soccer_event();
   let enc0 = read_encumbrance(&env, &encumbrance_pda());
   let r = run_fill_bet(&mut env, 721, mid, 0, 5_000_000, 15_000, netting_pda_for_event(&eid));
   assert!(r.program_result.is_ok(), "{:?}", r);
   let b = decode_bet(&env, &bet_pda_for(&user(), 721));
   assert!(!b.fillers[0].is_potentially_netted);
   let profit = calc_potential_profit(5_000_000, 20_000).unwrap() as i64;
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc0 + profit);
}

#[test]
fn fill_bet_amount_zero_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let r = run_fill_bet(&mut env, 800, mid, 0, 0, 15_000, fill_bet_netting_placeholder());
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_bet_amount_below_min_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let r = run_fill_bet(
      &mut env,
      803,
      mid,
      0,
      99_999,
      15_000,
      fill_bet_netting_placeholder(),
   );
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_bet_min_odds_at_scale_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let r = run_fill_bet(
      &mut env,
      801,
      mid,
      0,
      1_000_000,
      ODDS_SCALE as u32,
      fill_bet_netting_placeholder(),
   );
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_bet_side_invalid_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let r = run_fill_bet(&mut env, 802, mid, 3, 1_000_000, 15_000, fill_bet_netting_placeholder());
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_bet_side_two_wrong_mkt_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let r = run_fill_bet(&mut env, 803, mid, 2, 1_000_000, 15_000, fill_bet_netting_placeholder());
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_bet_event_state_sequence_zero_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 804);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 804,
      market_id: mid,
      side: 0,
      amount: 1_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 0,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_bet_instruction(&data, bet, bat, &mid, fill_bet_netting_placeholder()));
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_bet_live_market_sequence_one_rejected() {
   let mut env = Env::new();
   let mut mid_live = market_spread_pregame(event_id_soccer());
   mid_live.is_pregame = false;
   let body = oracle_body_two_outcome(20_000, 20_000);
   let _ = env.bootstrap_mm_with_markets(&[(mid_live, body.as_slice())]);
   let bet = bet_pda_for(&user(), 805);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 805,
      market_id: mid_live,
      side: 0,
      amount: 1_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let r = env.run_ix(fill_bet_instruction(&data, bet, bat, &mid_live, fill_bet_netting_placeholder()));
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_bet_no_mm_accounts_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 806);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 806,
      market_id: mid,
      side: 0,
      amount: 1_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut buf = vec![FILL_BET_IX_DISCRIMINATOR];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let sys = mollusk_svm::program::keyed_account_for_system_program().0;
   let tok = mollusk_svm_programs_token::token::ID;
   let ata = mollusk_svm_programs_token::associated_token::ID;
   let metas = vec![
      AccountMeta::new(crate::common::bet_feepayer(), true),
      AccountMeta::new_readonly(user(), true),
      AccountMeta::new(crate::common::user_collateral_ata(), false),
      AccountMeta::new(bet, false),
      AccountMeta::new(bat, false),
      AccountMeta::new_readonly(crate::common::config_pda(), false),
      AccountMeta::new_readonly(crate::common::mint_pubkey(), false),
      AccountMeta::new_readonly(tok, false),
         AccountMeta::new_readonly(ata, false),
      AccountMeta::new_readonly(crate::common::rent_sysvar_pubkey(), false),
      AccountMeta::new_readonly(sys, false),
      AccountMeta::new_readonly(solana_sdk_ids::sysvar::instructions::ID, false),
   ];
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::NotEnoughAccountKeys);
}

#[test]
fn fill_bet_too_many_mm_groups_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 807);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 807,
      market_id: mid,
      side: 0,
      amount: 1_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut metas = fill_bet_metas_one_mm(bet, bat, &mid, fill_bet_netting_placeholder());
   let group = metas[FILL_MM_GROUP_OFFSET..FILL_MM_GROUP_OFFSET + FILL_BET_MM_ACCOUNTS].to_vec();
   assert_eq!(MAX_NUMBER_OF_MMS, 5);
   for _ in 0..5 {
      metas.extend(group.clone());
   }
   let mut buf = vec![FILL_BET_IX_DISCRIMINATOR];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::NotEnoughAccountKeys);
}

#[test]
fn fill_bet_truncated_ix_data_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 808);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let ix = solana_instruction::Instruction::new_with_bytes(
      crate::common::agg_program_id(),
      &[FILL_BET_IX_DISCRIMINATOR, 1, 2, 3],
      fill_bet_metas_one_mm(bet, bat, &mid, fill_bet_netting_placeholder()),
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn fill_bet_feepayer_not_signer_rejected() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let bet = bet_pda_for(&user(), 809);
   let bat = bet_token_ata(&bet);
   env.upsert(bet, system_owned_empty());
   env.upsert(bat, system_owned_empty());
   let data = FillBetIxData {
      bet_id: 809,
      market_id: mid,
      side: 0,
      amount: 1_000_000,
      min_odds_scaled: 15_000,
      event_state_sequence: 1,
      event_game_state: EventGameState::zeroed(),
   };
   let mut metas = fill_bet_metas_one_mm(bet, bat, &mid, fill_bet_netting_placeholder());
   metas[0] = AccountMeta::new(crate::common::bet_feepayer(), false);
   let mut buf = vec![FILL_BET_IX_DISCRIMINATOR];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::MissingRequiredSignature);
}

#[test]
fn fill_bet_partial_fill_clips_to_mm_max() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let r = run_fill_bet(
      &mut env,
      880,
      mid,
      0,
      150_000_000,
      15_000,
      fill_bet_netting_placeholder(),
   );
   assert_ok_record_cu("fill_bet/partial", &r);
   let bet = bet_pda_for(&user(), 880);
   let b = decode_bet(&env, &bet);
   assert!(b.amount < 150_000_000, "MM max_amount should clip the request");
   assert_eq!(b.num_fillers, 1);
}

#[test]
fn fill_bet_stub_two_fillers() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let r = run_fill_bet(
      &mut env,
      895,
      mid,
      0,
      1_000_000,
      15_000,
      fill_bet_netting_placeholder(),
   );
   assert!(r.program_result.is_ok(), "{:?}", r);
   let bet = bet_pda_for(&user(), 895);
   let mut bd = decode_bet(&env, &bet);
   let f0 = bd.fillers[0];
   bd.fillers.push(f0);
   let mut header = bd.header;
   header.num_fillers = 2;
   let mut wired = vec![0u8; spamm_aggregator::state::account_bet::bet_account_len(2)];
   spamm_aggregator::state::BetAccountData::write_header_and_fillers(&mut wired, &header, &bd.fillers)
      .expect("two-filler wire");
   let mut acct = env.get_account(&bet).expect("bet").clone();
   acct.data = wired;
   env.upsert(bet, acct);
   assert_eq!(decode_bet(&env, &bet).num_fillers, 2);
}
