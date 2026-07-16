//! TxLINE (txoracle) CPI helpers for on-chain score stat validation.

use pinocchio::{
   AccountView, Address, ProgramResult,
   address::address_eq,
   cpi::invoke,
   error::ProgramError,
   hint::unlikely,
   instruction::{InstructionAccount, InstructionView},
};

use pinocchio_log::log;

use crate::{readers::{read_i32_le_unchecked, read_u8_unchecked, read_u32_le_unchecked}, state::Sport};

// /// TxLINE program (mainnet). Mainnet: `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`.
// pub const TXLINE_PROGRAM_ID: Address = Address::new_from_array([
//    0x7a, 0x70, 0xe8, 0x90, 0x67, 0xf3, 0x23, 0x97, 0x2a, 0x7c, 0xa9, 0xce, 0x81, 0x00, 0x3e, 0x1b,
//    0xe5, 0xbc, 0xf5, 0x68, 0xd8, 0x72, 0x86, 0xa3, 0x32, 0xda, 0x3b, 0x7a, 0x81, 0x92, 0x0d, 0xd3,
// ]);
/// TxLINE program (devnet): 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
pub const TXLINE_PROGRAM_ID: Address = Address::new_from_array([
   0x56, 0x75, 0x9f, 0x2c, 0x90, 0x5f, 0x78, 0x60, 0xc8, 0x63, 0x77, 0x14, 0xbf, 0x24, 0x91, 0x30,
   0x9d, 0xc0, 0x71, 0x81, 0x51, 0x3f, 0x7a, 0x24, 0xbf, 0x3e, 0xda, 0xf8, 0x7f, 0x77, 0x50, 0x03,
]);

/// Anchor `validate_stat` instruction discriminator (IDL v1.4.7).
pub const VALIDATE_STAT_IX_DISCRIMINATOR: [u8; 8] =
   [107, 197, 232, 90, 191, 136, 105, 185];

const DAILY_SCORES_ROOTS_SEED: &[u8] = b"daily_scores_roots";
const MS_PER_DAY: u64 = 86_400_000;
const ANCHOR_IX_DISCRIMINATOR_LEN: usize = 8;

/// Minimum Borsh payload length needed for the header fields: `ts` + `fixtureId`.
const VALIDATE_STAT_MIN_PAYLOAD_LEN: usize = 8 + 8;

#[inline(always)]
pub fn verify_txline_program(program: &AccountView) -> ProgramResult {
   if unlikely(!address_eq(program.address(), &TXLINE_PROGRAM_ID)) {
      log!("txline: program id mismatch");
      return Err(ProgramError::IncorrectProgramId);
   }
   if unlikely(!program.executable()) {
      log!("txline: program not executable");
      return Err(ProgramError::InvalidAccountData);
   }
   Ok(())
}

#[inline(always)]
fn epoch_day_from_ts_ms(ts_ms: i64) -> u16 {
   let day = (ts_ms as u64) / MS_PER_DAY;
   day.min(u16::MAX as u64) as u16
}


/// Parsed header fields from a TxLINE `validate_stat` anchor instruction.
pub struct ValidateStatIxHeader {
   pub ts_ms: i64,
   pub fixture_id: u64,
}

