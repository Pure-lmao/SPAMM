//! `process_instruction` routing: malformed or unknown discriminators.

use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;

use crate::common::{agg_program_id, assert_program_err, Env};

#[test]
fn process_instruction_empty_data_fails() {
   let mut env = Env::new();
   let ix = Instruction::new_with_bytes(agg_program_id(), &[], vec![]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn process_instruction_unknown_discriminator_fails() {
   let mut env = Env::new();
   let ix = Instruction::new_with_bytes(agg_program_id(), &[42u8], vec![]);
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::InvalidInstructionData);
}

#[test]
fn process_instruction_change_config_not_enough_accounts_routes_handler() {
   let mut env = Env::new();
   env.bootstrap_agg_only();
   let ix = Instruction::new_with_bytes(
      agg_program_id(),
      &[1u8, 1u8],
      vec![AccountMeta::new(crate::common::admin(), true)],
   );
   let r = env.run_ix(ix);
   assert_program_err(&r, ProgramError::NotEnoughAccountKeys);
}
