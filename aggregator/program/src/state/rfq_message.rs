//! Canonical RFQ signed-message wire layouts (shared by on-chain verify + off-chain SDK).
//! Packed [`ZeroPod`] structs, same as instruction / account wires.

use pinocchio::{Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::{
   constants::{
      MAX_RFQ_PARLAY_LEGS, 
      RFQ_NETWORK_DOMAIN
   },
};

use super::{
   ids::MarketId,
   ix_fill_parlay_cashout::{CashoutSnapshot, CASHOUT_SNAPSHOT_LEN},
   mm_parlay_quote::{write_parlay_leg_quoted, ParlayLegQuoted, PARLAY_LEG_QUOTED_LEN},
   other::EventGameState,
};

/// RFQ signed-message kind (byte after `network_domain`).
pub const RFQ_BET_MESSAGE_KIND: u8 = 1;
pub const RFQ_PARLAY_MESSAGE_KIND: u8 = 2;
pub const RFQ_CASHOUT_MESSAGE_KIND: u8 = 3;
pub const RFQ_CASHOUT_PARLAY_MESSAGE_KIND: u8 = 4;

/// Single-bet RFQ signed message (`network_domain` … `mm_program_id`).
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct RfqBetMessage {
   pub network_domain: u8,
   pub kind: u8,
   pub user: Address,
   pub bet_id: u64,
   pub market_id: MarketId,
   pub event_game_state: EventGameState,
   pub event_state_sequence: u16,
   pub side: u8,
   pub max_stake: u64,
   pub odds_scaled: u32,
   pub offer_expiry: u32,
   pub mm_program_id: Address,
}

pub const RFQ_BET_MESSAGE_LEN: usize = <RfqBetMessage as ZeroPodFixed>::SIZE;

impl RfqBetMessage {
   #[inline(always)]
   fn to_zc(&self) -> RfqBetMessageZc {
      RfqBetMessageZc {
         network_domain: self.network_domain,
         kind: self.kind,
         user: self.user,
         bet_id: self.bet_id.into(),
         market_id: self.market_id.to_zc(),
         event_game_state: self.event_game_state.to_zc(),
         event_state_sequence: self.event_state_sequence.into(),
         side: self.side,
         max_stake: self.max_stake.into(),
         odds_scaled: self.odds_scaled.into(),
         offer_expiry: self.offer_expiry.into(),
         mm_program_id: self.mm_program_id,
      }
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != RFQ_BET_MESSAGE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}

/// Parlay RFQ prefix; `num_legs` is last so live legs start immediately after the header.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct RfqParlayMessageHeader {
   pub network_domain: u8,
   pub kind: u8,
   pub user: Address,
   pub bet_id: u64,
   pub max_stake: u64,
   pub odds_scaled: u32,
   pub offer_expiry: u32,
   pub mm_program_id: Address,
   pub num_legs: u8,
}

pub const RFQ_PARLAY_MESSAGE_HEADER_LEN: usize = <RfqParlayMessageHeader as ZeroPodFixed>::SIZE;

impl RfqParlayMessageHeader {
   #[inline(always)]
   fn to_zc(&self) -> RfqParlayMessageHeaderZc {
      RfqParlayMessageHeaderZc {
         network_domain: self.network_domain,
         kind: self.kind,
         user: self.user,
         bet_id: self.bet_id.into(),
         max_stake: self.max_stake.into(),
         odds_scaled: self.odds_scaled.into(),
         offer_expiry: self.offer_expiry.into(),
         mm_program_id: self.mm_program_id,
         num_legs: self.num_legs,
      }
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8], legs: &[ParlayLegQuoted]) -> Result<(), ProgramError> {
      let n = self.num_legs as usize;
      let expected = rfq_parlay_message_len(n);
      if out.len() != expected || legs.len() != n {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      write_parlay_leg_quoted(&mut out[RFQ_PARLAY_MESSAGE_HEADER_LEN..], legs)
   }
}

#[inline(always)]
pub const fn rfq_parlay_message_len(num_legs: usize) -> usize {
   RFQ_PARLAY_MESSAGE_HEADER_LEN + num_legs * PARLAY_LEG_QUOTED_LEN
}

pub const RFQ_PARLAY_MESSAGE_LEN: usize = rfq_parlay_message_len(MAX_RFQ_PARLAY_LEGS);

/// Single-bet cashout RFQ signed message.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct RfqCashoutMessage {
   pub network_domain: u8,
   pub kind: u8,
   pub user: Address,
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub amount: u64,
   pub max_payment: u64,
   pub offer_expiry: u32,
   pub event_state_sequence: u16,
   pub event_game_state: EventGameState,
   pub mm_program_id: Address,
}

pub const RFQ_CASHOUT_MESSAGE_LEN: usize = <RfqCashoutMessage as ZeroPodFixed>::SIZE;

impl RfqCashoutMessage {
   #[inline(always)]
   fn to_zc(&self) -> RfqCashoutMessageZc {
      RfqCashoutMessageZc {
         network_domain: self.network_domain,
         kind: self.kind,
         user: self.user,
         orig_bet_id: self.orig_bet_id.into(),
         cashout_id: self.cashout_id.into(),
         amount: self.amount.into(),
         max_payment: self.max_payment.into(),
         offer_expiry: self.offer_expiry.into(),
         event_state_sequence: self.event_state_sequence.into(),
         event_game_state: self.event_game_state.to_zc(),
         mm_program_id: self.mm_program_id,
      }
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8]) -> Result<(), ProgramError> {
      if out.len() != RFQ_CASHOUT_MESSAGE_LEN {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      Ok(())
   }
}

