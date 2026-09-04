//! Parlay quote buffer layout and CPI wire types for MM `get_quote_parlay` / `fill_parlay_quote`.
//!
//! Three packed leg layouts, each with only the fields that path needs:
//! - [`ParlayLegSel`] — fill/quote ix (selection; no per-leg odds or result)
//! - [`ParlayLegQuoted`] — RFQ ix / MM quote buffer (selection + per-leg odds)
//! - [`ParlayLegWire`] — parlay bet account (selection + odds + grade result)

use core::mem::offset_of;

use pinocchio::{Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::{MAX_PARLAY_LEGS, ODDS_SCALE},
   state::{account_bet::BetResult, EventGameState, EventId, MarketId, Sport},
};

#[inline(always)]
fn placeholder_market_id() -> MarketId {
   MarketId {
      event_id: EventId {
         event: 0,
         league: 0,
         sport: Sport::Invalid,
      },
      player: 0,
      mkt: 0,
      period: 0,
      is_pregame: false,
      operator: Address::default(),
   }
}

/// Packed leg slot used on instruction / account wires.
trait PackedLeg: Copy + Sized {
   const LEN: usize;
   fn decode_slot(data: &[u8]) -> Option<Self>;
   fn encode_slot(&self, out: &mut [u8]);
}

/// User/CPI selection: market, side, event snapshot. No per-leg odds or grade.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct ParlayLegSel {
   pub market_id: MarketId,
   pub side: u8,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
}

pub const PARLAY_LEG_SEL_LEN: usize = <ParlayLegSel as ZeroPodFixed>::SIZE;

impl ParlayLegSel {
   #[inline(always)]
   pub fn to_zc(&self) -> ParlayLegSelZc {
      ParlayLegSelZc {
         market_id: self.market_id.to_zc(),
         side: self.side,
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &ParlayLegSelZc) -> Option<Self> {
      Some(Self {
         market_id: MarketId::from_zc(&z.market_id)?,
         side: z.side,
         event_state_sequence: z.event_state_sequence.get(),
         event_game_state: EventGameState::from_zc(&z.event_game_state),
      })
   }

   #[inline(always)]
   pub fn placeholder() -> Self {
      Self {
         market_id: placeholder_market_id(),
         side: 0,
         event_state_sequence: 0,
         event_game_state: EventGameState::zeroed(),
      }
   }

   #[inline(always)]
   pub fn with_odds(self, odds_scaled: u32) -> ParlayLegQuoted {
      ParlayLegQuoted {
         market_id: self.market_id,
         side: self.side,
         event_state_sequence: self.event_state_sequence,
         event_game_state: self.event_game_state,
         odds_scaled,
      }
   }

   #[inline(always)]
   pub fn with_odds_pending(self, odds_scaled: u32) -> ParlayLegWire {
      self.with_odds(odds_scaled).with_pending()
   }
}

impl PackedLeg for ParlayLegSel {
   const LEN: usize = PARLAY_LEG_SEL_LEN;

   #[inline(always)]
   fn decode_slot(data: &[u8]) -> Option<Self> {
      let zc = <Self as ZeroPodFixed>::from_bytes(data).ok()?;
      Self::from_zc(zc)
   }

   #[inline(always)]
   fn encode_slot(&self, out: &mut [u8]) {
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
   }
}

/// Selection + per-leg odds. RFQ fill ix and MM quote buffer (result is always pending until the bet PDA).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct ParlayLegQuoted {
   pub market_id: MarketId,
   pub side: u8,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
   /// Per-leg odds from the MM quote (`0` = deliberate same-event companion leg).
   pub odds_scaled: u32,
}

pub const PARLAY_LEG_QUOTED_LEN: usize = <ParlayLegQuoted as ZeroPodFixed>::SIZE;

