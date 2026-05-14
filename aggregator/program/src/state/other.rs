use pinocchio::{Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::state::EventId;


#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct ConfigPdaData {
   pub discriminator: u8,
   pub status: u8,
   pub authority: Address,
   /// Address lookup table owned by `ADDRESS_LOOKUP_TABLE_PROGRAM`; authority = config PDA.
   pub lookup_table: Address,
}

pub const CONFIG_PDA_DISCRIMINATOR: u8 = 2;
pub const CONFIG_PDA_LEN: usize = <ConfigPdaData as ZeroPodFixed>::SIZE;
pub const CONFIG_PDA_STATUS_OFFSET: usize = 1;
pub const CONFIG_PDA_AUTHORITY_OFFSET: usize = 2;
pub const CONFIG_PDA_LOOKUP_TABLE_OFFSET: usize = 34;

const _: () = assert!(core::mem::size_of::<ConfigPdaData>() == CONFIG_PDA_LEN);


#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct MmListPdaData {
   pub discriminator: u8,
   pub number_of_mms: u16,
   //pub mms: [Address; number_of_mms],
}
pub const MM_LIST_PDA_DISCRIMINATOR: u8 = 3;
pub const MM_LIST_HEADER_LEN: usize = <MmListPdaData as ZeroPodFixed>::SIZE;
pub const MM_LIST_PDA_NUMBER_OF_MMS_OFFSET: usize = 1;


pub const EVENT_STATE_SEED: &[u8] = b"event_state";
pub const EVENT_STATE_DISCRIMINATOR: u8 = 4;

/// Packed live snapshot carried on the event-state PDA and echoed in quote / fill instruction data.
/// Wire order is fixed; equality is defined as matching little-endian `u64` over the eight bytes.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct EventGameState {
   /// Up to four ASCII bytes for the game phase label (e.g. `"PG"`, `"T1"`); shorter labels pad with `0`.
   pub game_phase: [u8; 4],
   pub home_primary: u8,
   pub away_primary: u8,
   pub home_secondary: u8,
   pub away_secondary: u8,
}
pub const EVENT_GAME_STATE_LEN: usize = <EventGameState as ZeroPodFixed>::SIZE;

impl PartialEq for EventGameState {
   #[inline(always)]
   fn eq(&self, other: &Self) -> bool {
      self.as_u64() == other.as_u64()
   }
}

impl Eq for EventGameState {}

impl EventGameState {
   #[inline(always)]
   pub const fn zeroed() -> Self {
      Self {
         game_phase: [0u8; 4],
         home_primary: 0,
         away_primary: 0,
         home_secondary: 0,
         away_secondary: 0,
      }
   }

   #[inline(always)]
   pub fn as_u64(self) -> u64 {
      let mut b = [0u8; 8];
      b[..4].copy_from_slice(&self.game_phase);
      b[4] = self.home_primary;
      b[5] = self.away_primary;
      b[6] = self.home_secondary;
      b[7] = self.away_secondary;
      u64::from_le_bytes(b)
   }

   #[inline(always)]
   pub fn to_zc(self) -> EventGameStateZc {
      EventGameStateZc {
         game_phase: self.game_phase,
         home_primary: self.home_primary,
         away_primary: self.away_primary,
         home_secondary: self.home_secondary,
         away_secondary: self.away_secondary,
      }
   }

   #[inline(always)]
   pub fn from_zc(z: &EventGameStateZc) -> Self {
      Self {
         game_phase: z.game_phase,
         home_primary: z.home_primary,
         away_primary: z.away_primary,
         home_secondary: z.home_secondary,
         away_secondary: z.away_secondary,
      }
   }

   #[inline(always)]
   pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
      let z = <Self as ZeroPodFixed>::from_bytes(data).map_err(|_| ProgramError::InvalidInstructionData)?;
      Ok(Self::from_zc(&z))
   }
}

#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct EventStateData {
   pub discriminator: u8,
   pub bump: u8,
   pub event_id: EventId,
   pub sequence: u16,
   pub game_state: EventGameState,
}

pub const EVENT_STATE_LEN: usize = <EventStateData as ZeroPodFixed>::SIZE;

pub const MM_MARKET_DATA_PDA_SEED: &[u8] = b"market_data";
pub const MM_MARKET_DATA_PDA_DISCRIMINATOR: u8 = 0;
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct MmMarketDataPdaData {
   pub discriminator: u8,
   pub bump: u8
   // anything else they want
}
pub const MM_MARKET_DATA_PDA_MIN_LEN: usize = <MmMarketDataPdaData as ZeroPodFixed>::SIZE;
pub const MM_MARKET_DATA_PDA_BUMP_OFFSET: usize = 1;


pub const MM_ENCUMBRANCE_PDA_SEED: &[u8] = b"encumbrance";
pub const MM_ENCUMBRANCE_PDA_DISCRIMINATOR: u8 = 5;
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct MmEncumbrancePdaData {
   pub discriminator: u8,
   pub bump: u8,
   pub encumbrance: i64,
}
pub const MM_ENCUMBRANCE_PDA_LEN: usize = <MmEncumbrancePdaData as ZeroPodFixed>::SIZE;
pub const MM_ENCUMBRANCE_PDA_BUMP_OFFSET: usize = 1;
pub const MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET: usize = 2;
