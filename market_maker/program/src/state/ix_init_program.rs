use core::result::Result;

use pinocchio::{Address, error::ProgramError};

/// Bytes after the router `u8` in `spamm_market_maker::lib.rs` (not including that discriminator).
pub const INIT_PROGRAM_IX_DATA_LEN: usize = 32;

/// Wire layout (minus the outer instruction discriminator):
/// - `admin: [u8; 32]`
pub struct InitProgramIxPayload {
   pub admin: Address,
}

impl InitProgramIxPayload {
   pub const WIRE_SIZE: usize = INIT_PROGRAM_IX_DATA_LEN;

   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != Self::WIRE_SIZE {
         return Err(ProgramError::InvalidInstructionData);
      }
      let mut a = [0u8; 32];
      a.copy_from_slice(data);
      Ok(Self {
         admin: Address::new_from_array(a),
      })
   }
}
