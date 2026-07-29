use core::result::Result;

use pinocchio::{Address, error::ProgramError};

pub const SET_RFQ_SIGNER_IX_DATA_LEN: usize = 32;

#[repr(C)]
pub struct SetRfqSignerIxPayload {
   pub rfq_signer: Address,
}

impl SetRfqSignerIxPayload {
   pub const WIRE_SIZE: usize = SET_RFQ_SIGNER_IX_DATA_LEN;

   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != Self::WIRE_SIZE {
         return Err(ProgramError::InvalidInstructionData);
      }
      let mut a = [0u8; 32];
      a.copy_from_slice(data);
      Ok(Self {
         rfq_signer: Address::new_from_array(a),
      })
   }
}
