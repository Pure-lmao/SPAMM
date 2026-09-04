//! brine-ed25519 verification for RFQ quote signatures.

use pinocchio::{error::ProgramError, hint::unlikely, Address};
use pinocchio_log::log;

use brine_ed25519::verify;

use crate::errors::SpammError;

/// Verify an ed25519 signature over `message` using the MM config `rfq_signer` pubkey.
#[inline(never)]
pub fn verify_rfq_ed25519_signature(
   rfq_signer: &Address,
   signature: &[u8; 64],
   message: &[u8],
) -> Result<(), ProgramError> {
   if unlikely(message.is_empty()) {
      log!("verify_rfq_ed25519_signature: empty message");
      return Err(ProgramError::InvalidInstructionData);
   }
   verify(rfq_signer, signature, &[message]).map_err(|_| {
      log!("verify_rfq_ed25519_signature: signature invalid");
      SpammError::InvalidRfqSignature.into()
   })
}
