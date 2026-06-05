import {
   getAddressEncoder,
   getProgramDerivedAddress,
   type Address,
   type ProgramDerivedAddressBump,
} from '@solana/kit';

import { PREDICTION_ACCOUNT_SEED, SCORE_PREDICT_PROGRAM_ID } from './constants.js';
import type { PredictionKind, DailyTotalPrediction, MatchScorePrediction } from './types.js';

export function encodeContestIdLe(contestId: number): Uint8Array {
   const out = new Uint8Array(4);
   new DataView(out.buffer).setUint32(0, contestId >>> 0, true);
   return out;
}

const addressEncoder = getAddressEncoder();
export async function getPredictionPda(
   owner: Address,
   contestId: number,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return getProgramDerivedAddress({
      programAddress: SCORE_PREDICT_PROGRAM_ID,
      seeds: [PREDICTION_ACCOUNT_SEED, addressEncoder.encode(owner), encodeContestIdLe(contestId)],
   });
}

export function encodePrediction(
   kind: PredictionKind,
   value: MatchScorePrediction | DailyTotalPrediction,
): readonly [number, number] {
   if (kind === 'match_score') {
      const v = value as MatchScorePrediction;
      return [v.homeGoals & 0xff, v.awayGoals & 0xff];
   }
   const v = value as DailyTotalPrediction;
   const total = v.total & 0xffff;
   return [total & 0xff, (total >> 8) & 0xff];
}

export function decodePrediction(
   kind: PredictionKind,
   bytes: readonly [number, number],
): MatchScorePrediction | DailyTotalPrediction {
   if (kind === 'match_score') {
      return { homeGoals: bytes[0]!, awayGoals: bytes[1]! };
   }
   return { total: bytes[0]! | (bytes[1]! << 8) };
}

export function formatPredictionForTweet(
   kind: PredictionKind,
   bytes: readonly [number, number],
): string {
   if (kind === 'match_score') {
      return `${bytes[0]}-${bytes[1]}`;
   }
   return String(bytes[0]! | (bytes[1]! << 8));
}
