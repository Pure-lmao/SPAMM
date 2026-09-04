//! MM CPI wire types for cashout quotes and fills.

use pinocchio::{Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::MAX_RFQ_PARLAY_LEGS,
   readers::read_u64_le_unchecked,
   state::{EventGameState, MarketId, ParlayLegSel, write_parlay_leg_sels, PARLAY_LEG_SEL_LEN},
};

pub const GET_CASHOUT_QUOTE_IX_DISCRIMINATOR: u8 = 140;
pub const FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR: u8 = 141;
pub const GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR: u8 = 142;
pub const FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR: u8 = 143;

/// Packed MM cashout-quote CPI return (`u64` max payment).
#[repr(C)]
pub struct CashoutQuoteReturn {
   pub max_payment: u64,
}

pub const CASHOUT_QUOTE_RETURN_LEN: usize = size_of::<CashoutQuoteReturn>();

impl CashoutQuoteReturn {
   #[inline(always)]
   pub fn read_max_payment(data: &[u8]) -> Option<u64> {
      if data.len() != CASHOUT_QUOTE_RETURN_LEN {
         return None;
      }
      Some(unsafe { read_u64_le_unchecked(data.as_ptr(), 0) })
   }
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct GetCashoutQuoteIxData {
   pub instruction_discriminator: u8,
   pub amount: u64,
   pub payout: u64,
   pub min_payout: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub event_game_state: EventGameState,
   pub event_state_sequence: u16,
}

impl GetCashoutQuoteIxData {
   pub const WIRE_LEN: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn to_zc(&self) -> GetCashoutQuoteIxDataZc {
      GetCashoutQuoteIxDataZc {
         instruction_discriminator: self.instruction_discriminator,
         amount: self.amount.into(),
         payout: self.payout.into(),
         min_payout: self.min_payout.into(),
         market_id: self.market_id.to_zc(),
         side: self.side,
         event_game_state: self.event_game_state.to_zc(),
         event_state_sequence: self.event_state_sequence.into(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &GetCashoutQuoteIxDataZc) -> Option<Self> {
      Some(Self {
         instruction_discriminator: z.instruction_discriminator,
         amount: z.amount.into(),
         payout: z.payout.into(),
         min_payout: z.min_payout.into(),
         market_id: MarketId::from_zc(&z.market_id)?,
         side: z.side,
         event_game_state: EventGameState::from_zc(&z.event_game_state),
         event_state_sequence: z.event_state_sequence.into(),
      })
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
      if data[0] != GET_CASHOUT_QUOTE_IX_DISCRIMINATOR {
         return Err(ProgramError::InvalidInstructionData);
      }
      let z = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self::from_zc(&z).ok_or(ProgramError::InvalidInstructionData)?)
   }
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillCashoutQuoteIxData {
   pub instruction_discriminator: u8,
   pub amount: u64,
   pub amount_to_send: u64,
   pub market_id: MarketId,
   pub side: u8,
   pub event_game_state: EventGameState,
   pub event_state_sequence: u16,
}

impl FillCashoutQuoteIxData {
   pub const WIRE_LEN: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn to_zc(&self) -> FillCashoutQuoteIxDataZc {
      FillCashoutQuoteIxDataZc {
         instruction_discriminator: self.instruction_discriminator,
         amount: self.amount.into(),
         amount_to_send: self.amount_to_send.into(),
         market_id: self.market_id.to_zc(),
         side: self.side,
         event_game_state: self.event_game_state.to_zc(),
         event_state_sequence: self.event_state_sequence.into(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &FillCashoutQuoteIxDataZc) -> Option<Self> {
      Some(Self {
         instruction_discriminator: z.instruction_discriminator,
         amount: z.amount.into(),
         amount_to_send: z.amount_to_send.into(),
         market_id: MarketId::from_zc(&z.market_id)?,
         side: z.side,
         event_game_state: EventGameState::from_zc(&z.event_game_state),
         event_state_sequence: z.event_state_sequence.into(),
      })
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
      if data[0] != FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR {
         return Err(ProgramError::InvalidInstructionData);
      }
      let z = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self::from_zc(&z).ok_or(ProgramError::InvalidInstructionData)?)
   }
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct GetCashoutQuoteParlayIxHeader {
   pub instruction_discriminator: u8,
   pub amount: u64,
   pub payout: u64,
   pub min_payout: u64,
   pub num_legs: u8,
}

pub const GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN: usize =
   <GetCashoutQuoteParlayIxHeader as ZeroPodFixed>::SIZE;

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct FillCashoutQuoteParlayIxData {
   pub instruction_discriminator: u8,
   pub amount: u64,
   pub amount_to_send: u64,
}

impl FillCashoutQuoteParlayIxData {
   pub const WIRE_LEN: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != Self::WIRE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = FillCashoutQuoteParlayIxDataZc {
         instruction_discriminator: self.instruction_discriminator,
         amount: self.amount.into(),
         amount_to_send: self.amount_to_send.into(),
      };
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
      if data[0] != FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR {
         return Err(ProgramError::InvalidInstructionData);
      }
      let z = <Self as ZeroPodFixed>::from_bytes(data)
         .map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self {
         instruction_discriminator: z.instruction_discriminator,
         amount: z.amount.get(),
         amount_to_send: z.amount_to_send.get(),
      })
   }
}

/// Packed proxy return: filling MM address + cash they will pay.
#[repr(C)]
#[derive(Copy, Clone, ZeroPod)]
pub struct ProxyCashoutQuoteData {
   pub mm_address: Address,
   pub max_payment: u64,
}

pub const PROXY_CASHOUT_QUOTE_DATA_LEN: usize = <ProxyCashoutQuoteData as ZeroPodFixed>::SIZE;

#[inline(always)]
pub fn get_cashout_quote_parlay_ix_wire_len(num_legs: usize) -> usize {
   GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN + num_legs * PARLAY_LEG_SEL_LEN
}

#[inline(always)]
pub fn write_get_cashout_quote_parlay_ix(
   out: &mut [u8],
   amount: u64,
   payout: u64,
   min_payout: u64,
   num_legs: usize,
   legs: &[ParlayLegSel],
) -> Result<(), ProgramError> {
   let expected = get_cashout_quote_parlay_ix_wire_len(num_legs);
   if out.len() != expected || num_legs < 2 || num_legs > MAX_RFQ_PARLAY_LEGS || legs.len() < num_legs {
      return Err(ProgramError::InvalidInstructionData);
   }
   let hzc = GetCashoutQuoteParlayIxHeaderZc {
      instruction_discriminator: GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
      amount: amount.into(),
      payout: payout.into(),
      min_payout: min_payout.into(),
      num_legs: num_legs as u8,
   };
   unsafe {
      core::ptr::write(out.as_mut_ptr().cast(), hzc);
   }
   write_parlay_leg_sels(
      &mut out[GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN..],
      &legs[..num_legs],
   )
}
