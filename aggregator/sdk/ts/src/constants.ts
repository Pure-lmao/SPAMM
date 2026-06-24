import { address, type Address } from '@solana/kit';

export const AGGREGATOR_PROGRAM_ID: Address = address(
   '5pammQjfw9f1oWtL9rLipVuYf5ufmzeKVeRwrXcA961H',
);

export const SYSTEM_PROGRAM_ID: Address = address(
   '11111111111111111111111111111111'
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

export const ADDRESS_LOOKUP_TABLE_PROGRAM_ID: Address = address(
   'AddressLookupTab1e1111111111111111111111111',
);

//--------MAINNET CONSTANTS--------

// slot 425128422
export const LOOKUP_TABLE_ID: Address = address(
   '9cg4mZSLwjtL3D2JBhockpfw7kprmrXxcg6K5Um68Pga',
);

export const MINT_ID: Address = address(
   'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
);

//--------DEVNET CONSTANTS--------

// // slot: 465810424
// export const LOOKUP_TABLE_ID: Address = address(
//    'XRCYQiVHeE3Q83v4piQh2yHiyVmr62MikYacgYBZnYt',
// );

// export const MINT_ID: Address = address(
//    'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
// );

/** `constants::ODDS_SCALE` — odds are scaled by this factor (e.g. 15000 = 1.5x). */
export const ODDS_SCALE = 10000n;

/** `constants::MAX_NUMBER_OF_MMS` */
export const MAX_NUMBER_OF_MMS = 5;
/** `constants::MAX_NUMBER_OF_MMS_PROXY` — quote-proxy instructions only. */
export const MAX_NUMBER_OF_MMS_PROXY = 20;

/** `constants::MAX_PARLAY_LEGS` */
export const MAX_PARLAY_LEGS = 5;

export const CONFIG_PDA_SEED = 'config' as const;
export const MM_LIST_PDA_SEED = 'mm_list' as const;
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
