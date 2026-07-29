//! Canonical RFQ signed-message wire layouts (shared by on-chain verify + off-chain SDK).

use core::ptr::write_unaligned;
use pinocchio::{Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::constants::{MAX_PARLAY_LEGS, ODDS_SCALE, RFQ_NETWORK_DOMAIN};
use crate::state::{EventGameState, MarketId, ParlayLegTable, ParlayLegWire, other::{EventGameStateZc, EVENT_GAME_STATE_LEN}};
use crate::writers::{
   write_arbitrary_bytes_unchecked, write_u16_le_unchecked, write_u32_le_unchecked,
   write_u64_le_unchecked, write_u8_unchecked,
};

/// One parlay leg in an RFQ signed message (selection + per-leg odds; no result).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct RfqSignedParlayLeg {
   pub market_id: MarketId,
   pub event_game_state: EventGameState,
   pub event_state_sequence: u16,
   pub odds_scaled: u32,
   pub side: u8,
}

pub const RFQ_SIGNED_PARLAY_LEG_LEN: usize =
   MarketId::WIRE_SIZE + EVENT_GAME_STATE_LEN + 2 + 4 + 1;

const _: () = assert!(RFQ_SIGNED_PARLAY_LEG_LEN == <RfqSignedParlayLeg as ZeroPodFixed>::SIZE);

/// Canonical RFQ message length: `network_domain(u8)` + offer body + `mm_program_id`.
pub const RFQ_BET_MESSAGE_LEN: usize =
   1 + 32 + 8 + MarketId::WIRE_SIZE + EVENT_GAME_STATE_LEN + 2 + 1 + 8 + 4 + 4 + 32;

/// Fixed table of [`MAX_PARLAY_LEGS`] signed parlay legs (zeropod does not support `[T; N]` for non-`u8` `T`).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct RfqSignedParlayLegTable {
   pub leg_0: RfqSignedParlayLeg,
   pub leg_1: RfqSignedParlayLeg,
   pub leg_2: RfqSignedParlayLeg,
   pub leg_3: RfqSignedParlayLeg,
   pub leg_4: RfqSignedParlayLeg,
}

pub const RFQ_SIGNED_PARLAY_LEG_TABLE_LEN: usize = <RfqSignedParlayLegTable as ZeroPodFixed>::SIZE;

pub const RFQ_PARLAY_MESSAGE_LEN: usize =
   1 + 32 + 8 + 1 + RFQ_SIGNED_PARLAY_LEG_TABLE_LEN + 8 + 4 + 4 + 32;

const _: () = assert!(RFQ_SIGNED_PARLAY_LEG_TABLE_LEN == RFQ_SIGNED_PARLAY_LEG_LEN * MAX_PARLAY_LEGS);

#[inline(always)]
pub fn rfq_signed_parlay_leg_placeholder() -> RfqSignedParlayLeg {
   RfqSignedParlayLeg {
      market_id: ParlayLegWire::placeholder().market_id,
      event_game_state: EventGameState::zeroed(),
      event_state_sequence: 0,
      odds_scaled: ODDS_SCALE as u32,
      side: 0,
   }
}

#[inline(always)]
pub fn rfq_signed_parlay_leg_from_wire(leg: &ParlayLegWire) -> RfqSignedParlayLeg {
   RfqSignedParlayLeg {
      market_id: leg.market_id,
      event_game_state: leg.event_game_state,
      event_state_sequence: leg.event_state_sequence,
      odds_scaled: leg.odds_scaled,
      side: leg.side,
   }
}

/// Populate fixed leg slots: active legs from `legs`, remainder as placeholders.
#[inline(always)]
pub fn rfq_signed_parlay_leg_table(num_legs: u8, legs: &ParlayLegTable) -> RfqSignedParlayLegTable {
   let placeholder = rfq_signed_parlay_leg_placeholder();
   let mut table = RfqSignedParlayLegTable {
      leg_0: placeholder,
      leg_1: placeholder,
      leg_2: placeholder,
      leg_3: placeholder,
      leg_4: placeholder,
   };
   for i in 0..(num_legs as usize).min(MAX_PARLAY_LEGS) {
      if let Some(wire) = legs.get(i) {
         let signed = rfq_signed_parlay_leg_from_wire(wire);
         match i {
            0 => table.leg_0 = signed,
            1 => table.leg_1 = signed,
            2 => table.leg_2 = signed,
            3 => table.leg_3 = signed,
            4 => table.leg_4 = signed,
            _ => {}
         }
      }
   }
   table
}

/// Sequential writer for fixed-length RFQ message buffers.
struct WireBuf<'a> {
   out: &'a mut [u8],
   off: usize,
}

impl<'a> WireBuf<'a> {
   #[inline(always)]
   fn exact(out: &'a mut [u8], len: usize) -> Result<Self, ProgramError> {
      if out.len() != len {
         return Err(ProgramError::InvalidInstructionData);
      }
      Ok(Self { out, off: 0 })
   }

   #[inline(always)]
   fn write_address(&mut self, addr: &Address) -> Result<(), ProgramError> {
      unsafe {
         write_arbitrary_bytes_unchecked(self.out.as_mut_ptr(), self.off, addr.as_ref());
      }
      self.off += 32;
      Ok(())
   }

