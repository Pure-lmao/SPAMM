use pinocchio::Address;
use zeropod::{ZeroPod, ZeroPodFixed};

use crate::state::EventId;


#[repr(C)]
#[derive(Copy, Clone, ZeroPod)]
pub struct ConfigPdaData {
   pub discriminator: u8,
   pub status: u8,
   pub authority: Address,
}

pub const CONFIG_PDA_DISCRIMINATOR: u8 = 2;
pub const CONFIG_PDA_LEN: usize = <ConfigPdaData as ZeroPodFixed>::SIZE;
pub const CONFIG_PDA_STATUS_OFFSET: usize = 1;
pub const CONFIG_PDA_AUTHORITY_OFFSET: usize = 2;

const _: () = assert!(CONFIG_PDA_LEN == 34);


#[derive(Copy, Clone, ZeroPod)]
pub struct MmListPdaData {
   pub discriminator: u8,
   pub number_of_mms: u16,
   //pub mms: [Address; number_of_mms],
}
pub const MM_LIST_PDA_DISCRIMINATOR: u8 = 3;
pub const MM_LIST_HEADER_LEN: usize = <MmListPdaData as ZeroPodFixed>::SIZE;
pub const MM_LIST_PDA_NUMBER_OF_MMS_OFFSET: usize = 1;

const _: () = assert!(MM_LIST_HEADER_LEN == 3);

pub const EVENT_STATE_SEED: &[u8] = b"event_state";
pub const EVENT_STATE_DISCRIMINATOR: u8 = 3;

#[derive(Copy, Clone, ZeroPod)]
pub struct EventStateData {
   pub discriminator: u8,
   pub bump: u8,
   pub event_id: EventId,
   pub sequence: u16,
   pub state_hash: [u8; 32],
}

pub const EVENT_STATE_LEN: usize = <EventStateData as ZeroPodFixed>::SIZE;

const _: () = assert!(EVENT_STATE_LEN == 49);

pub const MM_MARKET_DATA_PDA_SEED: &[u8] = b"market_data";
pub const MM_MARKET_DATA_PDA_DISCRIMINATOR: u8 = 0;
#[derive(Copy, Clone, ZeroPod)]
pub struct MmMarketDataPdaData {
   pub discriminator: u8,
   pub bump: u8
   // anything else they want
}
pub const MM_MARKET_DATA_PDA_MIN_LEN: usize = <MmMarketDataPdaData as ZeroPodFixed>::SIZE;
pub const MM_MARKET_DATA_PDA_BUMP_OFFSET: usize = 1;


pub const MM_ENCUMBRANCE_PDA_SEED: &[u8] = b"encumbrance";
pub const MM_ENCUMBRANCE_PDA_DISCRIMINATOR: u8 = 4;
#[derive(Copy, Clone, ZeroPod)]
pub struct MmEncumbrancePdaData {
   pub discriminator: u8,
   pub bump: u8,
   pub encumbrance: i64,
}
pub const MM_ENCUMBRANCE_PDA_LEN: usize = <MmEncumbrancePdaData as ZeroPodFixed>::SIZE;
pub const MM_ENCUMBRANCE_PDA_BUMP_OFFSET: usize = 1;
pub const MM_ENCUMBRANCE_PDA_ENCUMBRANCE_OFFSET: usize = 2;

const _: () = assert!(MM_ENCUMBRANCE_PDA_LEN == 10);