impl ParlayLegQuoted {
   #[inline(always)]
   pub fn to_zc(&self) -> ParlayLegQuotedZc {
      ParlayLegQuotedZc {
         market_id: self.market_id.to_zc(),
         side: self.side,
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
         odds_scaled: self.odds_scaled.into(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &ParlayLegQuotedZc) -> Option<Self> {
      Some(Self {
         market_id: MarketId::from_zc(&z.market_id)?,
         side: z.side,
         event_state_sequence: z.event_state_sequence.get(),
         event_game_state: EventGameState::from_zc(&z.event_game_state),
         odds_scaled: z.odds_scaled.get(),
      })
   }

   #[inline(always)]
   pub fn placeholder() -> Self {
      ParlayLegSel::placeholder().with_odds(ODDS_SCALE as u32)
   }

   #[inline(always)]
   pub fn sel(self) -> ParlayLegSel {
      ParlayLegSel {
         market_id: self.market_id,
         side: self.side,
         event_state_sequence: self.event_state_sequence,
         event_game_state: self.event_game_state,
      }
   }

   #[inline(always)]
   pub fn with_pending(self) -> ParlayLegWire {
      ParlayLegWire {
         market_id: self.market_id,
         side: self.side,
         event_state_sequence: self.event_state_sequence,
         event_game_state: self.event_game_state,
         odds_scaled: self.odds_scaled,
         result: BetResult::Pending,
      }
   }
}

impl PackedLeg for ParlayLegQuoted {
   const LEN: usize = PARLAY_LEG_QUOTED_LEN;

   #[inline(always)]
   fn decode_slot(data: &[u8]) -> Option<Self> {
      let zc = <Self as ZeroPodFixed>::from_bytes(data).ok()?;
      Self::from_zc(zc)
   }

   #[inline(always)]
   fn encode_slot(&self, out: &mut [u8]) {
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
   }
}

/// Stored parlay bet-account leg (selection + odds + grade result).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct ParlayLegWire {
   pub market_id: MarketId,
   pub side: u8,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
   /// Per-leg odds from the MM quote (`0` = deliberate same-event companion leg).
   pub odds_scaled: u32,
   /// Graded on-chain via `grade_parlay`; `Pending` at creation.
   pub result: BetResult,
}

pub const PARLAY_LEG_WIRE_LEN: usize = <ParlayLegWire as ZeroPodFixed>::SIZE;

impl ParlayLegWire {
   #[inline(always)]
   pub fn to_zc(&self) -> ParlayLegWireZc {
      ParlayLegWireZc {
         market_id: self.market_id.to_zc(),
         side: self.side,
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
         odds_scaled: self.odds_scaled.into(),
         result: self.result.into(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &ParlayLegWireZc) -> Option<Self> {
      Some(Self {
         market_id: MarketId::from_zc(&z.market_id)?,
         side: z.side,
         event_state_sequence: z.event_state_sequence.get(),
         event_game_state: EventGameState::from_zc(&z.event_game_state),
         odds_scaled: z.odds_scaled.get(),
         result: BetResult::from_u8(z.result.get()).ok()?,
      })
   }

   /// Unused account-leg placeholder (`odds_scaled = 1.0`, `Pending`).
   #[inline(always)]
   pub fn placeholder() -> Self {
      ParlayLegQuoted::placeholder().with_pending()
   }

   #[inline(always)]
   pub fn sel(self) -> ParlayLegSel {
      self.quoted().sel()
   }

   #[inline(always)]
   pub fn quoted(self) -> ParlayLegQuoted {
      ParlayLegQuoted {
         market_id: self.market_id,
         side: self.side,
         event_state_sequence: self.event_state_sequence,
         event_game_state: self.event_game_state,
         odds_scaled: self.odds_scaled,
      }
   }
}

impl PackedLeg for ParlayLegWire {
   const LEN: usize = PARLAY_LEG_WIRE_LEN;

   #[inline(always)]
   fn decode_slot(data: &[u8]) -> Option<Self> {
      let zc = <Self as ZeroPodFixed>::from_bytes(data).ok()?;
      Self::from_zc(zc)
   }

   #[inline(always)]
   fn encode_slot(&self, out: &mut [u8]) {
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
   }
}

pub const MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR: u8 = 103;

/// Fixed header for the MM parlay quote buffer. Live legs follow as
/// [`PARLAY_LEG_QUOTED_LEN`] × [`MAX_PARLAY_LEGS`] bytes (unused slots zeroed).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct MMParlayQuoteBuffer {
   pub discriminator: u8,
   pub is_used: u8,
   pub user_address: Address,
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub num_legs: u8,
}

pub const MM_PARLAY_QUOTE_BUFFER_HEADER_LEN: usize = <MMParlayQuoteBuffer as ZeroPodFixed>::SIZE;
/// Trailing padded leg table size (`MAX_PARLAY_LEGS` × quoted leg).
pub const PARLAY_LEG_TABLE_LEN: usize = MAX_PARLAY_LEGS * PARLAY_LEG_QUOTED_LEN;
pub const MM_PARLAY_QUOTE_BUFFER_LEN: usize =
   MM_PARLAY_QUOTE_BUFFER_HEADER_LEN + PARLAY_LEG_TABLE_LEN;

impl MMParlayQuoteBuffer {
   pub const IS_USED_OFFSET: usize = offset_of!(MMParlayQuoteBufferZc, is_used);

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != MM_PARLAY_QUOTE_BUFFER_LEN {
         return Err(ProgramError::InvalidAccountData);
      }
      if data[0] != MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(&data[..MM_PARLAY_QUOTE_BUFFER_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidAccountData)?;
      Ok(Self {
         discriminator: zc.discriminator,
         is_used: zc.is_used,
         user_address: zc.user_address,
         max_amount: zc.max_amount.get(),
         odds_scaled: zc.odds_scaled.get(),
         num_legs: zc.num_legs,
      })
   }

