import {
   addSignersToTransactionMessage,
   appendTransactionMessageInstructions,
   assertIsTransactionWithBlockhashLifetime,
   createSolanaRpc,
   createSolanaRpcSubscriptions,
   createTransactionMessage,
   getSignatureFromTransaction,
   sendAndConfirmTransactionFactory,
   setTransactionMessageFeePayerSigner,
   setTransactionMessageLifetimeUsingBlockhash,
   signTransactionMessageWithSigners,
   pipe,
   type Commitment,
   type Instruction,
   type KeyPairSigner,
   type Rpc,
   type RpcSubscriptions,
   type SolanaRpcApi,
   type SolanaRpcSubscriptionsApi,
   type TransactionSigner,
} from '@solana/kit';

export function resolveHttpRpcUrl(override?: string): string {
   return override ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
}

export function resolveWsRpcUrl(httpUrl: string, override?: string): string {
   if (override ?? process.env.SOLANA_WS_URL) {
      return (override ?? process.env.SOLANA_WS_URL) as string;
   }
   if (httpUrl.startsWith('https://')) {
      return `wss://${httpUrl.slice('https://'.length)}`;
   }
   return httpUrl.replace(/^http:/, 'ws:');
}

export type RpcClients = Readonly<{
   rpc: Rpc<SolanaRpcApi>;
   rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
}>;

export function createRpcClients(options?: Readonly<{ httpUrl?: string; wsUrl?: string }>): RpcClients {
   const httpUrl = resolveHttpRpcUrl(options?.httpUrl);
   const wsUrl = resolveWsRpcUrl(httpUrl, options?.wsUrl);
   return {
      rpc: createSolanaRpc(httpUrl) as Rpc<SolanaRpcApi>,
      rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl) as RpcSubscriptions<SolanaRpcSubscriptionsApi>,
   };
}

export async function buildSignV0Transaction(
   rpc: Rpc<SolanaRpcApi>,
   params: Readonly<{
      feePayer: KeyPairSigner;
      instructions: readonly Instruction[];
      signers: readonly TransactionSigner[];
   }>,
) {
   const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
   const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(params.feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([...params.instructions], m),
   );
   const txMessageWithSigners = addSignersToTransactionMessage([...params.signers], txMessage);
   const signed = await signTransactionMessageWithSigners(txMessageWithSigners);
   assertIsTransactionWithBlockhashLifetime(signed);
   return signed;
}

export async function sendAndConfirmInstructions(
   instructions: readonly Instruction[],
   signers: readonly KeyPairSigner[],
   options?: Readonly<{ commitment?: Commitment }>,
): Promise<string> {
   const clients = createRpcClients();
   const signed = await buildSignV0Transaction(clients.rpc, {
      feePayer: signers[0]!,
      instructions,
      signers,
   });
   const commitment = options?.commitment ?? 'confirmed';
   const sendAndConfirm = sendAndConfirmTransactionFactory({
      rpc: clients.rpc,
      rpcSubscriptions: clients.rpcSubscriptions,
   } as never);
   await sendAndConfirm(signed as never, { commitment });
   return getSignatureFromTransaction(signed);
}
