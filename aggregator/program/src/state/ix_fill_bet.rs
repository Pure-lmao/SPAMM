use pinocchio::error::ProgramError;
use zeropod::{ZeroPod, ZeroPodFixed};

use super::{
   ix_common::{
      split_freebet_id_prefix, validate_amount_over_min, validate_event_state_sequence,
      validate_odds_above_scale, validate_side_for_mkt, validate_sport,
   },
   ids::MarketId,
   other::EventGameState,
};

/// Fill-bet instruction payload (bytes after the router discriminator).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillBetIxData {
   pub bet_id: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub amount: u64,
   pub min_odds_scaled: u32,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
}

pub const FILL_BET_IX_DATA_LEN: usize = <FillBetIxData as ZeroPodFixed>::SIZE;

impl FillBetIxData {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != FILL_BET_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      let parsed = Self {
         bet_id: zc.bet_id.get(),
         amount: zc.amount.get(),
         min_odds_scaled: zc.min_odds_scaled.get(),
         event_state_sequence: zc.event_state_sequence.get(),
         side: zc.side,
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidInstructionData)?,
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
      };
      const LABEL: &str = "fill_bet";
      validate_amount_over_min(parsed.amount, LABEL)?;
      validate_odds_above_scale(parsed.min_odds_scaled, LABEL)?;
      validate_event_state_sequence(
         parsed.event_state_sequence,
         parsed.market_id.is_pregame(),
         LABEL,
      )?;
      validate_sport(parsed.market_id.event_id.sport, LABEL)?;
      validate_side_for_mkt(parsed.side, parsed.market_id.mkt, LABEL)?;
      Ok(parsed)
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != FILL_BET_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillBetIxDataZc {
         bet_id: self.bet_id.into(),
         market_id: self.market_id.to_zc(),
         side: self.side,
         amount: self.amount.into(),
         min_odds_scaled: self.min_odds_scaled.into(),
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}

/// `freebet_id: u32` prefix then [`FillBetIxData`].
#[derive(Copy, Clone)]
pub struct FreebetFillBetIxData {
   pub freebet_id: u32,
   pub fill: FillBetIxData,
}

impl FreebetFillBetIxData {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      let (freebet_id, rest) = split_freebet_id_prefix(data)?;
      Ok(Self {
         freebet_id,
         fill: FillBetIxData::decode(rest)?,
      })
   }
}
