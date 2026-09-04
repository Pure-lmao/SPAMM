use pinocchio::Address;

pub const ADDRESS_LEN: usize = core::mem::size_of::<Address>();
pub const U32_LEN: usize = core::mem::size_of::<u32>();
pub const U64_LEN: usize = core::mem::size_of::<u64>();

pub const MAX_NUMBER_OF_MMS: usize = 5;

/// Max MMs per `get_quote_proxy` / `get_parlay_quote_proxy` (quote-only; larger than fill cap).
pub const MAX_NUMBER_OF_MMS_PROXY: usize = 20;

/// Max SPL token sub-instructions in one `settle_bet` CPI batch (tight bound):
/// 5 fillers × (1 enc→user + 1 bet→…) + bet→user (stake) + bet→user (dust) + ATA close = 13.
pub const SETTLE_BET_TOKEN_BATCH_IX_CAP: usize = 13;

/// Flattened CPI account slots for that batch (`Transfer` / `CloseAccount` each use 3 accounts).
pub const SETTLE_BET_TOKEN_BATCH_CPI_ACCOUNTS: usize = SETTLE_BET_TOKEN_BATCH_IX_CAP * 3;

/// Max SPL token sub-instructions in `settle_parlay` batch CPI.
pub const SETTLE_PARLAY_TOKEN_BATCH_IX_CAP: usize = 8;

/// Flattened CPI account slots for `settle_parlay` batch (`Transfer` / `CloseAccount` each use 3 accounts).
pub const SETTLE_PARLAY_TOKEN_BATCH_CPI_ACCOUNTS: usize = SETTLE_PARLAY_TOKEN_BATCH_IX_CAP * 3;

/// Max `Transfer::DATA_LEN` / `CloseAccount::DATA_LEN` in batch is 9; use 9 for buffer sizing.
pub const SETTLE_TOKEN_BATCH_MAX_INNER_DATA: usize = 9;

/// Max SPL token sub-instructions in `safe_close_ata` (optional transfer + close).
pub const SAFE_CLOSE_ATA_BATCH_IX_CAP: usize = 2;

/// Flattened CPI account slots for `safe_close_ata` batch.
pub const SAFE_CLOSE_ATA_BATCH_CPI_ACCOUNTS: usize = SAFE_CLOSE_ATA_BATCH_IX_CAP * 3;

/// Max legs for auction fill / cashout / get-quote (per-leg market + event PDAs).
pub const MAX_PARLAY_LEGS: usize = 20;

/// Max legs for RFQ fill / cashout, signed messages, and RFQ-created bet PDAs.
pub const MAX_RFQ_PARLAY_LEGS: usize = 40;

pub const MAX_PARLAY_QUOTE_CPI_ACCOUNTS: usize = 4 + 2 * MAX_PARLAY_LEGS;

pub const ODDS_SCALE: u128 = 10000;

/// Seconds between a live cashout fill and permissionless escrow claim.
/// Compared to `Clock::unix_timestamp`, not slots.
pub const LIVE_CASHOUT_DELAY: u32 = 30;

/// Minimum fill / issue stake: $0.10 USDC at 6 decimals (`0.1 * 10^6`).
/// Cashout of a remaining slice below this is still allowed so tickets can fully exit.
pub const MIN_BET_AMOUNT: u64 = 100_000;

/// Skip an auction MM whose slice would be below this. $0.1 USDC at 6 decimals.
pub const MIN_FILLER_AMOUNT: u64 = 100_000;

/// CPI account slots for an RFQ-sized parlay quote (`4 + 2 * MAX_RFQ_PARLAY_LEGS`).
pub const MAX_RFQ_PARLAY_QUOTE_CPI_ACCOUNTS: usize = 4 + 2 * MAX_RFQ_PARLAY_LEGS;

/// Max MM program ids on a freebet whitelist (`num_mms == 0` means any MM).
pub const MAX_FREEBET_ALLOWED_MMS: usize = 10;

/// Max market operators on a freebet whitelist (`num_operators == 0` means any operator).
pub const MAX_FREEBET_ALLOWED_OPERATORS: usize = 5;