   #[inline(always)]
   pub fn to_zc(&self) -> MMParlayQuoteBufferZc {
      MMParlayQuoteBufferZc {
         discriminator: self.discriminator,
         is_used: self.is_used,
         user_address: self.user_address,
         max_amount: self.max_amount.into(),
         odds_scaled: self.odds_scaled.into(),
         num_legs: self.num_legs,
      }
   }

   /// Write header + zero-padded leg table into a full quote-buffer account.
   #[inline(always)]
   pub fn write_fresh_quote(
      out: &mut [u8],
      user_address: Address,
      num_legs: u8,
      max_amount: u64,
      odds_scaled: u32,
      legs: &[ParlayLegQuoted],
   ) -> Result<(), ProgramError> {
      if out.len() != MM_PARLAY_QUOTE_BUFFER_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let n = num_legs as usize;
      if n < 2 || n > MAX_PARLAY_LEGS || legs.len() < n {
         return Err(ProgramError::InvalidInstructionData);
      }
      let header = Self {
         discriminator: MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR,
         is_used: 0,
         user_address,
         max_amount,
         odds_scaled,
         num_legs,
      };
      let zc = header.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      let legs_out = &mut out[MM_PARLAY_QUOTE_BUFFER_HEADER_LEN..];
      legs_out.fill(0);
      write_parlay_leg_quoted(&mut legs_out[..n * PARLAY_LEG_QUOTED_LEN], &legs[..n])
   }
}

pub const GET_QUOTE_PARLAY_IX_DISCRIMINATOR: u8 = 122;

/// Fixed header for `get_quote_parlay`.
/// `num_legs` is last so trailing live legs start immediately after the header.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct GetQuoteParlayIxHeader {
   pub instruction_discriminator: u8,
   pub amount: u64,
   pub odds_scaled: u32,
   pub num_legs: u8,
}

pub const GET_QUOTE_PARLAY_IX_HEADER_LEN: usize = <GetQuoteParlayIxHeader as ZeroPodFixed>::SIZE;

/// Owned decode of `get_quote_parlay` ix (wire = header + live [`ParlayLegSel`] only).
#[derive(Clone)]
pub struct GetQuoteParlayIxData {
   pub instruction_discriminator: u8,
   pub amount: u64,
   pub odds_scaled: u32,
   pub num_legs: u8,
   /// Capacity buffer; only `0..num_legs` are live / written on the wire.
   pub legs: [ParlayLegSel; MAX_PARLAY_LEGS],
}

impl GetQuoteParlayIxData {
   #[inline(always)]
   pub fn wire_len(num_legs: usize) -> usize {
      GET_QUOTE_PARLAY_IX_HEADER_LEN + num_legs * PARLAY_LEG_SEL_LEN
   }

