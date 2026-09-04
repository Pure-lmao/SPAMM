use pinocchio::error::ProgramError;
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

use spamm_aggregator::{
   constants::MAX_PARLAY_LEGS,
   state::{
      decode_trailing_parlay_leg_sels, empty_parlay_leg_sel_buf, ParlayLegSel, PARLAY_LEG_SEL_LEN,
   },
};

/// Header of `get_quote_parlay` payload (bytes after the MM router discriminator).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
struct GetQuoteParlayIxHeaderPayload {
   amount: u64,
   odds_scaled: u32,
   num_legs: u8,
}

/// `get_quote_parlay` instruction payload (bytes after the MM router discriminator).
/// Layout matches [`GetQuoteParlayIxData`] minus the leading instruction discriminator.
#[derive(Copy, Clone)]
pub struct GetQuoteParlayIxPayload {
   pub amount: u64,
   pub odds_scaled: u32,
   pub num_legs: u8,
   pub legs: [ParlayLegSel; MAX_PARLAY_LEGS],
}

impl GetQuoteParlayIxPayload {
   #[inline(always)]
   pub fn live_legs(&self) -> &[ParlayLegSel] {
      &self.legs[..self.num_legs as usize]
   }

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() < GET_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN {
         log!(
            "get_quote_parlay: ix payload len mismatch got {}",
            data.len()
         );
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <GetQuoteParlayIxHeaderPayload as ZeroPodFixed>::from_bytes(
         &data[..GET_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN],
      )
      .map_err(|_| ProgramError::InvalidInstructionData)?;
      let num_legs = zc.num_legs;
      let mut legs = empty_parlay_leg_sel_buf::<MAX_PARLAY_LEGS>();
      decode_trailing_parlay_leg_sels(
         data,
         GET_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN,
         num_legs as usize,
         MAX_PARLAY_LEGS,
         0,
         &mut legs,
      )?;
      Ok(Self {
         amount: zc.amount.get(),
         odds_scaled: zc.odds_scaled.get(),
         num_legs,
         legs,
      })
   }
}

/// Header size of payload (without disc): amount + odds + num_legs.
pub const GET_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN: usize =
   <GetQuoteParlayIxHeaderPayload as ZeroPodFixed>::SIZE;

/// Max payload size (header + MAX_PARLAY_LEGS legs), without router discriminator.
pub const GET_QUOTE_PARLAY_IX_PAYLOAD_LEN: usize =
   GET_QUOTE_PARLAY_IX_PAYLOAD_HEADER_LEN + MAX_PARLAY_LEGS * PARLAY_LEG_SEL_LEN;
