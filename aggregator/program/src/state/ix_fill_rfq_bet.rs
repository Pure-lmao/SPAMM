use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   errors::SpammError,
};

use super::{
   ix_common::{
      split_freebet_id_prefix, validate_amount_over_min, validate_event_state_sequence,
      validate_odds_above_scale, validate_side_for_mkt, validate_sport, IX_ED25519_SIGNATURE_LEN,
   },
   ids::MarketId,
   other::EventGameState,
};

/// Router payload for `fill_rfq_bet` (quote fields; signature is trailing).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillRfqBetIxData {
   pub bet_id: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub amount: u64,
   pub odds_scaled: u32,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
   pub max_stake: u64,
   pub offer_expiry: u32,
}

pub const FILL_RFQ_BET_IX_BODY_LEN: usize = <FillRfqBetIxData as ZeroPodFixed>::SIZE;
pub const FILL_RFQ_BET_IX_DATA_LEN: usize = FILL_RFQ_BET_IX_BODY_LEN + IX_ED25519_SIGNATURE_LEN;

impl FillRfqBetIxData {
   #[inline(always)]
   pub fn decode_with_signature(
      data: &[u8],
   ) -> Result<(Self, [u8; IX_ED25519_SIGNATURE_LEN]), ProgramError> {
      if data.len() != FILL_RFQ_BET_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(&data[..FILL_RFQ_BET_IX_BODY_LEN])
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      let parsed = Self {
         bet_id: zc.bet_id.get(),
         market_id: MarketId::from_zc(&zc.market_id).ok_or(ProgramError::InvalidInstructionData)?,
         side: zc.side,
         amount: zc.amount.get(),
         odds_scaled: zc.odds_scaled.get(),
         event_state_sequence: zc.event_state_sequence.get(),
         event_game_state: EventGameState::from_zc(&zc.event_game_state),
         max_stake: zc.max_stake.get(),
         offer_expiry: zc.offer_expiry.get(),
      };
      const LABEL: &str = "fill_rfq_bet";
      validate_amount_over_min(parsed.amount, LABEL)?;
      if unlikely(parsed.amount > parsed.max_stake) {
         log!("{}: amount exceeds max_stake", LABEL);
         return Err(SpammError::StakeExceedsMaxStake.into());
      }
      validate_odds_above_scale(parsed.odds_scaled, LABEL)?;
      validate_event_state_sequence(
         parsed.event_state_sequence,
         parsed.market_id.is_pregame(),
         LABEL,
      )?;
      validate_sport(parsed.market_id.event_id.sport, LABEL)?;
      validate_side_for_mkt(parsed.side, parsed.market_id.mkt, LABEL)?;
      let mut sig = [0u8; IX_ED25519_SIGNATURE_LEN];
      sig.copy_from_slice(&data[FILL_RFQ_BET_IX_BODY_LEN..]);
      Ok((parsed, sig))
   }

   #[inline(always)]
   pub fn write_wire_with_signature(
      &self,
      signature: &[u8; IX_ED25519_SIGNATURE_LEN],
      out: &mut [u8],
   ) -> Result<(), ProgramError> {
      if out.len() != FILL_RFQ_BET_IX_DATA_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillRfqBetIxDataZc {
         bet_id: self.bet_id.into(),
         market_id: self.market_id.to_zc(),
         side: self.side,
         amount: self.amount.into(),
         odds_scaled: self.odds_scaled.into(),
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
         max_stake: self.max_stake.into(),
         offer_expiry: self.offer_expiry.into(),
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      out[FILL_RFQ_BET_IX_BODY_LEN..].copy_from_slice(signature);
      Ok(())
   }
}

/// `freebet_id: u32` prefix then [`FillRfqBetIxData`] + signature.
#[derive(Copy, Clone)]
pub struct FreebetFillRfqBetIxData {
   pub freebet_id: u32,
   pub fill: FillRfqBetIxData,
   pub signature: [u8; IX_ED25519_SIGNATURE_LEN],
}

impl FreebetFillRfqBetIxData {
   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      let (freebet_id, rest) = split_freebet_id_prefix(data)?;
      let (fill, signature) = FillRfqBetIxData::decode_with_signature(rest)?;
      Ok(Self {
         freebet_id,
         fill,
         signature,
      })
   }
}
