import { address, type Address } from '@solana/kit';

/** Anchor template SPAMM. `4ADgF21dBH2wwtaSkEYq37uYJuio73xnKLc94mv9BQkV`. */
export const ANCHOR_TEMPLATE_MM_PROGRAM_ID: Address = address(
   '4ADgF21dBH2wwtaSkEYq37uYJuio73xnKLc94mv9BQkV',
);

/** `["config"]` under the Anchor template program. */
export const ANCHOR_TEMPLATE_MM_CONFIG_PDA: Address = address(
   '7UZsZkzUc3LJQNUDPG5G2AkKYF4SNXd98Firro7V5JED',
);

/** `["mm_quote_buffer"]`. */
export const ANCHOR_TEMPLATE_MM_QUOTE_BUFFER_PDA: Address = address(
   'AEnQCuq4Lbe8ZNmHu4J1u5C1y6k34etjUpX2mwLLfAJ7',
);

/** `["mm_parlay_quote_buffer"]`. */
export const ANCHOR_TEMPLATE_MM_PARLAY_QUOTE_BUFFER_PDA: Address = address(
   'DTQ8YMUiCXain6cqoNuxzazzpMHY49668i1w27EC9WMw',
);

/** Aggregator `["encumbrance", program id]`. Liability ATA authority. */
export const ANCHOR_TEMPLATE_MM_ENCUMBRANCE_PDA: Address = address(
   '2KbRHUpTTgSL5tdyCu8SgD8Cvsc1Wr7tgfZkPgdtkKDz',
);

export const INIT_PROGRAM_IX_DISCRIMINATOR = 100;
export const SET_RFQ_SIGNER_IX_DISCRIMINATOR = 101;
export const INIT_EVENT_IX_DISCRIMINATOR = 110;
export const INIT_MARKET_IX_DISCRIMINATOR = 111;
export const CLOSE_EVENT_IX_DISCRIMINATOR = 112;
export const CLOSE_MARKET_IX_DISCRIMINATOR = 113;
export const UPDATE_EVENT_STATE_IX_DISCRIMINATOR = 114;
export const UPDATE_MARKET_IX_DISCRIMINATOR = 115;
export const WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR = 150;
