import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { address, type Address } from '@solana/kit';
import {
   getClosePredictionIx,
   getPredictionsByContest,
   getPredictionsByUser,
   SCORE_PREDICT_ADMIN,
} from 'spamm-score-predict-sdk';

import { createRpcClients, sendAndConfirmInstructions } from './txSend.ts';
import { loadKeypairSignerFromJsonFile } from './utils.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function defaultSignerKeypairPath(): string {
   const fromEnv = process.env.SCORE_PREDICT_SIGNER_KEYPAIR?.trim();
   if (fromEnv) {
      return fromEnv;
   }
   return path.join(__dirname, '../../aggregator/client/admin_keypair.json');
}

export async function fetchUserPredictions(ownerPubkey: string) {
   const { rpc } = createRpcClients();
   return getPredictionsByUser(rpc, address(ownerPubkey));
}

export async function fetchContestPredictions(contestId: number) {
   const { rpc } = createRpcClients();
   return getPredictionsByContest(rpc, contestId);
}

export async function closePredictionPda(params: {
   ownerPubkey: string;
   contestId: number;
   useAdmin: boolean;
   keypairPath?: string;
}): Promise<{ signature: string; authority: string }> {
   const kpPath = params.keypairPath ?? defaultSignerKeypairPath();
   const signer = await loadKeypairSignerFromJsonFile(kpPath);
   const owner = address(params.ownerPubkey);
   const authority: Address = params.useAdmin ? SCORE_PREDICT_ADMIN : signer.address;
   if (!params.useAdmin && signer.address !== owner) {
      throw new Error('Signer must match owner unless useAdmin is true');
   }
   const ix = await getClosePredictionIx(authority, owner, params.contestId);
   const signature = await sendAndConfirmInstructions([ix], [signer]);
   return { signature, authority: String(authority) };
}
