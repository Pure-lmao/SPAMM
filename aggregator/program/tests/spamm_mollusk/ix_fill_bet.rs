//! `fill_bet` coverage (success + representative failures).

use solana_instruction::AccountMeta;
use solana_program_error::ProgramError;
use solana_program_option::COption;
use mollusk_svm_programs_token::token;
use solana_pubkey::Pubkey;
use spl_associated_token_account_interface::address::get_associated_token_address_with_program_id;
use spl_token_interface::state::{Account as SplTokenAccount, AccountState, Mint};

use spamm_aggregator::constants::{MAX_NUMBER_OF_MMS, ODDS_SCALE};
use spamm_aggregator::helpers::calc_potential_profit;
use spamm_aggregator::instructions::FillBetIxData;
use spamm_aggregator::state::EventGameState;
use crate::common::{
   admin, assert_bet_after_fill, assert_fill_bet_single_mm_economics, assert_ok_record_cu, assert_program_err,
   bet_pda_for, bet_token_ata, config_pda, decode_bet, encumbrance_pda, event_id_soccer, fill_bet_instruction,
   fill_bet_metas_one_mm, fill_bet_netting_placeholder, market_spread_pregame, mm_program_id, netting_pda_for_event,
   oracle_body_two_outcome, read_encumbrance, read_netting_soccer_header_and_lines, read_token_balance,
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
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

/// MM quotes below `min_odds_scaled`: every MM iteration `continue`s → `filled_amount == 0` → `InvalidInstructionData`.
#[test]
fn fill_bet_min_odds_too_high_no_fill() {
   let mut env = Env::new();
   env.bootstrap_default_mm_spread();
   let mid = market_spread_pregame(event_id_soccer());
   let r = run_fill_bet(&mut env, 101, mid, 0, 10_000_000, 500_000_000, fill_bet_netting_placeholder());
   assert_program_err(&r, ProgramError::InvalidInstructionData);
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
   let mut buf = vec![3u8];
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
   let mut buf = vec![3u8];
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
   let mut buf = vec![3u8];
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
   let tail = metas[11..].to_vec();
   metas.extend(tail);
   let mut buf = vec![3u8];
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
   let mut buf = vec![3u8];
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
   let mut buf = vec![3u8];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidAccountData);
}

fn max2_onchain(a: i64, b: i64) -> i64 {
   let best = if a > b { a } else { b };
   if best > 0 {
      best
   } else {
      0
   }
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
      51,
      w.to_vec(),
      vec![
         AccountMeta::new(crate::common::mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(crate::common::mm_config_pda(), false),
         AccountMeta::new(crate::common::netting_pda_for_event(&eid), false),
      ],
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
   assert!(b1.filler_0.is_potentially_netted);
   let p8 = calc_potential_profit(8_000_000, odds).unwrap() as i64;
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc0 + b1.filler_0.encumbrance_delta);
   let (_, lines1) = read_netting_soccer_header_and_lines(&env, &np);
   assert_eq!(lines1.len(), 1);
   assert_eq!(lines1[0].0, 1u8);
   assert_eq!(lines1[0].1, 4u16);
   assert_eq!(lines1[0].2, p8);
   assert_eq!(lines1[0].3, -8_000_000i64);
   let net1 = max2_onchain(lines1[0].2, lines1[0].3);
   assert_eq!(b1.filler_0.encumbrance_delta, net1);

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
   assert!(b2.filler_0.is_potentially_netted);
   let p6 = calc_potential_profit(6_000_000, odds).unwrap() as i64;
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc1 + b2.filler_0.encumbrance_delta);
   let (_, lines2) = read_netting_soccer_header_and_lines(&env, &np);
   assert_eq!(lines2.len(), 1);
   let o0 = lines2[0].2;
   let o1 = lines2[0].3;
   assert_eq!(o0, p8 + p6);
   assert_eq!(o1, -8_000_000i64 - 6_000_000i64);
   let net2 = max2_onchain(o0, o1);
   let old_net = max2_onchain(p8, -8_000_000i64);
   assert_eq!(b2.filler_0.encumbrance_delta, net2 - old_net);
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
      51,
      w.to_vec(),
      vec![
         AccountMeta::new(crate::common::mm_admin(), true),
         AccountMeta::new_readonly(mm_program_id(), false),
         AccountMeta::new_readonly(crate::common::mm_config_pda(), false),
         AccountMeta::new(crate::common::netting_pda_for_event(&eid), false),
      ],
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
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc0 + b1.filler_0.encumbrance_delta);
   let (_, lines_after_1) = read_netting_soccer_header_and_lines(&env, &np);
   let net_after_1 = max2_onchain(lines_after_1[0].2, lines_after_1[0].3);
   assert_eq!(lines_after_1[0].2, p5);
   assert_eq!(lines_after_1[0].3, -5_000_000i64);
   assert_eq!(b1.filler_0.encumbrance_delta, net_after_1);

   let enc1 = read_encumbrance(&env, &encumbrance_pda());
   let r2 = run_fill_bet(&mut env, 711, mid, 1, 4_000_000, 15_000, netting_pda_for_event(&eid));
   assert_ok_record_cu("fill_bet/1_mm/netting_m4_offset", &r2);
   assert_bet_after_fill(&env, &bet_pda_for(&user(), 711), 4_000_000, 1);
   let b2 = decode_bet(&env, &bet_pda_for(&user(), 711));
   let p4 = calc_potential_profit(4_000_000, odds).unwrap() as i64;
   assert_eq!(read_encumbrance(&env, &encumbrance_pda()), enc1 + b2.filler_0.encumbrance_delta);
   let (_, lines_after_2) = read_netting_soccer_header_and_lines(&env, &np);
   let o0 = lines_after_2[0].2;
   let o1 = lines_after_2[0].3;
   assert_eq!(o0, p5 - 4_000_000i64);
   assert_eq!(o1, -5_000_000i64 + p4);
   let net_after_2 = max2_onchain(o0, o1);
   assert_eq!(b2.filler_0.encumbrance_delta, net_after_2 - net_after_1);
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
   let mut buf = vec![3u8];
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
   let group = metas[11..20].to_vec();
   assert_eq!(MAX_NUMBER_OF_MMS, 5);
   for _ in 0..5 {
      metas.extend(group.clone());
   }
   let mut buf = vec![3u8];
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
      &[3u8, 1, 2, 3],
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
   let mut buf = vec![3u8];
   let mut pay = [0u8; spamm_aggregator::instructions::FILL_BET_IX_DATA_LEN];
   data.write_wire(&mut pay).unwrap();
   buf.extend_from_slice(&pay);
   let ix = solana_instruction::Instruction::new_with_bytes(crate::common::agg_program_id(), &buf, metas);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::MissingRequiredSignature);
}