   /// Max wire size (header + [`MAX_PARLAY_LEGS`](crate::constants::MAX_PARLAY_LEGS)).
   pub const WIRE_LEN: usize =
      GET_QUOTE_PARLAY_IX_HEADER_LEN + MAX_PARLAY_LEGS * PARLAY_LEG_SEL_LEN;

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() < GET_QUOTE_PARLAY_IX_HEADER_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      if data[0] != GET_QUOTE_PARLAY_IX_DISCRIMINATOR {
         return Err(ProgramError::InvalidInstructionData);
      }
      let z = <GetQuoteParlayIxHeader as ZeroPodFixed>::from_bytes(&data[..GET_QUOTE_PARLAY_IX_HEADER_LEN])
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      let num_legs = z.num_legs as usize;
      let mut legs = empty_parlay_leg_sel_buf::<MAX_PARLAY_LEGS>();
      decode_trailing_parlay_leg_sels(
         data,
         GET_QUOTE_PARLAY_IX_HEADER_LEN,
         num_legs,
         MAX_PARLAY_LEGS,
         0,
         &mut legs,
      )?;
      Ok(Self {
         instruction_discriminator: z.instruction_discriminator,
         amount: z.amount.get(),
         odds_scaled: z.odds_scaled.get(),
         num_legs: z.num_legs,
         legs,
      })
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      let n = self.num_legs as usize;
      let expected = Self::wire_len(n);
      if out.len() != expected || n < 2 || n > MAX_PARLAY_LEGS {
         return Err(ProgramError::InvalidInstructionData);
      }
      let hzc = GetQuoteParlayIxHeaderZc {
         instruction_discriminator: self.instruction_discriminator,
         amount: self.amount.into(),
         odds_scaled: self.odds_scaled.into(),
         num_legs: self.num_legs,
      };
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), hzc);
      }
      write_parlay_leg_sels(&mut out[GET_QUOTE_PARLAY_IX_HEADER_LEN..], &self.legs[..n])
   }
}

#[inline(always)]
fn decode_packed_legs_into<T: PackedLeg>(
   data: &[u8],
   num_legs: usize,
   out: &mut [T],
) -> Result<(), ProgramError> {
   let need = num_legs
      .checked_mul(T::LEN).ok_or(ProgramError::ArithmeticOverflow)?;
   if data.len() < need || out.len() < num_legs {
      return Err(ProgramError::InvalidInstructionData);
   }
   for i in 0..num_legs {
      let off = i * T::LEN;
      out[i] = T::decode_slot(&data[off..off + T::LEN]).ok_or(ProgramError::InvalidInstructionData)?;
   }
   Ok(())
}

#[inline(always)]
fn decode_trailing_packed_legs<T: PackedLeg>(
   data: &[u8],
   header_len: usize,
   num_legs: usize,
   max_legs: usize,
   trailing_len: usize,
   out: &mut [T],
) -> Result<(), ProgramError> {
   if num_legs < 2 || num_legs > max_legs {
      return Err(ProgramError::InvalidInstructionData);
   }
   let legs_bytes = num_legs
      .checked_mul(T::LEN).ok_or(ProgramError::ArithmeticOverflow)?;
   let body_end = header_len
      .checked_add(legs_bytes).ok_or(ProgramError::ArithmeticOverflow)?;
   let expected = body_end
      .checked_add(trailing_len).ok_or(ProgramError::ArithmeticOverflow)?;
   if data.len() != expected {
      return Err(ProgramError::InvalidInstructionData);
   }
   decode_packed_legs_into(&data[header_len..body_end], num_legs, out)
}

#[inline(always)]
fn write_packed_legs<T: PackedLeg>(out: &mut [u8], legs: &[T]) -> Result<(), ProgramError> {
   let need = legs.len()
      .checked_mul(T::LEN).ok_or(ProgramError::ArithmeticOverflow)?;
   if out.len() < need {
      return Err(ProgramError::InvalidInstructionData);
   }
   for (i, leg) in legs.iter().enumerate() {
      let off = i * T::LEN;
      leg.encode_slot(&mut out[off..off + T::LEN]);
   }
   Ok(())
}

/// Decode `num_legs` contiguous [`ParlayLegSel`] values into `out[0..num_legs]`.
#[inline(always)]
pub fn decode_parlay_leg_sels_into(
   data: &[u8],
   num_legs: usize,
   out: &mut [ParlayLegSel],
) -> Result<(), ProgramError> {
   decode_packed_legs_into(data, num_legs, out)
}

#[inline(always)]
pub fn empty_parlay_leg_sel_buf<const N: usize>() -> [ParlayLegSel; N] {
   [ParlayLegSel::placeholder(); N]
}

