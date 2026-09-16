//! Admin patch for per-market `max_amount` (hard stake cap per bet).
//!
//! Accounts **(4)**:
//! 0. `admin` (signer)
//! 1. `config_pda` (readonly)
//! 2. `mm_market_data_pda` (writable)
//! 3. `system_program` (readonly, ignored)
//!
//! Instruction `data`: `market_id` wire (26) + `max_amount` u64 LE.

use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use spamm_aggregator::helpers::verify_signer;
use spamm_aggregator::readers::read_u64_le_unchecked;
use spamm_aggregator::state::MarketId;

use crate::mm_helpers::{verify_market_data_pda, verify_mm_config_auth};
use crate::state::account_oracle::{MAX_AMOUNT_OFFSET, ORACLE_DISCRIMINATOR, ORACLE_SIZE, read_discriminator};

pub const SET_MARKET_MAX_AMOUNT_IX_DISCRIMINATOR: u8 = 14;
const PAYLOAD_LEN: usize = MarketId::WIRE_SIZE + 8;

#[inline(never)]
pub fn process(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
   let [admin, config_pda, mm_market_data_pda, _system] = accounts else {
      log!("set_market_max_amount: accounts mismatch");
      return Err(ProgramError::NotEnoughAccountKeys);
   };

   verify_signer(admin)?;
   verify_mm_config_auth(program_id, admin, config_pda)?;

   if unlikely(data.len() != PAYLOAD_LEN) {
      log!("set_market_max_amount: payload length mismatch");
      return Err(ProgramError::InvalidInstructionData);
   }

   let market_id = MarketId::decode(&data[..MarketId::WIRE_SIZE])
      .ok_or(ProgramError::InvalidInstructionData)?;
   let max_amount = unsafe { read_u64_le_unchecked(data.as_ptr(), MarketId::WIRE_SIZE) };

   verify_market_data_pda(mm_market_data_pda, program_id, &market_id)?;

   if unlikely(mm_market_data_pda.data_len() != ORACLE_SIZE as usize) {
      log!("set_market_max_amount: market data wrong length");
      return Err(ProgramError::InvalidAccountData);
   }

   unsafe {
      if read_discriminator(mm_market_data_pda.data_ptr()) != ORACLE_DISCRIMINATOR {
         return Err(ProgramError::InvalidAccountData);
      }
      core::ptr::write_unaligned(
         mm_market_data_pda.data_mut_ptr().add(MAX_AMOUNT_OFFSET) as *mut u64,
         max_amount,
      );
   }

   Ok(())
}
