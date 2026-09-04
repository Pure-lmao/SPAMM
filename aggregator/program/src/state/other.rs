use core::mem::offset_of;

use pinocchio::{Address, error::ProgramError};
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::constants::ADDRESS_LEN;
use crate::state::EventId;


#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct ConfigPdaData {
   pub discriminator: u8,
   pub status: u8,
   pub authority: Address,
}

pub const CONFIG_PDA_DISCRIMINATOR: u8 = 4;
/// Aggregator config PDA packed size (`discriminator` + `status` + `authority`).
pub const CONFIG_PDA_LEN: usize = <ConfigPdaData as ZeroPodFixed>::SIZE;
pub const CONFIG_PDA_STATUS_OFFSET: usize = offset_of!(ConfigPdaDataZc, status);
pub const CONFIG_PDA_AUTHORITY_OFFSET: usize = offset_of!(ConfigPdaDataZc, authority);


#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct MmListPdaData {
   pub discriminator: u8,
   pub number_of_mms: u16,
   //pub mms: [Address; number_of_mms],
}
pub const MM_LIST_PDA_DISCRIMINATOR: u8 = 3;
pub const MM_LIST_HEADER_LEN: usize = <MmListPdaData as ZeroPodFixed>::SIZE;
pub const MM_LIST_PDA_NUMBER_OF_MMS_OFFSET: usize = offset_of!(MmListPdaDataZc, number_of_mms);
pub const MM_LIST_ENTRY_LEN: usize = ADDRESS_LEN;


pub const EVENT_STATE_SEED: &[u8] = b"event_state";
pub const EVENT_STATE_DISCRIMINATOR: u8 = 104;

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
   pub fn as_u64(&self) -> u64 {
      u64::from_le_bytes([
         self.game_phase[0],
         self.game_phase[1],
         self.game_phase[2],
         self.game_phase[3],
         self.home_primary,
         self.away_primary,
         self.home_secondary,
         self.away_secondary,
      ])
   }

   #[inline(always)]
   pub fn to_zc(&self) -> EventGameStateZc {
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

/// Fixed prefix of the MM event-state PDA. Accounts may be longer; bytes after this header are MM-owned.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct EventStateData {
   pub discriminator: u8,
   pub bump: u8,
   pub event_id: EventId,
   pub sequence: u16,
   pub game_state: EventGameState,
}

pub const EVENT_STATE_HEADER_LEN: usize = <EventStateData as ZeroPodFixed>::SIZE;
pub const EVENT_STATE_DISCRIMINATOR_OFFSET: usize = offset_of!(EventStateDataZc, discriminator);
pub const EVENT_STATE_BUMP_OFFSET: usize = offset_of!(EventStateDataZc, bump);
pub const EVENT_STATE_SEQUENCE_OFFSET: usize = offset_of!(EventStateDataZc, sequence);
pub const EVENT_STATE_GAME_STATE_OFFSET: usize = offset_of!(EventStateDataZc, game_state);

pub const MM_MARKET_DATA_PDA_SEED: &[u8] = b"market_data";
pub const MM_MARKET_DATA_PDA_DISCRIMINATOR: u8 = 100;
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct MmMarketDataPdaData {
   pub discriminator: u8,
   pub bump: u8
   // anything else they want
}
pub const MM_MARKET_DATA_PDA_MIN_LEN: usize = <MmMarketDataPdaData as ZeroPodFixed>::SIZE;
pub const MM_MARKET_DATA_PDA_BUMP_OFFSET: usize = offset_of!(MmMarketDataPdaDataZc, bump);


pub const MM_ENCUMBRANCE_PDA_SEED: &[u8] = b"encumbrance";
pub const MM_ENCUMBRANCE_PDA_DISCRIMINATOR: u8 = 5;
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct MmEncumbrancePdaData {
   pub discriminator: u8,
   pub bump: u8,
   /// Sum of per-line peaks (and unnetted ticket P). Withdraw/deregister reserve.
   pub encumbrance: i64,
}
pub const MM_ENCUMBRANCE_PDA_LEN: usize = <MmEncumbrancePdaData as ZeroPodFixed>::SIZE;
pub const MM_ENCUMBRANCE_PDA_BUMP_OFFSET: usize = offset_of!(MmEncumbrancePdaDataZc, bump);
pub const MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET: usize = offset_of!(MmEncumbrancePdaDataZc, encumbrance);
