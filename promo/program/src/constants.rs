use pinocchio::Address;

/// ProMo6Ka3N1JLCaZrNTwnANQsCCfyKAm6R5TXM14LVQ
pub const ID: Address = Address::new_from_array([
   0x05, 0xdb, 0x16, 0x06, 0x1b, 0x8f, 0x85, 0x57, 0x40, 0xab, 0x96, 0xba, 0xe6, 0x57, 0xd3, 0x4d,
   0x74, 0x92, 0x7a, 0x3a, 0x33, 0xae, 0x4b, 0x15, 0x30, 0x62, 0xf5, 0xc1, 0x48, 0xe1, 0xc3, 0x93,
]);

/// PDA seed for per-market odds / oracle data (`["market_data", market_id_wire]`).
pub const MM_MARKET_DATA_PDA_SEED: &[u8] = b"market_data";

/// PDA seed for the single per-program MM quote buffer (`["mm_quote_buffer"]`).
pub const MM_QUOTE_BUFFER_SEED: &[u8] = b"mm_quote_buffer";

/// PDA seed for the per-program parlay quote buffer (`["mm_parlay_quote_buffer"]`).
pub const MM_PARLAY_QUOTE_BUFFER_SEED: &[u8] = b"mm_parlay_quote_buffer";

/// Promo markets use ASM `mkt` 9 only; bets are side 0 (yes/home) only.
pub const PROMO_MKT: u16 = 9;
pub const PROMO_SIDE: u8 = 0;

#[inline(always)]
pub fn find_config_pda(program_id: &Address) -> (Address, u8) {
   Address::find_program_address(&[spamm_aggregator::state::MM_ACCOUNT_CONFIG_SEED], program_id)
}

#[inline(always)]
pub fn find_quote_buffer_pda(program_id: &Address) -> (Address, u8) {
   Address::find_program_address(&[MM_QUOTE_BUFFER_SEED], program_id)
}

#[inline(always)]
pub fn find_parlay_quote_buffer_pda(program_id: &Address) -> (Address, u8) {
   Address::find_program_address(&[MM_PARLAY_QUOTE_BUFFER_SEED], program_id)
}
