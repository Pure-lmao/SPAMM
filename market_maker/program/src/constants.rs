use pinocchio::Address;

/// Deploy-time program id (replace with your program address).
pub const ID: Address = Address::new_from_array([
   0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
   0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/// PDA seed for per-market odds / oracle data (`["market_data", market_id_wire]`).
pub const MM_MARKET_DATA_PDA_SEED: &[u8] = b"market_data";

/// PDA seed for the single per-program MM quote buffer (see framework README).
pub const MM_QUOTE_BUFFER_SEED: &[u8] = b"mm_quote_buffer";

/// Max stake offered at quote: `100 * 10**6` units (6 decimals).
pub const MAX_QUOTE_STAKE_UNITS: u64 = 100 * 1_000_000;