/// Parlay cashout RFQ prefix; trailing bytes are [`CashoutSnapshot`] × `num_legs`.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct RfqCashoutParlayMessageHeader {
   pub network_domain: u8,
   pub kind: u8,
   pub user: Address,
   pub orig_bet_id: u64,
   pub cashout_id: u64,
   pub amount: u64,
   pub max_payment: u64,
   pub offer_expiry: u32,
   pub mm_program_id: Address,
   pub num_legs: u8,
}

pub const RFQ_CASHOUT_PARLAY_MESSAGE_HEADER_LEN: usize =
   <RfqCashoutParlayMessageHeader as ZeroPodFixed>::SIZE;

impl RfqCashoutParlayMessageHeader {
   #[inline(always)]
   fn to_zc(&self) -> RfqCashoutParlayMessageHeaderZc {
      RfqCashoutParlayMessageHeaderZc {
         network_domain: self.network_domain,
         kind: self.kind,
         user: self.user,
         orig_bet_id: self.orig_bet_id.into(),
         cashout_id: self.cashout_id.into(),
         amount: self.amount.into(),
         max_payment: self.max_payment.into(),
         offer_expiry: self.offer_expiry.into(),
         mm_program_id: self.mm_program_id,
         num_legs: self.num_legs,
      }
   }

   #[inline(always)]
   pub fn write_wire(&self, out: &mut [u8], snapshots: &[CashoutSnapshot]) -> Result<(), ProgramError> {
      let n = self.num_legs as usize;
      let expected = rfq_cashout_parlay_message_len(n);
      if out.len() != expected || snapshots.len() != n {
         return Err(ProgramError::InvalidInstructionData);
      }
      let zc = self.to_zc();
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      for i in 0..n {
         snapshots[i].write_at(out, RFQ_CASHOUT_PARLAY_MESSAGE_HEADER_LEN + i * CASHOUT_SNAPSHOT_LEN)?;
      }
      Ok(())
   }
}

#[inline(always)]
pub const fn rfq_cashout_parlay_message_len(num_legs: usize) -> usize {
   RFQ_CASHOUT_PARLAY_MESSAGE_HEADER_LEN + num_legs * CASHOUT_SNAPSHOT_LEN
}

pub const RFQ_CASHOUT_PARLAY_MESSAGE_LEN: usize =
   rfq_cashout_parlay_message_len(MAX_RFQ_PARLAY_LEGS);

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
   RfqBetMessage {
      network_domain: RFQ_NETWORK_DOMAIN,
      kind: RFQ_BET_MESSAGE_KIND,
      user: *user,
      bet_id,
      market_id: *market_id,
      event_game_state: *event_game_state,
      event_state_sequence,
      side,
      max_stake,
      odds_scaled,
      offer_expiry,
      mm_program_id: *mm_program_id,
   }
   .write_wire(out)
}

/// Build the canonical parlay RFQ message bytes.
#[inline(never)]
pub fn build_rfq_parlay_message(
   out: &mut [u8],
   user: &Address,
   bet_id: u64,
   num_legs: u8,
   legs: &[ParlayLegQuoted],
   max_stake: u64,
   odds_scaled: u32,
   offer_expiry: u32,
   mm_program_id: &Address,
) -> Result<(), ProgramError> {
   let n = num_legs as usize;
   if n < 2 || n > MAX_RFQ_PARLAY_LEGS || legs.len() < n {
      return Err(ProgramError::InvalidInstructionData);
   }
   RfqParlayMessageHeader {
      network_domain: RFQ_NETWORK_DOMAIN,
      kind: RFQ_PARLAY_MESSAGE_KIND,
      user: *user,
      bet_id,
      max_stake,
      odds_scaled,
      offer_expiry,
      mm_program_id: *mm_program_id,
      num_legs,
   }
   .write_wire(out, &legs[..n])
}

/// Build the canonical single-bet cashout RFQ message.
#[inline(never)]
pub fn build_rfq_cashout_message(
   out: &mut [u8],
   user: &Address,
   orig_bet_id: u64,
   cashout_id: u64,
   amount: u64,
   max_payment: u64,
   offer_expiry: u32,
   event_state_sequence: u16,
   event_game_state: &EventGameState,
   mm_program_id: &Address,
) -> Result<(), ProgramError> {
   RfqCashoutMessage {
      network_domain: RFQ_NETWORK_DOMAIN,
      kind: RFQ_CASHOUT_MESSAGE_KIND,
      user: *user,
      orig_bet_id,
      cashout_id,
      amount,
      max_payment,
      offer_expiry,
      event_state_sequence,
      event_game_state: *event_game_state,
      mm_program_id: *mm_program_id,
   }
   .write_wire(out)
}

/// Build the canonical parlay cashout RFQ message.
#[inline(never)]
pub fn build_rfq_cashout_parlay_message(
   out: &mut [u8],
   user: &Address,
   orig_bet_id: u64,
   cashout_id: u64,
   amount: u64,
   max_payment: u64,
   offer_expiry: u32,
   mm_program_id: &Address,
   num_legs: u8,
   snapshots: &[CashoutSnapshot],
) -> Result<(), ProgramError> {
   let n = num_legs as usize;
   if n < 2 || n > MAX_RFQ_PARLAY_LEGS || snapshots.len() < n {
      return Err(ProgramError::InvalidInstructionData);
   }
   RfqCashoutParlayMessageHeader {
      network_domain: RFQ_NETWORK_DOMAIN,
      kind: RFQ_CASHOUT_PARLAY_MESSAGE_KIND,
      user: *user,
      orig_bet_id,
      cashout_id,
      amount,
      max_payment,
      offer_expiry,
      mm_program_id: *mm_program_id,
      num_legs,
   }
   .write_wire(out, &snapshots[..n])
}
