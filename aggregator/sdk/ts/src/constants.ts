import { address, type Address } from '@solana/kit';

export const AGGREGATOR_PROGRAM_ID: Address = address(
   '5pammQjfw9f1oWtL9rLipVuYf5ufmzeKVeRwrXcA961H',
);

export const SYSTEM_PROGRAM_ID: Address = address(
   '11111111111111111111111111111111'
);

export const SYSVAR_RENT_ID: Address = address(
   'SysvarRent111111111111111111111111111111111',
);

export const SYSVAR_INSTRUCTIONS_ID: Address = address(
   'Sysvar1nstructions1111111111111111111111111',
);

export const CLOCK_ID: Address = address(
   'SysvarC1ock11111111111111111111111111111111',
);

export const SPL_TOKEN_PROGRAM_ID: Address = address(
   'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

export const SPL_ASSOCIATED_TOKEN_PROGRAM_ID: Address = address(
   'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

/** RFQ signed-message network domain values (`constants::RFQ_NETWORK_*`). */
export const RFQ_NETWORK_MAINNET = 1;
export const RFQ_NETWORK_DEVNET = 2;
export const RFQ_NETWORK_LOCAL = 3;

//--------MAINNET CONSTANTS--------

/**
 * Baked into RFQ ed25519 messages (`constants::RFQ_NETWORK_DOMAIN`).
 * Must match the on-chain program build for this cluster.
 */
// export const RFQ_NETWORK_DOMAIN = RFQ_NETWORK_MAINNET;

// export const MINT_ID: Address = address(
//    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
// );

//--------DEVNET CONSTANTS--------

// /**
//  * Baked into RFQ ed25519 messages (`constants::RFQ_NETWORK_DOMAIN`).
//  * Must match the on-chain program build for this cluster.
//  */
export const RFQ_NETWORK_DOMAIN = RFQ_NETWORK_DEVNET;

/** RFQ signed-message kind byte (after `networkDomain`). See `types.ts` for wire layouts. */
export {
   RFQ_BET_MESSAGE_KIND,
   RFQ_PARLAY_MESSAGE_KIND,
   RFQ_CASHOUT_MESSAGE_KIND,
   RFQ_CASHOUT_PARLAY_MESSAGE_KIND,
} from './types.js';

export const MINT_ID: Address = address(
   'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
);

/** `constants::ODDS_SCALE` — scaled-odds basis where 10000 = 1.0x (e.g. 15000 = 1.5x). */
export const ODDS_SCALE = 10000n;

/** Packed pubkey / `Address` wire size (`constants::ADDRESS_LEN`). */
export const ADDRESS_LEN = 32;
/** `constants::U32_LEN` */
export const U32_LEN = 4;
/** `constants::U64_LEN` */
export const U64_LEN = 8;

/** `constants::MAX_NUMBER_OF_MMS` */
export const MAX_NUMBER_OF_MMS = 5;
/** `constants::MAX_NUMBER_OF_MMS_PROXY` — quote-proxy instructions only. */
export const MAX_NUMBER_OF_MMS_PROXY = 20;

/** `constants::MAX_PARLAY_LEGS` — auction fill / cashout / get-quote max. */
export const MAX_PARLAY_LEGS = 20;

/** `constants::MAX_RFQ_PARLAY_LEGS` — RFQ fill / cashout / message / bet PDA max. */
export const MAX_RFQ_PARLAY_LEGS = 40;

/** `constants::LIVE_CASHOUT_DELAY` — unix seconds between live cashout fill and permissionless escrow claim. */
export const LIVE_CASHOUT_DELAY = 30;

/** `constants::MIN_BET_AMOUNT` — $0.10 at 6-decimal USDC (`0.1 * 10**6`). */
export const MIN_BET_AMOUNT = 100_000n;

/** `constants::MIN_FILLER_AMOUNT` — skip auction slices below $0.10. */
export const MIN_FILLER_AMOUNT = 100_000n;

/** `constants::SETTLE_BET_TOKEN_BATCH_IX_CAP` */
export const SETTLE_BET_TOKEN_BATCH_IX_CAP = 13;
/** `constants::SETTLE_BET_TOKEN_BATCH_CPI_ACCOUNTS` */
export const SETTLE_BET_TOKEN_BATCH_CPI_ACCOUNTS = SETTLE_BET_TOKEN_BATCH_IX_CAP * 3;

/** `constants::SETTLE_PARLAY_TOKEN_BATCH_IX_CAP` */
export const SETTLE_PARLAY_TOKEN_BATCH_IX_CAP = 8;
/** `constants::SETTLE_PARLAY_TOKEN_BATCH_CPI_ACCOUNTS` */
export const SETTLE_PARLAY_TOKEN_BATCH_CPI_ACCOUNTS = SETTLE_PARLAY_TOKEN_BATCH_IX_CAP * 3;

/** `constants::SETTLE_TOKEN_BATCH_MAX_INNER_DATA` */
export const SETTLE_TOKEN_BATCH_MAX_INNER_DATA = 9;

/** `constants::SAFE_CLOSE_ATA_BATCH_IX_CAP` */
export const SAFE_CLOSE_ATA_BATCH_IX_CAP = 2;
/** `constants::SAFE_CLOSE_ATA_BATCH_CPI_ACCOUNTS` */
export const SAFE_CLOSE_ATA_BATCH_CPI_ACCOUNTS = SAFE_CLOSE_ATA_BATCH_IX_CAP * 3;

/** `constants::MAX_PARLAY_QUOTE_CPI_ACCOUNTS` — `4 + 2 * MAX_PARLAY_LEGS`. */
export const MAX_PARLAY_QUOTE_CPI_ACCOUNTS = 4 + 2 * MAX_PARLAY_LEGS;

/** `constants::MAX_RFQ_PARLAY_QUOTE_CPI_ACCOUNTS` — `4 + 2 * MAX_RFQ_PARLAY_LEGS`. */
export const MAX_RFQ_PARLAY_QUOTE_CPI_ACCOUNTS = 4 + 2 * MAX_RFQ_PARLAY_LEGS;

/** `constants::MAX_FREEBET_ALLOWED_MMS` */
export const MAX_FREEBET_ALLOWED_MMS = 10;

/** `constants::MAX_FREEBET_ALLOWED_OPERATORS` */
export const MAX_FREEBET_ALLOWED_OPERATORS = 5;

/** `constants::FREEBET_REINSTATE_SECS` — Push / Cancelled / RolledBack / half-grade window. */
export const FREEBET_REINSTATE_SECS = 3 * 86400;

export const CONFIG_PDA_SEED = 'config' as const;
/** Baked config PDA for devnet build (`constants::CONFIG_PDA`). */
export const CONFIG_PDA: Address = address('ZcXq4zwiRPUwHXm1mLtnDDyo2R1QbFzDYQS6BUD97FQ');
/** Baked config PDA bump (`constants::CONFIG_PDA_BUMP`). */
export const CONFIG_PDA_BUMP = 255;
export const MM_LIST_PDA_SEED = 'mm_list' as const;
/** Baked MM list PDA for devnet build (`constants::MM_LIST_PDA`). */
export const MM_LIST_PDA: Address = address('Ey53b5ueZCFpS2bcrdk6Aa1epWQqP6B6ra1Xp2qr77NK');
/** Baked MM list PDA bump (`constants::MM_LIST_BUMP`). */
export const MM_LIST_BUMP = 253;
export const BET_ACCOUNT_SEED = 'bet' as const;
/** Parlay bet PDA first seed (`aggregator::state::account_parlay_bet::PARLAY_BET_ACCOUNT_SEED`). */
export const PARLAY_BET_ACCOUNT_SEED = 'parlay' as const;
export const NETTING_PDA_SEED = 'netting' as const;
export const MM_ENCUMBRANCE_PDA_SEED = 'encumbrance' as const;
export const MM_ACCOUNT_CONFIG_SEED = 'config' as const;
export const EVENT_STATE_SEED = 'event_state' as const;
export const MM_MARKET_DATA_PDA_SEED = 'market_data' as const;

/** MM program quote buffer PDA (single account per MM program; see `market_maker` `init_program`). */
export const MM_QUOTE_BUFFER_SEED = 'mm_quote_buffer' as const;

/** MM program parlay quote buffer PDA (`market_maker::constants::MM_PARLAY_QUOTE_BUFFER_SEED`). */
export const MM_PARLAY_QUOTE_BUFFER_SEED = 'mm_parlay_quote_buffer' as const;

/** MM CPI instruction discriminators (shared by `instructions.ts` and `codex.ts`). */
export const MM_GET_QUOTE_IX_DISCRIMINATOR = 120;
export const MM_FILL_QUOTE_IX_DISCRIMINATOR = 121;
export const MM_GET_QUOTE_PARLAY_IX_DISCRIMINATOR = 122;
export const MM_FILL_QUOTE_PARLAY_IX_DISCRIMINATOR = 123;
export const MM_FILL_BET_RFQ_IX_DISCRIMINATOR = 130;
export const MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR = 131;
export const MM_GET_CASHOUT_QUOTE_IX_DISCRIMINATOR = 140;
export const MM_FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR = 141;
export const MM_GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR = 142;
export const MM_FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR = 143;
export const MM_FILL_CASHOUT_RFQ_IX_DISCRIMINATOR = 144;
export const MM_FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR = 145;

/** Live cashout delay escrow PDA (`account_cashout_escrow::CASHOUT_ESCROW_SEED`). */
export const CASHOUT_ESCROW_SEED = 'cashout_escrow' as const;
/** Filling-MM single-bet cashout ticket PDA (`account_cashout::CASHOUT_ACCOUNT_SEED`). */
export const CASHOUT_ACCOUNT_SEED = 'cashout' as const;
/** Filling-MM parlay cashout ticket PDA (`account_cashout_parlay::CASHOUT_PARLAY_ACCOUNT_SEED`). */
export const CASHOUT_PARLAY_ACCOUNT_SEED = 'cashout_parlay' as const;
/** Freebet issuer PDA (`account_freebet_issuer::FREEBET_ISSUER_SEED`). */
export const FREEBET_ISSUER_SEED = 'freebet_issuer' as const;
/** Freebet PDA (`account_freebet::FREEBET_ACCOUNT_SEED`). */
export const FREEBET_ACCOUNT_SEED = 'freebet' as const;
