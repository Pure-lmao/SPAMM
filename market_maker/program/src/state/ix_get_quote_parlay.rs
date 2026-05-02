use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use spamm_aggregator::state::{GetQuoteParlayIxData, ParlayLegTable};

/// `get_quote_parlay` instruction payload (bytes after the MM router discriminator in `lib.rs`), matching
/// [`GetQuoteParlayIxData`] minus `instruction_discriminator`.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct GetQuoteParlayIxPayload {
   pub amount: u64,
   pub odds_scaled: u32,
   pub num_legs: u8,
   pub legs: ParlayLegTable,
}

pub const GET_QUOTE_PARLAY_IX_PAYLOAD_LEN: usize = <GetQuoteParlayIxPayload as ZeroPodFixed>::SIZE;

impl GetQuoteParlayIxPayload {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != GET_QUOTE_PARLAY_IX_PAYLOAD_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data).map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         amount: zc.amount.get(),
         odds_scaled: zc.odds_scaled.get(),
         num_legs: zc.num_legs,
         legs: ParlayLegTable {
            leg_0: spamm_aggregator::state::ParlayLegWire::from_zc(&zc.legs.leg_0).ok_or(ProgramError::InvalidInstructionData)?,
            leg_1: spamm_aggregator::state::ParlayLegWire::from_zc(&zc.legs.leg_1).ok_or(ProgramError::InvalidInstructionData)?,
            leg_2: spamm_aggregator::state::ParlayLegWire::from_zc(&zc.legs.leg_2).ok_or(ProgramError::InvalidInstructionData)?,
            leg_3: spamm_aggregator::state::ParlayLegWire::from_zc(&zc.legs.leg_3).ok_or(ProgramError::InvalidInstructionData)?,
            leg_4: spamm_aggregator::state::ParlayLegWire::from_zc(&zc.legs.leg_4).ok_or(ProgramError::InvalidInstructionData)?,
         },
      })
   }
}

const _: () = assert!(GET_QUOTE_PARLAY_IX_PAYLOAD_LEN == GetQuoteParlayIxData::WIRE_LEN - 1);
