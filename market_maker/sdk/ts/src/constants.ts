import { address, type Address } from '@solana/kit';

export const MARKET_MAKER_PROGRAM_ID: Address = address(
   'DUMBu4faqgx9KJWKAp8xRzKMiHEcBUvuH7pMkvMneMTt',
);

export const MINT_ID: Address = address(
   'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
);

export const SYSTEM_PROGRAM_ID: Address = address(
   '11111111111111111111111111111111',
);

export const SPL_TOKEN_PROGRAM_ID: Address = address(
   'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

export const SPL_ASSOCIATED_TOKEN_PROGRAM_ID: Address = address(
   'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

/** `constants::ODDS_SCALE` — odds are scaled by this factor (e.g. 15000 = 1.5x). */
export const ODDS_SCALE = 10000n;

export const MM_ACCOUNT_CONFIG_SEED = 'config' as const;
export const MM_QUOTE_BUFFER_SEED = 'mm_quote_buffer' as const;
export const MM_PARLAY_QUOTE_BUFFER_SEED = 'mm_parlay_quote_buffer' as const;
export const EVENT_STATE_SEED = 'event_state' as const;
export const MM_MARKET_DATA_PDA_SEED = 'market_data' as const;