   #[inline(always)]
   fn write_u64(&mut self, v: u64) -> Result<(), ProgramError> {
      unsafe {
         write_u64_le_unchecked(self.out.as_mut_ptr(), self.off, v);
      }
      self.off += 8;
      Ok(())
   }

   #[inline(always)]
   fn write_u32(&mut self, v: u32) -> Result<(), ProgramError> {
      unsafe {
         write_u32_le_unchecked(self.out.as_mut_ptr(), self.off, v);
      }
      self.off += 4;
      Ok(())
   }

   #[inline(always)]
   fn write_u16(&mut self, v: u16) -> Result<(), ProgramError> {
      unsafe {
         write_u16_le_unchecked(self.out.as_mut_ptr(), self.off, v);
      }
      self.off += 2;
      Ok(())
   }

   #[inline(always)]
   fn write_u8(&mut self, v: u8) -> Result<(), ProgramError> {
      unsafe {
         write_u8_unchecked(self.out.as_mut_ptr(), self.off, v);
      }
      self.off += 1;
      Ok(())
   }

   #[inline(always)]
   fn write_market_id(&mut self, market_id: &MarketId) -> Result<(), ProgramError> {
      unsafe {
         write_arbitrary_bytes_unchecked(
            self.out.as_mut_ptr(),
            self.off,
            &market_id.as_bytes(),
         );
      }
      self.off += MarketId::WIRE_SIZE;
      Ok(())
   }

   #[inline(always)]
   fn write_event_game_state(&mut self, game_state: &EventGameState) -> Result<(), ProgramError> {
      let zc = game_state.to_zc();
      unsafe {
         write_unaligned(
            self.out.as_mut_ptr().add(self.off) as *mut EventGameStateZc,
            zc,
         );
      }
      self.off += EVENT_GAME_STATE_LEN;
      Ok(())
   }

   #[inline(always)]
   fn write_rfq_signed_parlay_leg(&mut self, leg: &RfqSignedParlayLeg) -> Result<(), ProgramError> {
      self.write_market_id(&leg.market_id)?;
      self.write_event_game_state(&leg.event_game_state)?;
      self.write_u16(leg.event_state_sequence)?;
      self.write_u32(leg.odds_scaled)?;
      self.write_u8(leg.side)
   }

   #[inline(always)]
   fn write_rfq_signed_parlay_leg_table(
      &mut self,
      table: &RfqSignedParlayLegTable,
   ) -> Result<(), ProgramError> {
      self.write_rfq_signed_parlay_leg(&table.leg_0)?;
      self.write_rfq_signed_parlay_leg(&table.leg_1)?;
      self.write_rfq_signed_parlay_leg(&table.leg_2)?;
      self.write_rfq_signed_parlay_leg(&table.leg_3)?;
      self.write_rfq_signed_parlay_leg(&table.leg_4)
   }

   #[inline(always)]
   fn write_offer_tail(
      &mut self,
      max_stake: u64,
      odds_scaled: u32,
      offer_expiry: u32,
      mm_program_id: &Address,
   ) -> Result<(), ProgramError> {
      self.write_u64(max_stake)?;
      self.write_u32(odds_scaled)?;
      self.write_u32(offer_expiry)?;
      self.write_address(mm_program_id)
   }
}

/// Build the canonical single-bet RFQ message bytes for ed25519 verification.
#[inline(never)]
pub fn build_rfq_bet_message(
   out: &mut [u8],
   user: &Address,
   bet_id: u64,
   market_id: &MarketId,
   event_game_state: &EventGameState,
   event_state_sequence: u16,
   side: u8,
   max_stake: u64,
   odds_scaled: u32,
   offer_expiry: u32,
   mm_program_id: &Address,
) -> Result<(), ProgramError> {
   let mut w = WireBuf::exact(out, RFQ_BET_MESSAGE_LEN)?;
   w.write_u8(RFQ_NETWORK_DOMAIN)?;
   w.write_address(user)?;
   w.write_u64(bet_id)?;
   w.write_market_id(market_id)?;
   w.write_event_game_state(event_game_state)?;
   w.write_u16(event_state_sequence)?;
   w.write_u8(side)?;
   w.write_offer_tail(max_stake, odds_scaled, offer_expiry, mm_program_id)
}

/// Build the canonical parlay RFQ message bytes (fixed `MAX_PARLAY_LEGS` leg slots).
#[inline(never)]
pub fn build_rfq_parlay_message(
   out: &mut [u8],
   user: &Address,
   bet_id: u64,
   num_legs: u8,
   legs: &ParlayLegTable,
   max_stake: u64,
   odds_scaled: u32,
   offer_expiry: u32,
   mm_program_id: &Address,
) -> Result<(), ProgramError> {
   let signed_legs = rfq_signed_parlay_leg_table(num_legs, legs);
   let mut w = WireBuf::exact(out, RFQ_PARLAY_MESSAGE_LEN)?;
   w.write_u8(RFQ_NETWORK_DOMAIN)?;
   w.write_address(user)?;
   w.write_u64(bet_id)?;
   w.write_u8(num_legs)?;
   w.write_rfq_signed_parlay_leg_table(&signed_legs)?;
   w.write_offer_tail(max_stake, odds_scaled, offer_expiry, mm_program_id)
}