/// Push / Cancelled / RolledBack / half-grade freebet reinstatement window.
pub const FREEBET_REINSTATE_SECS: u32 = 3 * 86400;

/// RFQ signed-message network domain values (first byte of canonical quote messages; kind is second).
pub const RFQ_NETWORK_MAINNET: u8 = 1;
pub const RFQ_NETWORK_DEVNET: u8 = 2;
pub const RFQ_NETWORK_LOCAL: u8 = 3;

// 5pammQjfw9f1oWtL9rLipVuYf5ufmzeKVeRwrXcA961H
pub const ID: Address = Address::new_from_array([
   0x47, 0x9f, 0x3b, 0x4d, 0x99, 0x66, 0x4a, 0x69, 0x1f, 0x03, 0x08, 0x28, 0x72, 0x9c, 0x0f, 0x85,
   0x48, 0xd3, 0x06, 0x11, 0xc1, 0x83, 0xac, 0xcf, 0x87, 0x3d, 0xb1, 0x15, 0x39, 0x0f, 0x95, 0x74,
]);

pub const CONFIG_PDA_SEED: &[u8] = b"config";
pub const CONFIG_PDA_BUMP: u8 = 255;
// ZcXq4zwiRPUwHXm1mLtnDDyo2R1QbFzDYQS6BUD97FQ
pub const CONFIG_PDA: Address = Address::new_from_array([
   0x08, 0x5a, 0xc2, 0xf2, 0xfb, 0xd0, 0x2d, 0x00, 0x41, 0x76, 0x8a, 0xca, 0xda, 0x07, 0x38, 0x10,
   0x53, 0x47, 0x4e, 0xe5, 0x39, 0x9b, 0xeb, 0x98, 0x29, 0x2f, 0x2b, 0x43, 0x8d, 0x6a, 0x75, 0xfb,
]);
pub const MM_LIST_PDA_SEED: &[u8] = b"mm_list";
pub const MM_LIST_BUMP: u8 = 253;
// Ey53b5ueZCFpS2bcrdk6Aa1epWQqP6B6ra1Xp2qr77NK
pub const MM_LIST_PDA: Address = Address::new_from_array([
   0xcf, 0x85, 0x07, 0x53, 0x14, 0xaa, 0xf5, 0xd8, 0x36, 0x0e, 0xb6, 0x31, 0x6e, 0x55, 0x1d, 0x57,
   0x31, 0x9d, 0xc8, 0xc7, 0x00, 0x63, 0x2a, 0x22, 0xa0, 0x08, 0x36, 0xbc, 0x97, 0xb4, 0x4c, 0x6c,
]);

// Cluster-specific values: always exported (single item) so IDE/rust-analyzer never sees
// missing imports. `mainnet` wins when enabled; otherwise devnet (including default builds).

/// Baked into RFQ ed25519 messages so a quote from another cluster cannot verify here.
pub const RFQ_NETWORK_DOMAIN: u8 = if cfg!(feature = "mainnet") {
   RFQ_NETWORK_MAINNET
} else {
   RFQ_NETWORK_DEVNET
};

/// USDC mint for the active cluster.
pub const MINT: Address = if cfg!(feature = "mainnet") {
   // EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
   Address::new_from_array([
      0xc6, 0xfa, 0x7a, 0xf3, 0xbe, 0xdb, 0xad, 0x3a, 0x3d, 0x65, 0xf3, 0x6a, 0xab, 0xc9, 0x74, 0x31,
      0xb1, 0xbb, 0xe4, 0xc2, 0xd2, 0xf6, 0xe0, 0xe4, 0x7c, 0xa6, 0x02, 0x03, 0x45, 0x2f, 0x5d, 0x61,
   ])
} else {
   // Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
   Address::new_from_array([
      0xe9, 0x28, 0x39, 0x55, 0x09, 0x65, 0xff, 0xd4, 0xd6, 0x4a, 0xca, 0xaf, 0x46, 0xd4, 0x5d, 0xf7,
      0x31, 0x8e, 0x5b, 0x4f, 0x57, 0xc9, 0x0c, 0x48, 0x7d, 0x60, 0x62, 0x5d, 0x82, 0x9b, 0x83, 0x7b,
   ])
};
