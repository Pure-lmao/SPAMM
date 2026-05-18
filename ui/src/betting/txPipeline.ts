import { fetchAddressLookupTable } from "@solana-program/address-lookup-table";
import {
   addSignersToTransactionMessage,
   appendTransactionMessageInstructions,
   assertIsTransactionWithBlockhashLifetime,
   compressTransactionMessageUsingAddressLookupTables,
   compileTransaction,
   createNoopSigner,
   createTransactionMessage,
   getBase64EncodedWireTransaction,
   getTransactionSize,
   pipe,
   setTransactionMessageFeePayer,
   setTransactionMessageFeePayerSigner,
   setTransactionMessageLifetimeUsingBlockhash,
   signTransactionMessageWithSigners,
   type Address,
   type AddressesByLookupTableAddress,
   type Instruction,
   type Rpc,
   type SolanaRpcApi,
   type TransactionSigner,
} from "@solana/kit";
import { LOOKUP_TABLE_ID } from "spamm-aggregator-sdk";

const PUBLIC_HTTP_RPC: Record<string, string> = {
   devnet: "https://api.devnet.solana.com",
   testnet: "https://api.testnet.solana.com",
   mainnet: "https://api.mainnet-beta.solana.com",
   "mainnet-beta": "https://api.mainnet-beta.solana.com",
   localnet: "http://127.0.0.1:8899",
};

/**
 * Connector / wallet-ui may expose `cluster.url` as a full HTTP(S) URL or a short moniker (`devnet`, etc.).
 * WebSocket clients require a real URL — normalize here.
 */
export function resolveHttpRpcUrl(raw: string | undefined | null): string {
   const u = (raw ?? "").trim();
   if (u === "") {
      return PUBLIC_HTTP_RPC.devnet;
   }
   if (u.startsWith("https://") || u.startsWith("http://")) {
      return u;
   }
   const key = u.replace(/^solana:/i, "").toLowerCase();
   if (key in PUBLIC_HTTP_RPC) {
      return PUBLIC_HTTP_RPC[key]!;
   }
   return PUBLIC_HTTP_RPC.devnet;
}

export function httpToWsRpcUrl(httpUrl: string): string {
   const base = resolveHttpRpcUrl(httpUrl);
   if (base.startsWith("https://")) {
      return `wss://${base.slice("https://".length)}`;
   }
   if (base.startsWith("http://")) {
      return `ws://${base.slice("http://".length)}`;
   }
   return base;
}

async function fetchAddressesByLookupTable(
   rpc: Rpc<SolanaRpcApi>,
   lookupTableAddress: Address,
): Promise<AddressesByLookupTableAddress> {
   const {
      data: { addresses },
   } = await fetchAddressLookupTable(rpc, lookupTableAddress);
   return { [lookupTableAddress]: addresses } as AddressesByLookupTableAddress;
}

function base64ReturnDataToBytes(data: readonly [string, string]): Uint8Array {
   const [b64] = data;
   const bin = atob(b64);
   const out = new Uint8Array(bin.length);
   for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
   }
   return out;
}

export async function buildSignV0Transaction(
   rpc: Rpc<SolanaRpcApi>,
   params: Readonly<{
      feePayer: TransactionSigner;
      instructions: readonly Instruction[];
      signers: readonly TransactionSigner[];
      useALT?: boolean;
   }>,
): Promise<ReturnType<typeof signTransactionMessageWithSigners>> {
   const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();

   let txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(params.feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([...params.instructions], m),
   );

   if (params.useALT === true) {
      const addressesByLookupTable = await fetchAddressesByLookupTable(rpc, LOOKUP_TABLE_ID);
      txMessage = compressTransactionMessageUsingAddressLookupTables(txMessage, addressesByLookupTable);
   }
   
   const txMessageWithSigners = addSignersToTransactionMessage([...params.signers], txMessage);
   const signedTransaction = await signTransactionMessageWithSigners(txMessageWithSigners);
   assertIsTransactionWithBlockhashLifetime(signedTransaction);
   return signedTransaction;
}

/**
 * Build one compiled (unsigned) v0 transaction per instruction chunk, sharing the same blockhash
 * and optional ALT compression. Caller signs with {@link TransactionModifyingSigner#modifyAndSignTransactions}.
 */
export async function compileUnsignedV0TransactionChunks(
   rpc: Rpc<SolanaRpcApi>,
   params: Readonly<{
      feePayer: TransactionSigner;
      instructionChunks: readonly (readonly Instruction[])[];
      useALT?: boolean;
   }>,
): Promise<readonly ReturnType<typeof compileTransaction>[]> {
   const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
   let lookup: AddressesByLookupTableAddress | undefined;
   if (params.useALT === true) {
      lookup = await fetchAddressesByLookupTable(rpc, LOOKUP_TABLE_ID);
   }
   const out: ReturnType<typeof compileTransaction>[] = [];
   for (const instructions of params.instructionChunks) {
      if (instructions.length === 0) {
         continue;
      }
      let txMessage = pipe(
         createTransactionMessage({ version: 0 }),
         (m) => setTransactionMessageFeePayerSigner(params.feePayer, m),
         (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
         (m) => appendTransactionMessageInstructions([...instructions], m),
      );
      if (params.useALT === true && lookup !== undefined) {
         txMessage = compressTransactionMessageUsingAddressLookupTables(txMessage, lookup);
      }
      const txMessageWithSigners = addSignersToTransactionMessage([params.feePayer], txMessage);
      out.push(compileTransaction(txMessageWithSigners));
   }
   return out;
}

export async function simulateInstructionReturnData(
   rpc: Rpc<SolanaRpcApi>,
   instruction: Instruction,
   feePayerAddress: Address,
   useALT = false,
): Promise<Uint8Array | undefined> {
   const feePayerNoop = createNoopSigner(feePayerAddress);
   const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();

   let txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(feePayerNoop.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([instruction], m),
   );

   if (useALT === true) {
      const addressesByLookupTable = await fetchAddressesByLookupTable(rpc, LOOKUP_TABLE_ID);
      txMessage = compressTransactionMessageUsingAddressLookupTables(
         txMessage,
         addressesByLookupTable,
      ) as typeof txMessage;
   }

   const unsignedTransaction = compileTransaction(txMessage);
   const wireBytes = getTransactionSize(unsignedTransaction);
   console.debug(`[simulate] wire bytes: ${wireBytes} (useALT=${useALT})`);
   const encodedTransaction = getBase64EncodedWireTransaction(unsignedTransaction);
   const simulation = await rpc.simulateTransaction(encodedTransaction, { encoding: "base64", sigVerify: false }).send();
   const raw = simulation.value.returnData?.data;
   if (!raw) {
      return undefined;
   }
   return base64ReturnDataToBytes(raw);
}