/// Decode `ts` and `fixtureId` from the start of a full `validate_stat` ix.
pub fn parse_validate_stat_ix_header(data: &[u8]) -> Result<ValidateStatIxHeader, ProgramError> {
   if unlikely(data.len() < ANCHOR_IX_DISCRIMINATOR_LEN + VALIDATE_STAT_MIN_PAYLOAD_LEN) {
      log!("txline: validate_stat ix too short");
      return Err(ProgramError::InvalidInstructionData);
   }
   if unlikely(data[..ANCHOR_IX_DISCRIMINATOR_LEN] != VALIDATE_STAT_IX_DISCRIMINATOR) {
      log!("txline: validate_stat discriminator mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }

   let payload = &data[ANCHOR_IX_DISCRIMINATOR_LEN..];
   let ts_ms = i64::from_le_bytes([payload[0], payload[1], payload[2], payload[3], payload[4], payload[5], payload[6], payload[7]]);
   let fixture_id_i64 = i64::from_le_bytes([payload[8], payload[9], payload[10], payload[11], payload[12], payload[13], payload[14], payload[15]]);
   if unlikely(fixture_id_i64 < 0) {
      log!("txline: negative fixture id");
      return Err(ProgramError::InvalidInstructionData);
   }

   Ok(ValidateStatIxHeader {
      ts_ms,
      fixture_id: fixture_id_i64 as u64,
   })
}

pub fn verify_daily_scores_roots_pda(
   daily_scores_roots: &AccountView,
   ts_ms: i64,
) -> ProgramResult {
   let epoch_day = epoch_day_from_ts_ms(ts_ms);
   let epoch_day_bytes = epoch_day.to_le_bytes();
   let seeds = [DAILY_SCORES_ROOTS_SEED, epoch_day_bytes.as_slice()];
   let (expected, _bump) = Address::find_program_address(&seeds, &TXLINE_PROGRAM_ID);
   if unlikely(!address_eq(daily_scores_roots.address(), &expected)) {
      log!("txline: daily_scores_roots pda mismatch");
      return Err(ProgramError::InvalidSeeds);
   }
   Ok(())
}

/// CPI into TxLINE `validate_stat`. Instruction `data` must be the full anchor-encoded ix.
pub fn cpi_validate_stat(
   txline_program: &AccountView,
   daily_scores_roots: &AccountView,
   validate_stat_ix_data: &[u8],
) -> ProgramResult {
   verify_txline_program(txline_program)?;

   let header = parse_validate_stat_ix_header(validate_stat_ix_data)?;
   verify_daily_scores_roots_pda(daily_scores_roots, header.ts_ms)?;

   let ix_accounts = [InstructionAccount::new(daily_scores_roots.address(), false, false)];
   let ix = InstructionView {
      program_id: txline_program.address(),
      accounts: &ix_accounts,
      data: validate_stat_ix_data,
   };
   invoke(
      &ix,
      &[daily_scores_roots.as_ref()],
   )
}



/// Borsh `Comparison` discriminants (matches SDK `Comparison`).
pub const CMP_GT: u8 = 0;
pub const CMP_LT: u8 = 1;
pub const CMP_EQ: u8 = 2;

/// Borsh `BinaryExpression` discriminants (matches SDK `BinaryExpression`).
pub const OP_ADD: u8 = 0;
pub const OP_SUB: u8 = 1;

/// Parsed score stats + trader predicate from settle_with_tx_line ix bytes.
///
/// `data` points at the settle payload start: `expected_result (u8)` then full
/// Anchor `validate_stat` ix (`disc` + Borsh body).
pub struct ExtractedMarketData {
   pub key_a: u32,
   pub value_a: i32,
   pub period_a: i32,
   pub key_b: Option<u32>,
   pub value_b: Option<i32>,
   pub period_b: Option<i32>,
   pub pred_threshold: i32,
   pub pred_comparison: u8,
   pub op: Option<u8>,
}

/// Layout after `expected_result` + Anchor disc:
/// `ts(8) + fixtureId(8) + updateCount(4) + minTs(8) + maxTs(8) + eventsRoot(32)`
/// then `fixtureProof` vec.
const FIRST_VEC_OFFSET: usize = 1 + 8 + 8 + 8 + 4 + 8 + 8 + 32;

pub fn extract_market_data(data: *const u8) -> ExtractedMarketData {
   let first_vec_size = unsafe { read_u32_le_unchecked(data, FIRST_VEC_OFFSET) } as usize;
   let second_vec_offset = FIRST_VEC_OFFSET + 4 + first_vec_size * 33;
   let second_vec_size = unsafe { read_u32_le_unchecked(data, second_vec_offset) } as usize;
   // After mainTreeProof: predicate { threshold:i32, comparison:u8 }
   let pred_offset = second_vec_offset + 4 + second_vec_size * 33;
   let pred_threshold = unsafe { read_i32_le_unchecked(data, pred_offset) };
   let pred_comparison = unsafe { read_u8_unchecked(data, pred_offset + 4) };
   let score_stat_offset = pred_offset + 4 + 1;

   let key_a = unsafe { read_u32_le_unchecked(data, score_stat_offset) };
   let value_a = unsafe { read_i32_le_unchecked(data, score_stat_offset + 4) };
   let period_a = unsafe { read_i32_le_unchecked(data, score_stat_offset + 8) };

   let stat_a_vec_offset = score_stat_offset + 4 + 4 + 4 + 32;
   let stat_a_vec_size = unsafe { read_u32_le_unchecked(data, stat_a_vec_offset) } as usize;
   let stat_b_offset = stat_a_vec_offset + 4 + stat_a_vec_size * 33;
   let stat_b_is_some = unsafe { read_u8_unchecked(data, stat_b_offset) } != 0;

   let (key_b, value_b, period_b, op_offset) = if stat_b_is_some {
      let key_b = unsafe { read_u32_le_unchecked(data, stat_b_offset + 1) };
      let value_b = unsafe { read_i32_le_unchecked(data, stat_b_offset + 5) };
      let period_b = unsafe { read_i32_le_unchecked(data, stat_b_offset + 9) };
      let stat_b_vec_offset = stat_b_offset + 1 + 4 + 4 + 4 + 32;
      let stat_b_vec_size = unsafe { read_u32_le_unchecked(data, stat_b_vec_offset) } as usize;
      (
         Some(key_b),
         Some(value_b),
         Some(period_b),
         stat_b_vec_offset + 4 + stat_b_vec_size * 33,
      )
   } else {
      (None, None, None, stat_b_offset + 1)
   };

   let op_is_some = unsafe { read_u8_unchecked(data, op_offset) } != 0;
   let op = if op_is_some {
      Some(unsafe { read_u8_unchecked(data, op_offset + 1) })
   } else {
      None
   };

   ExtractedMarketData {
      key_a,
      value_a,
      period_a,
      key_b,
      value_b,
      period_b,
      pred_threshold,
      pred_comparison,
      op,
   }
}

#[inline(always)]
pub fn predicate_matches(
   extracted: &ExtractedMarketData,
   threshold: i32,
   comparison: u8,
   op: Option<u8>,
) -> bool {
   extracted.pred_threshold == threshold
      && extracted.pred_comparison == comparison
      && extracted.op == op
}

pub fn get_required_keys(_mkt: u16, sport: Sport) -> (u32, u32) {
   if sport == Sport::Soccer {
      return (1, 2);
      //only deal with goal-based markets for now
      // match mkt {
      //    1 => (1, 2),
      //    5 => (1, 2),
      //    _ => (0, 0),
      // }
   } else {
      return (99, 99); // error anything else for now
      // match mkt {
      //    1 => (1, 2),
      //    5 => (1, 2),
      //    _ => (0, 0),
      // }
   }
}


pub fn get_required_period(period: u8, sport: Sport) -> i32 {
   if sport == Sport::Soccer {
      match period {
         0 => 100, // final result
         1 => 5, //FT => End after FT
         2 => 3, //HT => End after HT
         _ => 99, // error anything else for now
      }
   } else {
      return 99; // error anything else for now
      // match period {
      //    0 => 100,
      //    2 => 2,
      //    _ => 99,
      // }
   }
}

// struct CpiIxData {
//    ts_ms: u64,
//    fixture_summary: ScoreBatchSummary,
//    fixture_proof: Vec<ProofNode>,
//    main_proof: Vec<ProofNode>,
//    predicate: TradePredicate,
//    stat_a: StatTerm,
//    stat_b: Option<StatTerm>,
//    operation: Option<BinaryExpression>
// }

// enum BinaryExpression {
//    Add,
//    Subtract,
// }

// enum ComparisonOperator {
//   GreaterThan,
//   LessThan,
//   EqualTo
// }

// struct ScoreBatchSummary {
//    fixture_id: i64,
//    update_status: {
//       update_count: i32,
//       min_ts: i64,
//       max_ts: i64,
//    },
//    event_sub_tree_root: [u8; 32],
// }

// struct TradePredicate {
//    threshold: i32,
//    comparison: ComparisonOperator,
// }

// struct StatTerm {
//    stat_to_prove: ScoreState,
//    event_stat_root: [u8; 32],
//    stat_proof: Vec<ProofNode>,
// }

// struct ScoreState {
//    key: u32,
//    value: i32,
//    period: i32,
// }

// struct ProofNode {
//    hash: [u8; 32],
//    is_right_sibling: bool,
// }