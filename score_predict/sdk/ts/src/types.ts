import type { Address } from '@solana/kit';

export type PredictionKind = 'match_score' | 'daily_total';

export type MatchScorePrediction = Readonly<{
   homeGoals: number;
   awayGoals: number;
}>;

export type DailyTotalPrediction = Readonly<{
   total: number;
}>;

export type PredictionAccountData = Readonly<{
   discriminator: number;
   bump: number;
   predictionId: bigint;
   contestId: number;
   owner: Address;
   timestamp: number;
   prediction: readonly [number, number];
   openBet: Address;
   tweetLink: string;
}>;

export type CreatePredictionParams = Readonly<{
   owner: Address;
   predictionId: bigint;
   contestId: number;
   prediction: readonly [number, number];
   openBet: Address;
   tweetLink: string;
}>;
