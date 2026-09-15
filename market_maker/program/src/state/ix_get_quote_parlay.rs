use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

/// Header of `get_quote_parlay` payload (bytes after the MM router discriminator).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
struct GetQuoteParlayIxHeaderPayload {
   amount: u64,
   odds_scaled: u32,
   num_legs: u8,
}

/// Decoded header fields of the `get_quote_parlay` payload.
///
/// Trailing legs are decoded per-slot by the caller (streamed straight into the
/// quoted-leg buffer) to keep the BPF stack frame small — there is deliberately
/// no owned `[ParlayLegSel; MAX_PARLAY_LEGS]` staging buffer.
#[derive(Copy, Clone)]
pub struct GetQuoteParlayIxHeader {
   pub amount: u64,
   pub odds_scaled: u32,
   pub num_legs: u8,
}

impl GetQuoteParlayIxHeader {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() < GET_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <GetQuoteParlayIxHeaderPayload as ZeroPodFixed>::from_bytes(
         &data[..GET_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN],
      )
      .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         amount: zc.amount.get(),
         odds_scaled: zc.odds_scaled.get(),
         num_legs: zc.num_legs,
      })
   }
}

/// Header size of payload (without disc): amount + odds + num_legs.
pub const GET_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN: usize =
   <GetQuoteParlayIxHeaderPayload as ZeroPodFixed>::SIZE;