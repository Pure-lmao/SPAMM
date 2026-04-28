use pinocchio::Address;
use zeropod::{ZeroPod, ZeroPodFixed};


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

/// Aggregator-owned MM registry PDA body (single seed [`crate::constants::MM_LIST_PDA_SEED`]).
/// Wire layout: byte `0` = discriminator, bytes `1..3` = `number_of_mms` (LE), then `number_of_mms`
/// × 32-byte [`Address`] values (MM program ids).
pub const MM_LIST_PDA_DISCRIMINATOR: u8 = 10;
pub const MM_LIST_HEADER_LEN: usize = 1 + 2;
pub const MM_LIST_PDA_NUMBER_OF_MMS_OFFSET: usize = 1;

const _: () = assert!(MM_LIST_HEADER_LEN == 3);

pub const EVENT_STATE_SEED: &[u8] = b"event_state";
pub const EVENT_STATE_DISCRIMINATOR: u8 = 3;

#[derive(Copy, Clone, ZeroPod)]
pub struct EventStateData {
   pub discriminator: u8,
   pub bump: u8,
   pub sequence: u16,
   pub state_hash: [u8; 32],
}

pub const EVENT_STATE_LEN: usize = <EventStateData as ZeroPodFixed>::SIZE;

const _: () = assert!(EVENT_STATE_LEN == 36);

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

pub const LIABILITY_TOKEN_ACCOUNT_SEED: &[u8] = b"liability_token_account";