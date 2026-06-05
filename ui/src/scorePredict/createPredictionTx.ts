import {
   address,
   createSolanaRpcSubscriptions,
   getSignatureFromTransaction,
   sendAndConfirmTransactionFactory,
   type Rpc,
   type SolanaRpcApi,
   type TransactionSigner,
} from '@solana/kit';
import { getCreatePredictionIx } from 'spamm-score-predict-sdk';

import { buildSignV0Transaction, httpToWsRpcUrl, resolveHttpRpcUrl } from '../betting/txPipeline';

export async function submitCreatePrediction(params: {
   rpc: Rpc<SolanaRpcApi>;
   walletSigner: TransactionSigner;
   ownerAddress: string;
   predictionId: bigint;
   contestId: number;
   prediction: readonly [number, number];
   openBetAddress: string;
   tweetLink: string;
}): Promise<string> {
   const owner = address(params.ownerAddress);
   const ix = await getCreatePredictionIx({
      owner,
      predictionId: params.predictionId,
      contestId: params.contestId,
      prediction: params.prediction,
      openBet: address(params.openBetAddress),
      tweetLink: params.tweetLink,
   });
   const signed = await buildSignV0Transaction(params.rpc, {
      feePayer: params.walletSigner,
      instructions: [ix],
      signers: [params.walletSigner],
   });
   const httpUrl = resolveHttpRpcUrl(import.meta.env.VITE_SOLANA_RPC_URL);
   const subs = createSolanaRpcSubscriptions(httpToWsRpcUrl(httpUrl));
   const sendAndConfirm = sendAndConfirmTransactionFactory({
      rpc: params.rpc,
      rpcSubscriptions: subs,
   } as never);
   await sendAndConfirm(signed as never, { commitment: 'confirmed' });
   return getSignatureFromTransaction(signed);
}
