use core::result::Result;

use pinocchio::{Address, error::ProgramError};
use spamm_aggregator::constants::ADDRESS_LEN;
use spamm_aggregator::readers::read_address_unchecked;

/// Bytes after the router `u8` in `spamm_market_maker::lib.rs` (not including that discriminator).
pub const INIT_PROGRAM_IX_DATA_LEN: usize = 2 * ADDRESS_LEN;

/// Wire layout (minus the outer instruction discriminator):
/// - `admin: Address`
/// - `rfq_signer: Address`
#[repr(C)]
pub struct InitProgramIxPayload {
   pub admin: Address,
   pub rfq_signer: Address,
}

impl InitProgramIxPayload {
   pub const WIRE_SIZE: usize = INIT_PROGRAM_IX_DATA_LEN;

   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != Self::WIRE_SIZE {
         return Err(ProgramError::InvalidInstructionData);
      }
      Ok(Self {
         admin: unsafe { read_address_unchecked(data.as_ptr(), 0) },
         rfq_signer: unsafe { read_address_unchecked(data.as_ptr(), ADDRESS_LEN) },
      })
   }
}