#[inline(always)]
pub fn decode_trailing_parlay_leg_sels(
   data: &[u8],
   header_len: usize,
   num_legs: usize,
   max_legs: usize,
   trailing_len: usize,
   out: &mut [ParlayLegSel],
) -> Result<(), ProgramError> {
   decode_trailing_packed_legs(data, header_len, num_legs, max_legs, trailing_len, out)
}

#[inline(always)]
pub fn write_parlay_leg_sels(out: &mut [u8], legs: &[ParlayLegSel]) -> Result<(), ProgramError> {
   write_packed_legs(out, legs)
}

/// Decode `num_legs` contiguous [`ParlayLegQuoted`] values into `out[0..num_legs]`.
#[inline(always)]
pub fn decode_parlay_leg_quoted_into(
   data: &[u8],
   num_legs: usize,
   out: &mut [ParlayLegQuoted],
) -> Result<(), ProgramError> {
   decode_packed_legs_into(data, num_legs, out)
}

#[inline(always)]
pub fn empty_parlay_leg_quoted_buf<const N: usize>() -> [ParlayLegQuoted; N] {
   [ParlayLegQuoted::placeholder(); N]
}

#[inline(always)]
pub fn decode_trailing_parlay_leg_quoted(
   data: &[u8],
   header_len: usize,
   num_legs: usize,
   max_legs: usize,
   trailing_len: usize,
   out: &mut [ParlayLegQuoted],
) -> Result<(), ProgramError> {
   decode_trailing_packed_legs(data, header_len, num_legs, max_legs, trailing_len, out)
}

#[inline(always)]
pub fn write_parlay_leg_quoted(out: &mut [u8], legs: &[ParlayLegQuoted]) -> Result<(), ProgramError> {
   write_packed_legs(out, legs)
}

/// Decode `num_legs` contiguous [`ParlayLegWire`] values into `out[0..num_legs]`.
#[inline(always)]
pub fn decode_parlay_legs_into(
   data: &[u8],
   num_legs: usize,
   out: &mut [ParlayLegWire],
) -> Result<(), ProgramError> {
   decode_packed_legs_into(data, num_legs, out)
}

/// Placeholder capacity buffer for unpadded parlay-account decode.
#[inline(always)]
pub fn empty_parlay_leg_buf<const N: usize>() -> [ParlayLegWire; N] {
   [ParlayLegWire::placeholder(); N]
}

/// Validate `num_legs`, exact wire length (`header + legs + trailing`), decode live account legs into `out`.
#[inline(always)]
pub fn decode_trailing_parlay_legs(
   data: &[u8],
   header_len: usize,
   num_legs: usize,
   max_legs: usize,
   trailing_len: usize,
   out: &mut [ParlayLegWire],
) -> Result<(), ProgramError> {
   decode_trailing_packed_legs(data, header_len, num_legs, max_legs, trailing_len, out)
}

#[inline(always)]
pub fn write_parlay_legs(out: &mut [u8], legs: &[ParlayLegWire]) -> Result<(), ProgramError> {
   write_packed_legs(out, legs)
}

pub const FILL_QUOTE_PARLAY_IX_DISCRIMINATOR: u8 = 123;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillParlayQuoteIxData {
   pub instruction_discriminator: u8,
   pub amount_to_fill: u64,
   pub odds_scaled: u32,
   pub amount_to_send: u64,
}

impl FillParlayQuoteIxData {
   pub const WIRE_LEN: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn to_zc(&self) -> FillParlayQuoteIxDataZc {
      FillParlayQuoteIxDataZc {
         instruction_discriminator: self.instruction_discriminator,
         amount_to_fill: self.amount_to_fill.into(),
         odds_scaled: self.odds_scaled.into(),
         amount_to_send: self.amount_to_send.into(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &FillParlayQuoteIxDataZc) -> Self {
      Self {
         instruction_discriminator: z.instruction_discriminator,
         amount_to_fill: z.amount_to_fill.into(),
         odds_scaled: z.odds_scaled.into(),
         amount_to_send: z.amount_to_send.into(),
      }
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != Self::WIRE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != Self::WIRE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      if data[0] != FILL_QUOTE_PARLAY_IX_DISCRIMINATOR {
         return Err(ProgramError::InvalidInstructionData);
      }
      let z = <Self as ZeroPodFixed>::from_bytes(data).map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self::from_zc(&z))
   }
}
