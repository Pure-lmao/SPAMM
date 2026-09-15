import { address, type Address } from '@solana/kit';


const ADDRESS_LEN = 32;
const U32_LEN = 4;
const U64_LEN = 8;


export { ADDRESS_LEN, U32_LEN, U64_LEN };

export const MARKET_MAKER_PROGRAM_ID: Address = address(
   'DUMBu4faqgx9KJWKAp8xRzKMiHEcBUvuH7pMkvMneMTt',
);

export const AGGREGATOR_PROGRAM_ID: Address = address(
   '5pammQjfw9f1oWtL9rLipVuYf5ufmzeKVeRwrXcA961H',
);

export const SYSTEM_PROGRAM_ID: Address = address(
   '11111111111111111111111111111111',
);

export const SYSVAR_RENT_ID: Address = address(
   'SysvarRent111111111111111111111111111111111',
);

export const SPL_TOKEN_PROGRAM_ID: Address = address(
   'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

export const SPL_ASSOCIATED_TOKEN_PROGRAM_ID: Address = address(
   'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

export const SYSVAR_INSTRUCTIONS_ID: Address = address(
   'Sysvar1nstructions1111111111111111111111111',
);

export const CLOCK_ID: Address = address(
   'SysvarC1ock11111111111111111111111111111111',
);

/** `constants::ODDS_SCALE` — odds are scaled by this factor (e.g. 15000 = 1.5x). */
export const ODDS_SCALE = 10000n;

/** `constants::MAX_PARLAY_LEGS` — auction fill / cashout / get-quote max. */
export const MAX_PARLAY_LEGS = 20;

/** `spamm_aggregator::constants::MAX_RFQ_PARLAY_LEGS` — RFQ message / fill / RFQ bet PDA max. */
export const MAX_RFQ_PARLAY_LEGS = 40;

export const MM_ACCOUNT_CONFIG_SEED = 'config' as const;
export const MM_QUOTE_BUFFER_SEED = 'mm_quote_buffer' as const;
export const MM_PARLAY_QUOTE_BUFFER_SEED = 'mm_parlay_quote_buffer' as const;
export const EVENT_STATE_SEED = 'event_state' as const;
export const MM_MARKET_DATA_PDA_SEED = 'market_data' as const;
export const MM_ENCUMBRANCE_PDA_SEED = 'encumbrance' as const;

//--------MAINNET CONSTANTS--------

// export const MINT_ID: Address = address(
//    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
// );

//--------DEVNET CONSTANTS--------

export const MINT_ID: Address = address(
   'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
);
