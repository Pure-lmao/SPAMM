import {
   appendTransactionMessageInstructions,
   assertIsSendableTransaction,
   assertIsTransactionWithinSizeLimit,
   assertIsTransactionWithBlockhashLifetime,
   compileTransaction,
   createSolanaRpc,
   createTransactionMessage,
   getBase64Decoder,
   getBase64EncodedWireTransaction,
   getBase64Encoder,
   getCompiledTransactionMessageDecoder,
   getSignatureFromTransaction,
   getTransactionDecoder,
   pipe,
   setTransactionMessageConfig,
   setTransactionMessageFeePayer,
   setTransactionMessageLifetimeUsingBlockhash,
   type Address,
   type Blockhash,
   type Instruction,
   type Rpc,
   type Signature,
   type SolanaRpcApi,
   type Transaction,
   type TransactionPartialSigner,
   type TransactionWithBlockhashLifetime,
} from "@solana/kit";
import { DEBUG } from "../env";
import { RPC_URL, httpToWs } from "../network";

export const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(RPC_URL);
export const RPC_HTTP = RPC_URL;
export const RPC_WS = httpToWs(RPC_URL);

const RESOURCE_LIMITS = {
   computeUnitLimit: 1_400_000,
   loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
};

function v1Message(
   feePayer: Address,
   blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint },
   instructions: readonly Instruction[],
) {
   return pipe(
      createTransactionMessage({ version: 1 }),
      (tx) => setTransactionMessageFeePayer(feePayer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
      (tx) => appendTransactionMessageInstructions([...instructions], tx),
      (tx) => setTransactionMessageConfig(RESOURCE_LIMITS, tx),
   );
}

function sleep(ms: number): Promise<void> {
   return new Promise((resolve) => setTimeout(resolve, ms));
}

export function logError(error: unknown): void {
   console.error("[error]", errorText(error));
   const seen = new Set<unknown>();
   let current: unknown = error;
   while (current instanceof Error && current.cause != null && !seen.has(current.cause)) {
      seen.add(current.cause);
      console.error("[error] cause:", errorText(current.cause));
      current = current.cause;
   }
   if (DEBUG) {
      console.error(error);
   }
}

export function errorText(error: unknown): string {
   if (error instanceof Error && error.message !== "") {
      return error.message;
   }
   try {
      return JSON.stringify(error, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
   } catch {
      return String(error);
   }
}

export async function simulateReturnData(instruction: Instruction, feePayer: Address): Promise<Uint8Array | undefined> {
   const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
   const message = v1Message(feePayer, blockhash, [instruction]);
   const encoded = getBase64EncodedWireTransaction(compileTransaction(message));
   const simulation = await rpc.simulateTransaction(encoded, {
      encoding: "base64",
      replaceRecentBlockhash: true,
      sigVerify: false,
   }).send();
   if (simulation.value.err != null) {
      throw new Error(`Quote simulation failed: ${errorText(simulation.value.err)}`);
   }
   const data = simulation.value.returnData?.data;
   if (data == null) {
      return undefined;
   }
   const [b64] = data;
   const bin = atob(b64);
   const out = new Uint8Array(bin.length);
   for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
   }
   return out;
}

async function latestBlockhash() {
   const { value } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
   return value;
}

export async function compileUserTx(
   feePayer: Address,
   instructions: readonly Instruction[],
): Promise<Transaction & TransactionWithBlockhashLifetime> {
   const blockhash = await latestBlockhash();
   const message = v1Message(feePayer, blockhash, instructions);
   const tx = compileTransaction(message);
   assertIsTransactionWithBlockhashLifetime(tx);
   return tx;
}

function sponsorMessage(feePayer: Address, instructions: readonly Instruction[]) {
   return v1Message(feePayer, {
      blockhash: "11111111111111111111111111111111" as Blockhash,
      lastValidBlockHeight: 1n,
   }, instructions);
}

/** Simulate the exact sponsored message. `message` is the base64 posted to labs. */
export async function previewSponsor(
   feePayer: Address,
   instructions: readonly Instruction[],
): Promise<{ message: string; err: unknown; logs: readonly string[] | null }> {
   const preview = sponsorMessage(feePayer, instructions);
   const message = getBase64Decoder().decode(compileTransaction(preview).messageBytes);
   const simulation = await rpc.simulateTransaction(getBase64EncodedWireTransaction(compileTransaction(preview)), {
      encoding: "base64",
      replaceRecentBlockhash: true,
      sigVerify: false,
   }).send();
   return { message, err: simulation.value.err, logs: simulation.value.logs ?? null };
}

export async function decodeWire(b64: string): Promise<Transaction & TransactionWithBlockhashLifetime> {
   const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(b64));
   const compiled = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
   if (!("lifetimeToken" in compiled)) {
      throw new Error("Transaction is missing a blockhash");
   }
   const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
   const tx = {
      ...decoded,
      lifetimeConstraint: {
         blockhash: compiled.lifetimeToken as TransactionWithBlockhashLifetime["lifetimeConstraint"]["blockhash"],
         lastValidBlockHeight: height + 150n,
      },
   };
   assertIsTransactionWithBlockhashLifetime(tx);
   return tx;
}

function hasSignature(sig: Uint8Array | null | undefined): boolean {
   if (sig == null || sig.length === 0) {
      return false;
   }
   for (const byte of sig) {
      if (byte !== 0) {
         return true;
      }
   }
   return false;
}

export async function attachSigner(
   signer: TransactionPartialSigner,
   tx: Transaction & TransactionWithBlockhashLifetime,
): Promise<Transaction & TransactionWithBlockhashLifetime> {
   assertIsTransactionWithinSizeLimit(tx);
   const existing = tx.signatures[signer.address];
   if (existing !== undefined && hasSignature(existing)) {
      return tx;
   }
   const [added] = await signer.signTransactions([tx]);
   const signed = {
      ...tx,
      signatures: { ...tx.signatures, ...added },
   };
   assertIsTransactionWithBlockhashLifetime(signed);
   return signed;
}

export async function broadcast(tx: Transaction & TransactionWithBlockhashLifetime): Promise<Signature> {
   assertIsTransactionWithinSizeLimit(tx);
   assertIsSendableTransaction(tx);
   assertIsTransactionWithBlockhashLifetime(tx);
   const signature = getSignatureFromTransaction(tx);
   await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), {
      encoding: "base64",
      skipPreflight: false,
      maxRetries: 3n,
   }).send();
   const last = tx.lifetimeConstraint.lastValidBlockHeight;
   for (;;) {
      const { value } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
      const status = value[0];
      if (status != null) {
         if (status.err != null) {
            throw new Error(`Transaction failed: ${errorText(status.err)}`);
         }
         if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
            return signature;
         }
      }
      const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
      if (height > last) {
         throw new Error("Transaction expired before confirmation");
      }
      await sleep(800);
   }
}
