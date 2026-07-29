use core::result::Result;

use pinocchio::{Address, error::ProgramError};

/// Bytes after the router `u8` in `spamm_market_maker::lib.rs` (not including that discriminator).
pub const INIT_PROGRAM_IX_DATA_LEN: usize = 64;

/// Wire layout (minus the outer instruction discriminator):
/// - `admin: [u8; 32]`
/// - `rfq_signer: [u8; 32]`
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
      let mut admin = [0u8; 32];
      let mut rfq_signer = [0u8; 32];
      admin.copy_from_slice(&data[..32]);
      rfq_signer.copy_from_slice(&data[32..64]);
      Ok(Self {
         admin: Address::new_from_array(admin),
         rfq_signer: Address::new_from_array(rfq_signer),
      })
   }
}
