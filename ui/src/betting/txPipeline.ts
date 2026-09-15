import {
   addSignersToTransactionMessage,
   appendTransactionMessageInstructions,
   assertIsTransactionWithBlockhashLifetime,
   compileTransaction,
   createNoopSigner,
   createTransactionMessage,
   estimateAndSetResourceLimitsFactory,
   estimateResourceLimitsFactory,
   fillTransactionMessageProvisoryResourceLimits,
   getBase64EncodedWireTransaction,
   pipe,
   setTransactionMessageConfig,
   setTransactionMessageFeePayer,
   setTransactionMessageFeePayerSigner,
   setTransactionMessageLifetimeUsingBlockhash,
   signTransactionMessageWithSigners,
   type Address,
   type Instruction,
   type Rpc,
   type SolanaRpcApi,
   type TransactionSigner,
} from "@solana/kit";

const PUBLIC_HTTP_RPC: Record<string, string> = {
   devnet: "https://api.devnet.solana.com",
   testnet: "https://api.testnet.solana.com",
   mainnet: "https://api.mainnet-beta.solana.com",
   "mainnet-beta": "https://api.mainnet-beta.solana.com",
   localnet: "http://127.0.0.1:8899",
};

const LOADED_ACCOUNTS_DATA_SIZE_PAGE_BYTES = 32 * 1024;
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;
const RPC_MIN_GAP_MS = 300;
const RPC_MAX_ATTEMPTS = 6;
const RPC_BASE_DELAY_MS = 1000;

let rpcQueue: Promise<void> = Promise.resolve();
let rpcLastStartedAtMs = 0;
let rpcRateLimitCooldownUntilMs = 0;
let rpcRateLimitStreak = 0;

