//! Wire `EventId` / `MarketId` via [zeropod](https://github.com/blueshift-gg/zeropod) (alignment-1 packed layouts).

use pinocchio::Address;
use zeropod::{ZeroPod, ZeroPodFixed};

#[derive(Copy, Clone, Debug, Eq, PartialEq, ZeroPod)]
#[repr(u8)]
pub enum Sport {
   None = 0,
   Soccer = 1,
   AmericanFootball = 2,
   Baseball = 3,
   Basketball = 4,
   IceHockey = 5,
}

impl Sport {
   #[inline(always)]
   pub fn to_bytes(self) -> u8 {
      self as u8
   }

   #[inline(always)]
   pub fn try_from_wire_byte(byte: u8) -> Option<Self> {
      match byte {
         0 => Some(Sport::None),
         1 => Some(Sport::Soccer),
         2 => Some(Sport::AmericanFootball),
         3 => Some(Sport::Baseball),
         4 => Some(Sport::Basketball),
         5 => Some(Sport::IceHockey),
         _ => None,
      }
   }

   #[inline(always)]
   pub fn from_bytes(bytes: u8) -> Self {
      Self::try_from_wire_byte(bytes).expect("Invalid sport bytes")
   }
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct EventId {
   pub event: u64,
   pub league: u16,
   pub sport: Sport,
}

impl EventId {
   pub const WIRE_SIZE: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn eq(&self, other: &Self) -> bool {
      self.event == other.event
      && self.league == other.league
      && self.sport == other.sport
   }

   #[inline(always)]
   pub fn to_zc(self) -> EventIdZc {
      EventIdZc {
         event: self.event.into(),
         league: self.league.into(),
         sport: self.sport.into(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &EventIdZc) -> Option<Self> {
      Some(Self {
         event: z.event.get(),
         league: z.league.get(),
         sport: Sport::try_from_wire_byte(z.sport.get())?,
      })
   }

   /// Packed wire bytes for PDA seeds and hashing.
   #[inline(always)]
   pub fn as_wire_bytes(&self) -> [u8; Self::WIRE_SIZE] {
      let zc = self.to_zc();
      let mut out = [0u8; Self::WIRE_SIZE];
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      out
   }

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Option<Self> {
      if data.len() != Self::WIRE_SIZE {
         return None;
      }
      let zc = Self::from_bytes(data).ok()?;
      Self::from_zc(zc)
   }
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct MarketId {
   pub event_id: EventId,
   pub player: u64,
   pub mkt: u16,
   pub period: u8,
   pub is_pregame: bool,
   /// Address responsible for grading bets on this market.
   pub operator: Address,
}
pub const MARKET_ID_LEN: usize = <MarketId as ZeroPodFixed>::SIZE;

/// `MarketId` wire bytes before `operator` (legacy pre-operator layout; fits in one PDA seed).
pub const MARKET_ID_BODY_WIRE_LEN: usize = MARKET_ID_LEN - 32;
pub const MARKET_ID_OPERATOR_WIRE_LEN: usize = 32;
const _: () = assert!(MARKET_ID_BODY_WIRE_LEN < 32);

/// PDA seeds: `["market_data", market_id_body_wire, operator]` — body is the legacy `MarketId` wire without `operator`.
#[inline(always)]
pub fn market_id_pda_seed_parts(wire: &[u8; MARKET_ID_LEN]) -> (&[u8], &[u8]) {
   wire.split_at(MARKET_ID_BODY_WIRE_LEN)
}

/// Side count for a market type (`mkt`), per `id-system.md`.
#[inline(always)]
pub fn num_sides_for_mkt(mkt: u16) -> Option<u8> {
   match mkt {
      0 | 4 => Some(2),
      1 | 5 => Some(3),
      6 => Some(6),
      7 => Some(9),
      9 => Some(1),
      10..=50 => Some(2),
      51..=99 => Some(2),
      100..=299 => Some(2),
      300..=499 => Some(2),
      1000..=1999 => Some(2),
      2000..=2999 => Some(2),
      3000..=3999 => Some(2),
      4000..=4999 => Some(4),
      5000..=5999 => Some(6),
      10000..=10909 => Some(1),
      _ => None,
   }
}

impl MarketId {
   pub const WIRE_SIZE: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn num_sides(&self) -> Option<u8> {
      num_sides_for_mkt(self.mkt)
   }

   #[inline(always)]
   pub fn is_pregame(&self) -> bool {
      self.is_pregame
   }

   #[inline(always)]
   pub fn eq(&self, other: &Self) -> bool {
      self.event_id.eq(&other.event_id)
      && self.player == other.player
      && self.mkt == other.mkt
      && self.period == other.period
      && self.is_pregame == other.is_pregame
      && self.operator == other.operator
   }

   #[inline(always)]
   pub fn to_zc(self) -> MarketIdZc {
      MarketIdZc {
         event_id: self.event_id.to_zc(),
         player: self.player.into(),
         mkt: self.mkt.into(),
         period: self.period,
         is_pregame: self.is_pregame.into(),
         operator: self.operator,
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &MarketIdZc) -> Option<Self> {
      Some(Self {
         event_id: EventId::from_zc(&z.event_id)?,
         player: z.player.get(),
         mkt: z.mkt.get(),
         period: z.period,
         is_pregame: z.is_pregame.get(),
         operator: z.operator,
      })
   }

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Option<Self> {
      if data.len() != Self::WIRE_SIZE {
         return None;
      }
      let zc = Self::from_bytes(data).ok()?;
      Self::from_zc(zc)
   }

   #[inline(always)]
   pub fn as_bytes(self) -> [u8; Self::WIRE_SIZE] {
      let zc = self.to_zc();
      let mut out = [0u8; Self::WIRE_SIZE];
      unsafe {
         core::ptr::write(out.as_mut_ptr().cast(), zc);
      }
      out
   }

   //allow netting on 4 (btts) and 51-199 (ou and ah)
   #[inline(always)]
   pub fn allow_add_netting_line(sport: Sport, period: u8, mkt: u16) -> bool {
      if mkt != 4 && (mkt < 51 || mkt > 1999) {
         return false;
      }
      match sport {
         Sport::Soccer => !matches!(mkt, 1 | 5),
         _ => !(period == 0 && mkt == 0),
      }
   }
}
