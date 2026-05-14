//! Parlay quote buffer layout and CPI wire types for MM `get_quote_parlay` / `fill_parlay_quote`.

use pinocchio::{Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::state::{EventGameState, MarketId};

/// One parlay selection on the wire (matches `fill_parlay` / MM quote buffer leg slots).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct ParlayLegWire {
   pub market_id: MarketId,
   pub side: u8,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
}

pub const PARLAY_LEG_WIRE_LEN: usize = <ParlayLegWire as ZeroPodFixed>::SIZE;

impl ParlayLegWire {
   #[inline(always)]
   pub fn to_zc(self) -> ParlayLegWireZc {
      ParlayLegWireZc {
         market_id: self.market_id.to_zc(),
         side: self.side,
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &ParlayLegWireZc) -> Option<Self> {
      Some(Self {
         market_id: MarketId::from_zc(&z.market_id)?,
         side: z.side,
         event_state_sequence: z.event_state_sequence.get(),
         event_game_state: EventGameState::from_zc(&z.event_game_state),
      })
   }
}

/// Fixed table of up to [`MAX_PARLAY_LEGS`] legs (zeropod does not support `[T; N]` for non-`u8` `T`).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct ParlayLegTable {
   pub leg_0: ParlayLegWire,
   pub leg_1: ParlayLegWire,
   pub leg_2: ParlayLegWire,
   pub leg_3: ParlayLegWire,
   pub leg_4: ParlayLegWire,
}

impl ParlayLegTable {
   #[inline(always)]
   pub fn get(&self, i: usize) -> Option<&ParlayLegWire> {
      Some(match i {
         0 => &self.leg_0,
         1 => &self.leg_1,
         2 => &self.leg_2,
         3 => &self.leg_3,
         4 => &self.leg_4,
         _ => return None,
      })
   }

   #[inline(always)]
   pub fn set(&mut self, i: usize, leg: ParlayLegWire) -> bool {
      match i {
         0 => self.leg_0 = leg,
         1 => self.leg_1 = leg,
         2 => self.leg_2 = leg,
         3 => self.leg_3 = leg,
         4 => self.leg_4 = leg,
         _ => return false,
      }
      true
   }

   #[inline(always)]
   pub fn to_zc(self) -> ParlayLegTableZc {
      ParlayLegTableZc {
         leg_0: self.leg_0.to_zc(),
         leg_1: self.leg_1.to_zc(),
         leg_2: self.leg_2.to_zc(),
         leg_3: self.leg_3.to_zc(),
         leg_4: self.leg_4.to_zc(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &ParlayLegTableZc) -> Option<Self> {
      Some(Self {
         leg_0: ParlayLegWire::from_zc(&z.leg_0)?,
         leg_1: ParlayLegWire::from_zc(&z.leg_1)?,
         leg_2: ParlayLegWire::from_zc(&z.leg_2)?,
         leg_3: ParlayLegWire::from_zc(&z.leg_3)?,
         leg_4: ParlayLegWire::from_zc(&z.leg_4)?,
      })
   }
}

pub const MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR: u8 = 3;

/// MM-owned buffer snapshot for a parlay quote (validated again on `fill_parlay_quote`).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct MMParlayQuoteBuffer {
   pub discriminator: u8,
   pub is_used: u8,
   pub user_address: Address,
   pub max_amount: u64,
   pub odds_scaled: u32,
   pub num_legs: u8,
   pub legs: ParlayLegTable,
}

pub const MM_PARLAY_QUOTE_BUFFER_LEN: usize = <MMParlayQuoteBuffer as ZeroPodFixed>::SIZE;

impl MMParlayQuoteBuffer {
   /// New quote buffer body: MM discriminator, `is_used = 0`, caller fields from the quote path.
   #[inline(always)]
   pub fn new_fresh_quote(
      user_address: Address,
      num_legs: u8,
      max_amount: u64,
      odds_scaled: u32,
      legs: ParlayLegTable,
   ) -> Self {
      Self {
         discriminator: MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR,
         is_used: 0,
         user_address,
         max_amount,
         odds_scaled,
         num_legs,
         legs,
      }
   }

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      if data.len() != MM_PARLAY_QUOTE_BUFFER_LEN {
         return Err(ProgramError::InvalidAccountData);
      }
      let zc = <Self as ZeroPodFixed>::from_bytes(data).map_err(|_| ProgramError::InvalidAccountData)?;
      Ok(Self {
         discriminator: zc.discriminator,
         is_used: zc.is_used,
         user_address: zc.user_address,
         max_amount: zc.max_amount.get(),
         odds_scaled: zc.odds_scaled.get(),
         num_legs: zc.num_legs,
         legs: ParlayLegTable {
            leg_0: ParlayLegWire::from_zc(&zc.legs.leg_0).ok_or(ProgramError::InvalidAccountData)?,
            leg_1: ParlayLegWire::from_zc(&zc.legs.leg_1).ok_or(ProgramError::InvalidAccountData)?,
            leg_2: ParlayLegWire::from_zc(&zc.legs.leg_2).ok_or(ProgramError::InvalidAccountData)?,
            leg_3: ParlayLegWire::from_zc(&zc.legs.leg_3).ok_or(ProgramError::InvalidAccountData)?,
            leg_4: ParlayLegWire::from_zc(&zc.legs.leg_4).ok_or(ProgramError::InvalidAccountData)?,
         },
      })
   }

   #[inline(always)]
   pub fn to_zc(self) -> MMParlayQuoteBufferZc {
      MMParlayQuoteBufferZc {
         discriminator: self.discriminator,
         is_used: self.is_used,
         user_address: self.user_address,
         max_amount: self.max_amount.into(),
         odds_scaled: self.odds_scaled.into(),
         num_legs: self.num_legs,
         legs: self.legs.to_zc(),
      }
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != MM_PARLAY_QUOTE_BUFFER_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}

pub const GET_QUOTE_PARLAY_IX_DISCRIMINATOR: u8 = 7;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct GetQuoteParlayIxData {
   pub instruction_discriminator: u8,
   pub amount: u64,
   pub odds_scaled: u32,
   pub num_legs: u8,
   pub legs: ParlayLegTable,
}

impl GetQuoteParlayIxData {
   pub const WIRE_LEN: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn to_zc(self) -> GetQuoteParlayIxDataZc {
      GetQuoteParlayIxDataZc {
         instruction_discriminator: self.instruction_discriminator,
         amount: self.amount.into(),
         odds_scaled: self.odds_scaled.into(),
         num_legs: self.num_legs,
         legs: self.legs.to_zc(),
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
}

pub const FILL_QUOTE_PARLAY_IX_DISCRIMINATOR: u8 = 8;

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
   pub fn to_zc(self) -> FillParlayQuoteIxDataZc {
      FillParlayQuoteIxDataZc {
         instruction_discriminator: self.instruction_discriminator,
         amount_to_fill: self.amount_to_fill.into(),
         odds_scaled: self.odds_scaled.into(),
         amount_to_send: self.amount_to_send.into(),
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
}