use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

/// `fill_parlay_quote` instruction payload (bytes after the MM router discriminator), matching
/// [`FillParlayQuoteIxData`] minus `instruction_discriminator`.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillParlayQuoteIxPayload {
   pub amount_to_fill: u64,
   pub odds_scaled: u32,
   pub amount_to_send: u64,
}

pub const FILL_QUOTE_PARLAY_IX_PAYLOAD_LEN: usize = <FillParlayQuoteIxPayload as ZeroPodFixed>::SIZE;

impl FillParlayQuoteIxPayload {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != FILL_QUOTE_PARLAY_IX_PAYLOAD_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data).map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         amount_to_fill: zc.amount_to_fill.get(),
         odds_scaled: zc.odds_scaled.get(),
         amount_to_send: zc.amount_to_send.get(),
      })
   }
}
