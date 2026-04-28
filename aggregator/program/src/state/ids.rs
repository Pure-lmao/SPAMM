//! Wire `EventId` / `MarketId` via [zeropod](https://github.com/blueshift-gg/zeropod) (alignment-1 packed layouts).

use zeropod::{ZeroPod, ZeroPodFixed};

#[derive(Copy, Clone, Debug, Eq, PartialEq, ZeroPod)]
#[repr(u8)]
pub enum Sport {
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
pub struct EventId {
   pub event_id: u64,
   pub league: u32,
   pub sport: Sport,
}

impl EventId {
   pub const WIRE_SIZE: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn to_zc(self) -> EventIdZc {
      EventIdZc {
         event_id: self.event_id.into(),
         league: self.league.into(),
         sport: self.sport.into(),
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &EventIdZc) -> Option<Self> {
      Some(Self {
         event_id: z.event_id.get(),
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
pub struct MarketId {
   pub event_id: EventId,
   pub player: u64,
   pub mkt: u32,
   pub period: u8,
   pub is_pregame: bool,
}

impl MarketId {
   pub const WIRE_SIZE: usize = <Self as ZeroPodFixed>::SIZE;

   #[inline(always)]
   pub fn is_pregame(&self) -> bool {
      self.is_pregame
   }

   #[inline(always)]
   pub fn to_zc(self, for_seed: bool) -> MarketIdZc {
      // If for_seed is true, we need to modify the mkt to be 1 for mkt 2 and 3, and 5 for mkt 6 and 7
      // this is to keep the mm_market_data account seeds for FT and DC together
      let mkt = if for_seed {
         if self.mkt == 2 || self.mkt == 3 {
            1
         } else if self.mkt == 6 || self.mkt == 7 {
            5
         } else {
            self.mkt
         }
      } else {
         self.mkt
      };
      MarketIdZc {
         event_id: self.event_id.to_zc(),
         player: self.player.into(),
         mkt: mkt.into(),
         period: self.period,
         is_pregame: self.is_pregame.into(),
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
}

const _: () = assert!(<EventId as ZeroPodFixed>::SIZE == 13);
const _: () = assert!(<MarketId as ZeroPodFixed>::SIZE == 27);
