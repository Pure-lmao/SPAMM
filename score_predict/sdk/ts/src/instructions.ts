import { AccountRole, type Instruction } from '@solana/instructions';
import type { Address } from '@solana/kit';

import { encodeCreatePredictionIxData } from './codex.js';
import {
   CLOSE_PREDICTION_IX_DISCRIMINATOR,
   CREATE_PREDICTION_IX_DISCRIMINATOR,
   SCORE_PREDICT_PROGRAM_ID,
   SYSTEM_PROGRAM_ID,
} from './constants.js';
import { getPredictionPda } from './helpers.js';
import type { CreatePredictionParams } from './types.js';

export async function getCreatePredictionIx(
   params: CreatePredictionParams,
): Promise<Instruction> {
   const [predictionPda] = await getPredictionPda(params.owner, params.contestId);
   const ixData = encodeCreatePredictionIxData({
      predictionId: params.predictionId,
      contestId: params.contestId,
      prediction: params.prediction,
      openBet: params.openBet,
      tweetLink: params.tweetLink,
   });
   const data = new Uint8Array(1 + ixData.length);
   data[0] = CREATE_PREDICTION_IX_DISCRIMINATOR;
   data.set(ixData, 1);

   return {
      programAddress: SCORE_PREDICT_PROGRAM_ID,
      accounts: [
         { address: params.owner, role: AccountRole.WRITABLE_SIGNER },
         { address: predictionPda, role: AccountRole.WRITABLE },
         { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      ],
      data,
   };
}

export async function getClosePredictionIx(
   authority: Address,
   owner: Address,
   contestId: number,
): Promise<Instruction> {
   const [predictionPda] = await getPredictionPda(owner, contestId);
   return {
      programAddress: SCORE_PREDICT_PROGRAM_ID,
      accounts: [
         { address: authority, role: AccountRole.WRITABLE_SIGNER },
         { address: predictionPda, role: AccountRole.WRITABLE },
         { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([CLOSE_PREDICTION_IX_DISCRIMINATOR]),
   };
}

export async function getForceClosePdaIx(
   authority: Address,
   pda: Address,
): Promise<Instruction> {
   return {
      programAddress: SCORE_PREDICT_PROGRAM_ID,
      accounts: [
         { address: authority, role: AccountRole.WRITABLE_SIGNER },
         { address: pda, role: AccountRole.WRITABLE },
         { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([255]),
   };
}
