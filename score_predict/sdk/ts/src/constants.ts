import { address, type Address } from '@solana/kit';

/** Score-predict program — prediction PDAs only (not open USDC bets; those are on the aggregator). */
export const SCORE_PREDICT_PROGRAM_ID_PLACEHOLDER =
   '11111111111111111111111111111111' as const;

export const SCORE_PREDICT_PROGRAM_ID: Address = address("WcPREDR1bNAkqn61cvoFLLMf3HdXiRmvMM86PTAvmsW");

/** False while {@link SCORE_PREDICT_PROGRAM_ID} is still the deploy placeholder. */
export function isScorePredictProgramDeployed(): boolean {
   return String(SCORE_PREDICT_PROGRAM_ID) !== SCORE_PREDICT_PROGRAM_ID_PLACEHOLDER;
}

/** Placeholder admin — must match on-chain `ADMIN` after deploy. */
export const SCORE_PREDICT_ADMIN: Address = address(
   '2b54nXub6qSwpKc5wHM2jjen5mxi22EiQg6yTB2JwGu6',
);

export const SYSTEM_PROGRAM_ID: Address = address(
   '11111111111111111111111111111111',
);

export const SYSVAR_RENT_ID: Address = address(
   'SysvarRent111111111111111111111111111111111',
);

export const PREDICTION_ACCOUNT_SEED = 'prediction' as const;

export const PREDICTION_ACCOUNT_DISCRIMINATOR = 1;
export const TWEET_LINK_LEN = 70;
export const ADDRESS_LEN = 32;
export const U32_LEN = 4;
export const U64_LEN = 8;
export const PREDICTION_ACCOUNT_LEN =
   1 + 1 + U64_LEN + U32_LEN + ADDRESS_LEN + U32_LEN + 2 + ADDRESS_LEN + TWEET_LINK_LEN;

export const CREATE_PREDICTION_IX_DISCRIMINATOR = 0;
export const CLOSE_PREDICTION_IX_DISCRIMINATOR = 1;

export const CREATE_PREDICTION_IX_DATA_LEN = U64_LEN + U32_LEN + 2 + ADDRESS_LEN + TWEET_LINK_LEN;
