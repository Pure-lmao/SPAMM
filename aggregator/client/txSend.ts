/**
 * Shared helpers: load keypair JSON, devnet RPC + WS, v0 tx build/sign, send + confirm.
 */

import { fetchAddressLookupTable } from '@solana-program/address-lookup-table';
import {
   pipe,
   type Instruction,
   type Address,
   type AddressesByLookupTableAddress,
   addSignersToTransactionMessage,
   appendTransactionMessageInstructions,
   compressTransactionMessageUsingAddressLookupTables,
   createSolanaRpc,
   createSolanaRpcSubscriptions,
   createTransactionMessage,
   getSignatureFromTransaction,
   sendAndConfirmTransactionFactory,
   setTransactionMessageFeePayerSigner,
   setTransactionMessageLifetimeUsingBlockhash,
   signTransactionMessageWithSigners,
   type Signature,
   type Commitment,
   type KeyPairSigner,
   type TransactionSigner,
   assertIsTransactionWithBlockhashLifetime,
   type RpcSubscriptions,
   type SolanaRpcSubscriptionsApi,
   type Rpc,
   type SolanaRpcApi,
   getBase64EncodedWireTransaction,
   getTransactionSize,
   type Base64EncodedDataResponse,
} from '@solana/kit';
import { LOOKUP_TABLE_ID } from 'spamm-aggregator-sdk';


/** HTTP RPC URL (env `SOLANA_RPC_URL` or devnet default). */
export function resolveHttpRpcUrl(override?: string): string {
   return override ?? 'https://api.devnet.solana.com';
}

/** WebSocket URL for subscriptions (env `SOLANA_WS_URL`, or derived from HTTP). */
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
   httpUrl: string;
   wsUrl: string;
}>;

export function createRpcClients(options?: Readonly<{ httpUrl?: string; wsUrl?: string }>): RpcClients {
   const httpUrl = resolveHttpRpcUrl(options?.httpUrl);
   const wsUrl = resolveWsRpcUrl(httpUrl, options?.wsUrl);
   return {
      rpc: createSolanaRpc(httpUrl) as Rpc<SolanaRpcApi>,
      rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl) as RpcSubscriptions<SolanaRpcSubscriptionsApi>,
      httpUrl,
      wsUrl,
   };
}

/** Load on-chain ALT account data for `compressTransactionMessageUsingAddressLookupTables`. */
export async function fetchAddressesByLookupTable(
   rpc: RpcClients['rpc'],
   lookupTableAddress: Address,
): Promise<AddressesByLookupTableAddress> {
   const {
      data: { addresses },
   } = await fetchAddressLookupTable(rpc, lookupTableAddress);
   return { [lookupTableAddress]: addresses } as AddressesByLookupTableAddress;
}

export type BuildSignV0Params = Readonly<{
   feePayer: KeyPairSigner;
   instructions: readonly Instruction[];
   /** Every signer required by the instructions (typically includes `feePayer`). */
   signers: readonly TransactionSigner[];
   /** When `true`, compress against on-chain {@link LOOKUP_TABLE_ID} (fetched via RPC). */
   useALT?: boolean;
}>;

/** Fetch blockhash, assemble v0 message, attach signers, sign. */
export async function buildSignV0Transaction(
   rpc: RpcClients['rpc'],
   params: BuildSignV0Params,
): Promise<ReturnType<typeof signTransactionMessageWithSigners>> {
   const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();

   let txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(params.feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([...params.instructions], m),
   );

   if (params.useALT === true) {
      const addressesByLookupTable = await fetchAddressesByLookupTable(rpc, LOOKUP_TABLE_ID);
      txMessage = compressTransactionMessageUsingAddressLookupTables(
         txMessage,
         addressesByLookupTable,
      );
   }

   const txMessageWithSigners = addSignersToTransactionMessage([...params.signers], txMessage);
   const signedTransaction = await signTransactionMessageWithSigners(txMessageWithSigners);
   assertIsTransactionWithBlockhashLifetime(signedTransaction);
   return signedTransaction;
}

export type SendConfirmParams = Readonly<{
   commitment?: Commitment;
}>;

/** Send a fully signed blockhash-lifetime transaction and wait for confirmation. */
export async function sendAndConfirmSignedTransaction(
   clients: RpcClients,
   signedTransaction: Awaited<ReturnType<typeof buildSignV0Transaction>>,
   options?: SendConfirmParams,
): Promise<Signature> {
   const commitment = options?.commitment ?? 'confirmed';
   // `createSolanaRpc` return type is a wide `Rpc` union; factory overloads key on devnet `~cluster`.
   const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
      rpc: clients.rpc,
      rpcSubscriptions: clients.rpcSubscriptions,
   } as never);
   await sendAndConfirmTransaction(signedTransaction as never, { commitment });
   return getSignatureFromTransaction(signedTransaction);
}

/** Base58 signature string for logging. */
export function signatureBase58(signedTransaction: Awaited<ReturnType<typeof buildSignV0Transaction>>): string {
   return getSignatureFromTransaction(signedTransaction);
}


/**
 * Build, sign, send, and confirm a v0 transaction with the testing keypair as fee payer.
 * Pass `payer` if you already loaded it (e.g. for PDA derivation); otherwise it is loaded from `keypairPath` or the default user keypair.
 */
export async function sendAndConfirmInstructions(
   instructions: readonly Instruction[],
   signers: readonly KeyPairSigner[],
   useALT: boolean = false,
): Promise<Signature> {
   const clients = createRpcClients();
   const signedTransaction = await buildSignV0Transaction(clients.rpc, {
      feePayer: signers[0]!,
      instructions,
      signers,
      useALT,
   });
   return sendAndConfirmSignedTransaction(clients, signedTransaction);
}

export async function simulateTransaction(
   rpc: RpcClients['rpc'],
   instructions: readonly Instruction[],
   signers: readonly KeyPairSigner[],
   useALT: boolean = false,
): Promise<Base64EncodedDataResponse | undefined> {
   const transaction = await buildSignV0Transaction(rpc, {
      feePayer: signers[0]!,
      instructions,
      signers,
      useALT,
   });
   // const wireBytes = getTransactionSize(transaction);
   // console.log(`wire transaction size: ${wireBytes} bytes (useALT=${useALT})`);
   const encodedTransaction = getBase64EncodedWireTransaction(transaction);
   const simulation = await rpc
      .simulateTransaction(encodedTransaction, { encoding: 'base64', sigVerify: false })
      .send();
   // console.log(simulation);
   return simulation.value.returnData?.data;
}