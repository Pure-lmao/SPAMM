//! brine-ed25519 verification for RFQ quote signatures.

use pinocchio::{error::ProgramError, hint::unlikely, Address};
use pinocchio_log::log;

use brine_ed25519::hasher::Sha512;
use brine_ed25519::verify;

/// Verify an ed25519 signature over `message` using the MM config `rfq_signer` pubkey.
#[inline(always)]
pub fn verify_rfq_ed25519_signature(
   rfq_signer: &Address,
   signature: &[u8; 64],
   message: &[u8],
) -> Result<(), ProgramError> {
   if unlikely(message.is_empty()) {
      log!("verify_rfq_ed25519_signature: empty message");
      return Err(ProgramError::InvalidInstructionData);
   }
   verify::<Sha512>(rfq_signer.as_array(), signature, &[message]).map_err(|_| {
      log!("verify_rfq_ed25519_signature: signature invalid");
      ProgramError::InvalidInstructionData
   })
}