function sleepMs(ms: number): Promise<void> {
   return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifyUnknown(value: unknown): string {
   try {
      return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
   } catch {
      return String(value);
   }
}

function isRpcRateLimited(error: unknown): boolean {
   let current: unknown = error;
   const seen = new Set<unknown>();
   while (current != null && !seen.has(current)) {
      seen.add(current);
      if (typeof current === "object") {
         const e = current as {
            statusCode?: number;
            message?: string;
            context?: { statusCode?: number; message?: string };
            cause?: unknown;
         };
         if (e.statusCode === 429 || e.context?.statusCode === 429) {
            return true;
         }
         const msg = `${e.message ?? ""} ${e.context?.message ?? ""}`;
         if (msg.includes("429") || /rate.?limit/i.test(msg)) {
            return true;
         }
         current = e.cause;
         continue;
      }
      break;
   }
   return false;
}

function rateLimitDelayMs(): number {
   const exponent = Math.min(Math.max(rpcRateLimitStreak - 1, 0), RPC_MAX_ATTEMPTS - 2);
   return RPC_BASE_DELAY_MS * 2 ** exponent;
}

/** One RPC at a time, min gap between calls, shared 429 backoff. */
export async function runPacedRpc<T>(fn: () => Promise<T>): Promise<T> {
   const run = async (): Promise<T> => {
      let lastError: unknown;
      for (let attempt = 0; attempt < RPC_MAX_ATTEMPTS; attempt++) {
         const waitMs = Math.max(rpcRateLimitCooldownUntilMs - Date.now(), RPC_MIN_GAP_MS - (Date.now() - rpcLastStartedAtMs), 0);
         if (waitMs > 0) {
            await sleepMs(waitMs);
         }
         rpcLastStartedAtMs = Date.now();
         try {
            const result = await fn();
            if (rpcRateLimitStreak > 0) {
               rpcRateLimitCooldownUntilMs = Math.max(rpcRateLimitCooldownUntilMs, Date.now() + RPC_MIN_GAP_MS);
               rpcRateLimitStreak = Math.max(0, rpcRateLimitStreak - 1);
            }
            return result;
         } catch (error) {
            lastError = error;
            if (!isRpcRateLimited(error) || attempt === RPC_MAX_ATTEMPTS - 1) {
               throw error;
            }
            rpcRateLimitStreak++;
            const delayMs = rateLimitDelayMs();
            rpcRateLimitCooldownUntilMs = Math.max(rpcRateLimitCooldownUntilMs, Date.now() + delayMs);
            console.warn(`RPC rate limited, retrying in ${delayMs}ms (${attempt + 1}/${RPC_MAX_ATTEMPTS})`);
         }
      }
      throw lastError;
   };
   const previous = rpcQueue;
   let release!: () => void;
   rpcQueue = new Promise<void>((resolve) => {
      release = resolve;
   });
   await previous;
   try {
      return await run();
   } finally {
      release();
   }
}

/**
 * Connector / wallet-ui may expose `cluster.url` as a full HTTP(S) URL or a short moniker (`devnet`, etc.).
 * WebSocket clients require a real URL — normalize here.
 */
export function resolveHttpRpcUrl(raw: string | undefined | null): string {
   const u = (raw ?? "").trim();
   if (u === "") {
      return PUBLIC_HTTP_RPC.devnet!;
   }
   if (u.startsWith("https://") || u.startsWith("http://")) {
      return u;
   }
   const key = u.replace(/^solana:/i, "").toLowerCase();
   if (key in PUBLIC_HTTP_RPC) {
      return PUBLIC_HTTP_RPC[key]!;
   }
   return PUBLIC_HTTP_RPC.devnet!;
}

/** Prefer `VITE_SOLANA_RPC_URL`, then connector cluster URL, then public devnet. */
export function resolveAppHttpRpcUrl(clusterUrl?: string | null): string {
   const env =
      typeof import.meta.env.VITE_SOLANA_RPC_URL === "string" ? import.meta.env.VITE_SOLANA_RPC_URL.trim() : "";
   if (env !== "") {
      return resolveHttpRpcUrl(env);
   }
   const fromCluster = clusterUrl?.trim() ?? "";
   return resolveHttpRpcUrl(fromCluster !== "" ? fromCluster : null);
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

function roundUpLoadedAccountsDataSize(bytes: number): number {
   const rounded =
      Math.ceil((bytes + 1) / LOADED_ACCOUNTS_DATA_SIZE_PAGE_BYTES) * LOADED_ACCOUNTS_DATA_SIZE_PAGE_BYTES;
   return Math.min(rounded, MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT);
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

export async function buildSignV1Transaction(
   rpc: Rpc<SolanaRpcApi>,
   params: Readonly<{
      feePayer: TransactionSigner;
      instructions: readonly Instruction[];
      signers: readonly TransactionSigner[];
   }>,
): Promise<ReturnType<typeof signTransactionMessageWithSigners>> {
   const { value: latestBlockhash } = await runPacedRpc(() =>
      rpc.getLatestBlockhash({ commitment: "confirmed" }).send(),
   );

   const txMessageBase = pipe(
      createTransactionMessage({ version: 1 }),
      (m) => setTransactionMessageFeePayerSigner(params.feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([...params.instructions], m),
      (m) => fillTransactionMessageProvisoryResourceLimits(m),
   );

   const estimateResourceLimits = estimateResourceLimitsFactory({ rpc });
   const estimateAndSet = estimateAndSetResourceLimitsFactory(async (message, estimateConfig) => {
      const estimate = await estimateResourceLimits(message, estimateConfig);
      const computeUnitLimit = Math.min(MAX_COMPUTE_UNIT_LIMIT, Math.ceil(estimate.computeUnitLimit * 1.1));
      if (!("loadedAccountsDataSizeLimit" in estimate) || estimate.loadedAccountsDataSizeLimit == null) {
         throw new Error("v1 resource estimate missing loadedAccountsDataSizeLimit");
      }
      return {
         computeUnitLimit,
         loadedAccountsDataSizeLimit: roundUpLoadedAccountsDataSize(estimate.loadedAccountsDataSizeLimit),
      };
   });

   const txMessage = await estimateAndSet(txMessageBase, { commitment: "confirmed" });
   const txMessageWithSigners = addSignersToTransactionMessage([...params.signers], txMessage);
   const signedTransaction = await signTransactionMessageWithSigners(txMessageWithSigners);
   assertIsTransactionWithBlockhashLifetime(signedTransaction);
   return signedTransaction;
}

export async function simulateInstructionReturnData(
   rpc: Rpc<SolanaRpcApi>,
   instruction: Instruction,
   feePayerAddress: Address,
   lifetime?: Parameters<typeof setTransactionMessageLifetimeUsingBlockhash>[0],
): Promise<Uint8Array | undefined> {
   const feePayerNoop = createNoopSigner(feePayerAddress);
   const latestBlockhash =
      lifetime ??
      (
         await runPacedRpc(() => rpc.getLatestBlockhash({ commitment: "confirmed" }).send())
      ).value;

   const txMessage = pipe(
      createTransactionMessage({ version: 1 }),
      (m) => setTransactionMessageFeePayer(feePayerNoop.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([instruction], m),
      (m) =>
         setTransactionMessageConfig(
            {
               computeUnitLimit: MAX_COMPUTE_UNIT_LIMIT,
               loadedAccountsDataSizeLimit: MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
            },
            m,
         ),
   );

   const unsignedTransaction = compileTransaction(txMessage);
   const encodedTransaction = getBase64EncodedWireTransaction(unsignedTransaction);
   const simulation = await runPacedRpc(() =>
      rpc
         .simulateTransaction(encodedTransaction, {
            encoding: "base64",
            replaceRecentBlockhash: true,
            sigVerify: false,
         })
         .send(),
   );
   if (simulation.value.err != null) {
      throw new Error(`simulateTransaction failed: ${stringifyUnknown(simulation.value.err)}`);
   }
   const data = simulation.value.returnData?.data;
   return data === undefined ? undefined : base64ReturnDataToBytes(data);
}
