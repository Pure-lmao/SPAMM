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

/// Smallest accepted SPL mint decimals. `0` cannot represent 0.1 of a token.
pub const MIN_MINT_DECIMALS: u8 = 1;

/// Largest accepted SPL mint decimals. If this changes, update `min_amount_for_decimals` in `account_verify.rs`.
pub const MAX_MINT_DECIMALS: u8 = 10;

/// CPI account slots for an RFQ-sized parlay quote (`4 + 2 * MAX_RFQ_PARLAY_LEGS`).
pub const MAX_RFQ_PARLAY_QUOTE_CPI_ACCOUNTS: usize = 4 + 2 * MAX_RFQ_PARLAY_LEGS;

/// Max MM program ids on a freebet whitelist (`num_mms == 0` means any MM).
pub const MAX_PROMO_ALLOWED_MMS: usize = 10;

/// Max market operators on a freebet whitelist (`num_operators == 0` means any operator).
pub const MAX_PROMO_ALLOWED_OPERATORS: usize = 5;

/// Push / Cancelled / RolledBack / half-grade freebet reinstatement window.
pub const FREEBET_REINSTATE_SECS: u32 = 3 * 24 * 60 * 60;

/// RFQ signed-message network domain values (first byte of canonical quote messages; kind is second).
pub const RFQ_NETWORK_MAINNET: u8 = 1;
pub const RFQ_NETWORK_DEVNET: u8 = 2;
pub const RFQ_NETWORK_LOCAL: u8 = 3;

pub const ID: Address = Address::from_str_const("5pammQjfw9f1oWtL9rLipVuYf5ufmzeKVeRwrXcA961H");

pub const CONFIG_PDA_SEED: &[u8] = b"config";
pub const CONFIG_PDA_BUMP: u8 = 255;
// ZcXq4zwiRPUwHXm1mLtnDDyo2R1QbFzDYQS6BUD97FQ
pub const CONFIG_PDA: Address = Address::derive_address_const(
   &[CONFIG_PDA_SEED], 
   Some(CONFIG_PDA_BUMP),
   &ID,
);

pub const MM_LIST_PDA_SEED: &[u8] = b"mm_list";
pub const MM_LIST_BUMP: u8 = 253;
// Ey53b5ueZCFpS2bcrdk6Aa1epWQqP6B6ra1Xp2qr77NK
pub const MM_LIST_PDA: Address = Address::derive_address_const(
   &[MM_LIST_PDA_SEED], 
   Some(MM_LIST_BUMP),
   &ID,
);

// Cluster-specific values: always exported (single item) so IDE/rust-analyzer never sees
// missing imports. `mainnet` wins when enabled; otherwise devnet (including default builds).

/// Baked into RFQ ed25519 messages so a quote from another cluster cannot verify here.
pub const RFQ_NETWORK_DOMAIN: u8 = if cfg!(feature = "mainnet") {
   RFQ_NETWORK_MAINNET
} else {
   RFQ_NETWORK_DEVNET
};

