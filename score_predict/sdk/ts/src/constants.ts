import { address, type Address } from '@solana/kit';

/** Score-predict program — prediction PDAs only (not open USDC bets; those are on the aggregator). */
export const SCORE_PREDICT_PROGRAM_ID_PLACEHOLDER =
   '11111111111111111111111111111111' as const;

export const SCORE_PREDICT_PROGRAM_ID: Address = address("2auNkPPMyLu84bSqvNshqz2P2PtwYDa2vd4cCUEqx6zs");

/** False while {@link SCORE_PREDICT_PROGRAM_ID} is still the deploy placeholder. */
export function isScorePredictProgramDeployed(): boolean {
   return String(SCORE_PREDICT_PROGRAM_ID) !== SCORE_PREDICT_PROGRAM_ID_PLACEHOLDER;
}

/** Placeholder admin — must match on-chain `ADMIN` after deploy. */
export const SCORE_PREDICT_ADMIN: Address = address(
   '3z6QBMEUjJubCwbKUsMKFnKnf1twyc5bZ9gaWHNAn1nP',
);

export const SYSTEM_PROGRAM_ID: Address = address(
   '11111111111111111111111111111111',
);

export const PREDICTION_ACCOUNT_SEED = 'prediction' as const;

export const PREDICTION_ACCOUNT_DISCRIMINATOR = 1;
export const TWEET_LINK_LEN = 70;
export const PREDICTION_ACCOUNT_LEN = 154;

export const CREATE_PREDICTION_IX_DISCRIMINATOR = 0;
export const CLOSE_PREDICTION_IX_DISCRIMINATOR = 1;

export const CREATE_PREDICTION_IX_DATA_LEN = 8 + 4 + 2 + 32 + TWEET_LINK_LEN;
