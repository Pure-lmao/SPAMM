//! Settle a graded bet using a TxLINE Merkle proof instead of a pre-written `BetResult`.
//!
//! The API server calls TxLINE `/api/scores/stat-validation`, builds a `validate_stat`
//! instruction payload, and passes it here. A CPI into TxLINE verifies the proof on-chain;
//! settlement then proceeds like [`super::settle_bet`].
//!
//! For a winning home bet the API proves `home_goals > away_goals` (stat keys 1 and 2).
//! For a losing home bet it proves the opposite (e.g. `home_goals - away_goals < 1`).
//! The proof must always succeed — a failed CPI aborts the whole transaction.
//!
//! Accounts: **same 34 as `settle_bet`**, then:
//! 34. `txline_program` (readonly, executable)
//! 35. `daily_scores_merkle_roots` (readonly) — PDA for the epoch day of proof `ts`
//!
//! Data (after router discriminator `69`):
//! - `expected_result: u8` — [`BetResult`] (must not be `Pending`)
//! - `validate_stat_ix_data: [u8]` — full TxLINE `validate_stat` instruction data

use pinocchio::{AccountView, ProgramResult, cpi::get_return_data, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use solana_address::address_eq;

use crate::{
   state::{BetAccountData, Sport, account_bet::BetResult}, txline::{
      CMP_EQ, CMP_GT, CMP_LT, OP_ADD, OP_SUB, TXLINE_PROGRAM_ID, cpi_validate_stat, extract_market_data, get_required_keys, get_required_period, parse_validate_stat_ix_header, predicate_matches,
   },
};

use super::settle_bet::execute_settlement;

pub const SETTLE_WITH_TX_LINE_IX_DISCRIMINATOR: u8 = 69;

const SETTLE_BET_ACCOUNT_COUNT: usize = 34;
const MIN_DATA_LEN: usize = 1 + 230; // result plus min cpi ix data (with anchor discriminator)

pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   if unlikely(accounts.len() != SETTLE_BET_ACCOUNT_COUNT + 2) {
      log!("settle_with_tx_line: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   }
   if unlikely(data.len() < MIN_DATA_LEN) {
      log!("settle_with_tx_line: data too short");
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(data[0] == 0 || data[0] > 7) {
      log!("settle_with_tx_line: invalid expected result");
      return Err(ProgramError::InvalidInstructionData);
   }
   let expected_result = BetResult::from_u8(data[0]);
   if unlikely(expected_result == BetResult::Pending) {
      log!("settle_with_tx_line: expected result is pending");
      return Err(ProgramError::InvalidInstructionData);
   }

   let bet_account_data = accounts[1].try_borrow()?;
   let bet_data = BetAccountData::decode(bet_account_data.as_ref())?;
   core::mem::drop(bet_account_data);

   if unlikely(bet_data.result != BetResult::Pending) {
      log!("settle_with_tx_line: bet already graded");
      return Err(ProgramError::InvalidInstructionData);
   }

   let validate_stat_ix_data = &data[1..];

   let header = parse_validate_stat_ix_header(validate_stat_ix_data)?;
   if unlikely(bet_data.market_id.event_id.event != header.fixture_id) {
      log!("settle_with_tx_line: fixture id mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }

   // validate bet type to stat key and period
   let extracted = extract_market_data(data.as_ptr());
   let value_a = extracted.value_a;
   let value_b = match extracted.value_b {
      Some(v) => v,
      None => {
         log!("settle_with_tx_line: value_b is none");
         return Err(ProgramError::InvalidInstructionData);
      }
   };

   let (required_key_a, required_key_b) =
      get_required_keys(bet_data.market_id.mkt, bet_data.market_id.event_id.sport);
   let required_period =
      get_required_period(bet_data.market_id.period, bet_data.market_id.event_id.sport);

   if unlikely(extracted.period_a != required_period && required_period != 99) {
      log!(
         "settle_with_tx_line: period a mismatch. bet period: {}, proof period: {}, required period: {}",
         bet_data.market_id.period,
         extracted.period_a,
         required_period
      );
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(
      extracted.period_b.is_some()
         && extracted.period_b.unwrap() != required_period
         && required_period != 99
   ) {
      log!(
         "settle_with_tx_line: period b mismatch. bet period: {}, proof period: {}, required period: {}",
         bet_data.market_id.period,
         extracted.period_b.unwrap(),
         required_period
      );
      return Err(ProgramError::InvalidInstructionData);
   }

   if unlikely(extracted.key_a != required_key_a && required_key_a != 99) {
      log!(
         "settle_with_tx_line: key a mismatch. bet key: {}, proof key: {}, required key: {}",
         bet_data.market_id.mkt,
         extracted.key_a,
         required_key_a
      );
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(
      extracted.key_b.is_some()
         && extracted.key_b.unwrap() != required_key_b
         && required_key_b != 99
   ) {
      log!(
         "settle_with_tx_line: key b mismatch. bet key: {}, proof key: {}, required key: {}",
         bet_data.market_id.mkt,
         extracted.key_b.unwrap(),
         required_key_b
      );
      return Err(ProgramError::InvalidInstructionData);
   }

   match bet_data.market_id.event_id.sport {
      Sport::Soccer => {
         match bet_data.market_id.mkt {
            1 => {
               // 1X2 — prove home - away vs threshold (op = Subtract)
               if bet_data.side == 0 {
                  // home win
                  if expected_result == BetResult::Won {
                     // home > away: SUB GT 0
                     if value_a > value_b
                        && predicate_matches(&extracted, 0, CMP_GT, Some(OP_SUB))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else if expected_result == BetResult::Lost {
                     // home <= away: SUB LT 1
                     if !(value_a > value_b)
                        && predicate_matches(&extracted, 1, CMP_LT, Some(OP_SUB))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else {
                     log!(
                        "settle_with_tx_line: invalid expected result. expected result: {}",
                        data[0]
                     );
                     return Err(ProgramError::InvalidInstructionData);
                  }
               } else if bet_data.side == 1 {
                  // away win
                  if expected_result == BetResult::Won {
                     // away > home ⟺ home - away < 0: SUB LT 0
                     if value_b > value_a
                        && predicate_matches(&extracted, 0, CMP_LT, Some(OP_SUB))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else if expected_result == BetResult::Lost {
                     // away <= home ⟺ home - away > -1: SUB GT -1
                     if !(value_b > value_a)
                        && predicate_matches(&extracted, -1, CMP_GT, Some(OP_SUB))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else {
                     log!(
                        "settle_with_tx_line: invalid expected result. expected result: {}",
                        data[0]
                     );
                     return Err(ProgramError::InvalidInstructionData);
                  }
               } else if bet_data.side == 2 {
                  // draw
                  if expected_result == BetResult::Won {
                     // home == away: SUB EQ 0
                     if value_a == value_b
                        && predicate_matches(&extracted, 0, CMP_EQ, Some(OP_SUB))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else if expected_result == BetResult::Lost {
                     // home != away: SUB GT 0 or SUB LT 0
                     if value_a != value_b
                        && (predicate_matches(&extracted, 0, CMP_GT, Some(OP_SUB))
                           || predicate_matches(&extracted, 0, CMP_LT, Some(OP_SUB)))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else {
                     log!(
                        "settle_with_tx_line: invalid expected result. expected result: {}",
                        data[0]
                     );
                     return Err(ProgramError::InvalidInstructionData);
                  }
               } else {
                  log!("settle_with_tx_line: invalid side. bet side: {}", bet_data.side);
                  return Err(ProgramError::InvalidInstructionData);
               }
            }
            (51..=99) => {
               // ou (x.25) — prove home + away vs line (op = Add)
               let total_goals_mul_4 = (value_a + value_b) * 4;
               let needed_goals_mul_4 = (bet_data.market_id.mkt - 50) as i32;
               let line_floor = needed_goals_mul_4 / 4;
               let line_ceil = (needed_goals_mul_4 + 3) / 4;
               if bet_data.side == 0 {
                  // over
                  if expected_result == BetResult::Won {
                     // total > line: ADD GT floor(line)
                     if total_goals_mul_4 > needed_goals_mul_4
                        && predicate_matches(&extracted, line_floor, CMP_GT, Some(OP_ADD))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else if expected_result == BetResult::Lost {
                     // total < line: ADD LT ceil(line)
                     if total_goals_mul_4 < needed_goals_mul_4
                        && predicate_matches(&extracted, line_ceil, CMP_LT, Some(OP_ADD))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else if expected_result == BetResult::Push {
                     // total == line (x.0 only): ADD EQ line
                     if total_goals_mul_4 == needed_goals_mul_4
                        && needed_goals_mul_4 % 4 == 0
                        && predicate_matches(&extracted, line_floor, CMP_EQ, Some(OP_ADD))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else {
                     log!(
                        "settle_with_tx_line: invalid expected result. expected result: {}",
                        data[0]
                     );
                     return Err(ProgramError::InvalidInstructionData);
                  }
               } else if bet_data.side == 1 {
                  // under
                  if expected_result == BetResult::Won {
                     if total_goals_mul_4 < needed_goals_mul_4
                        && predicate_matches(&extracted, line_ceil, CMP_LT, Some(OP_ADD))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else if expected_result == BetResult::Lost {
                     if total_goals_mul_4 > needed_goals_mul_4
                        && predicate_matches(&extracted, line_floor, CMP_GT, Some(OP_ADD))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else if expected_result == BetResult::Push {
                     if total_goals_mul_4 == needed_goals_mul_4
                        && needed_goals_mul_4 % 4 == 0
                        && predicate_matches(&extracted, line_floor, CMP_EQ, Some(OP_ADD))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else {
                     log!(
                        "settle_with_tx_line: invalid expected result. expected result: {}",
                        data[0]
                     );
                     return Err(ProgramError::InvalidInstructionData);
                  }
               } else {
                  log!("settle_with_tx_line: invalid side. bet side: {}", bet_data.side);
                  return Err(ProgramError::InvalidInstructionData);
               }
            }
            (300..=499) => {
               // ah (x.25) — prove home - away vs -line (op = Subtract)
               // home covers when (home - away) > -line
               let home_line_mul_4 = bet_data.market_id.mkt as i32 - 400;
               let home_dom_mul_4 = (value_a - value_b) * 4;
               let neg_line_mul_4 = -home_line_mul_4;
               // integer X > real B  ⟺  X > floor(B)   with CMP_GT threshold = floor(B)
               // integer X < real B  ⟺  X < ceil(B)    with CMP_LT threshold = ceil(B)
               let neg_line_floor = div_floor_i32(neg_line_mul_4, 4);
               let neg_line_ceil = div_ceil_i32(neg_line_mul_4, 4);
               if bet_data.side == 0 {
                  // home
                  if expected_result == BetResult::Won {
                     if home_dom_mul_4 > neg_line_mul_4
                        && predicate_matches(&extracted, neg_line_floor, CMP_GT, Some(OP_SUB))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else if expected_result == BetResult::Lost {
                     if home_dom_mul_4 < neg_line_mul_4
                        && predicate_matches(&extracted, neg_line_ceil, CMP_LT, Some(OP_SUB))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else if expected_result == BetResult::Push {
                     if home_dom_mul_4 == neg_line_mul_4
                        && home_line_mul_4 % 4 == 0
                        && predicate_matches(&extracted, neg_line_floor, CMP_EQ, Some(OP_SUB))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else {
                     log!(
                        "settle_with_tx_line: invalid expected result. expected result: {}",
                        data[0]
                     );
                     return Err(ProgramError::InvalidInstructionData);
                  }
               } else if bet_data.side == 1 {
                  // away
                  if expected_result == BetResult::Won {
                     if home_dom_mul_4 < neg_line_mul_4
                        && predicate_matches(&extracted, neg_line_ceil, CMP_LT, Some(OP_SUB))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else if expected_result == BetResult::Lost {
                     if home_dom_mul_4 > neg_line_mul_4
                        && predicate_matches(&extracted, neg_line_floor, CMP_GT, Some(OP_SUB))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else if expected_result == BetResult::Push {
                     if home_dom_mul_4 == neg_line_mul_4
                        && home_line_mul_4 % 4 == 0
                        && predicate_matches(&extracted, neg_line_floor, CMP_EQ, Some(OP_SUB))
                     {
                        validate_cpi_and_execute_settlement(
                           accounts,
                           expected_result,
                           validate_stat_ix_data,
                        )
                     } else {
                        log!(
                           "settle_with_tx_line: values/predicate dont match expected. value a: {}, value b: {}, pred: {} {}",
                           value_a,
                           value_b,
                           extracted.pred_threshold,
                           extracted.pred_comparison
                        );
                        return Err(ProgramError::InvalidInstructionData);
                     }
                  } else {
                     log!(
                        "settle_with_tx_line: invalid expected result. expected result: {}",
                        data[0]
                     );
                     return Err(ProgramError::InvalidInstructionData);
                  }
               } else {
                  log!("settle_with_tx_line: invalid side. bet side: {}", bet_data.side);
                  return Err(ProgramError::InvalidInstructionData);
               }
            }
            _ => {
               log!(
                  "settle_with_tx_line: invalid market id. bet market id: {}",
                  bet_data.market_id.mkt
               );
               return Err(ProgramError::InvalidInstructionData);
            }
         }
      }
      // error other sports for now
      _ => {
         return Err(ProgramError::InvalidInstructionData);
      }
   }
}

#[inline(always)]
fn div_floor_i32(n: i32, d: i32) -> i32 {
   if n >= 0 {
      n / d
   } else {
      // floor toward -inf for negative n, positive d
      let q = n / d;
      if n % d == 0 {
         q
      } else {
         q - 1
      }
   }
}

#[inline(always)]
fn div_ceil_i32(n: i32, d: i32) -> i32 {
   if n >= 0 {
      (n + d - 1) / d
   } else {
      // ceil toward +inf: trunc toward zero is already ceil for negative non-multiples? 
      // n=-2,d=4: trunc=0 = ceil(-0.5). n=-5,d=4: trunc=-1 = ceil(-1.25). OK.
      n / d
   }
}

fn validate_cpi_and_execute_settlement(
   accounts: &mut [AccountView],
   expected_result: BetResult,
   validate_stat_ix_data: &[u8],
) -> ProgramResult {
   let (settle_accounts, txline_accounts) = accounts.split_at_mut(SETTLE_BET_ACCOUNT_COUNT);
   cpi_validate_stat(
      &txline_accounts[0],
      &txline_accounts[1],
      validate_stat_ix_data,
   )?;
   
   let return_data = get_return_data();
   if return_data.is_none() {
      log!("settle_with_tx_line: no return data");
      return Err(ProgramError::InvalidInstructionData);
   }

   let return_data = return_data.unwrap();
   if !address_eq(return_data.program_id(), &TXLINE_PROGRAM_ID) {
      log!("settle_with_tx_line: return data is not from the txline program");
      return Err(ProgramError::InvalidInstructionData);
   }

   if return_data.as_slice() != [1] {
      log!("settle_with_tx_line: return data is not a success: {}", return_data.as_slice());
      return Err(ProgramError::InvalidInstructionData);
   }

   execute_settlement(settle_accounts, Some(expected_result))
}
