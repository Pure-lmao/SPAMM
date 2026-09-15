import {
   pipe,
   type Instruction,
   addSignersToTransactionMessage,
   appendTransactionMessageInstructions,
   assertIsSendableTransaction,
   assertIsTransactionWithBlockhashLifetime,
   createSolanaRpc,
   createSolanaRpcSubscriptions,
   createTransactionMessage,
   createTransactionPlanExecutor,
   createTransactionPlanner,
   estimateAndSetResourceLimitsFactory,
   estimateResourceLimitsFactory,
   fillTransactionMessageProvisoryResourceLimits,
   flattenTransactionPlanResult,
   getBase64EncodedWireTransaction,
   getSignatureFromTransaction,
   parallelInstructionPlan,
   sendAndConfirmTransactionFactory,
   sequentialInstructionPlan,
   setTransactionMessageConfig,
   setTransactionMessageFeePayerSigner,
   setTransactionMessageLifetimeUsingBlockhash,
   signTransactionMessageWithSigners,
   type Base64EncodedDataResponse,
   type Commitment,
   type KeyPairSigner,
   type Rpc,
   type RpcSubscriptions,
   type Signature,
   type SolanaRpcApi,
   type SolanaRpcSubscriptionsApi,
   type TransactionSigner,
   type V1TransactionConfig,
} from '@solana/kit';

/** 32 KiB pages — block cost model charges loaded-accounts data in these pages. */
const LOADED_ACCOUNTS_DATA_SIZE_PAGE_BYTES = 32 * 1024;
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

/** HTTP RPC URL (env `SOLANA_RPC_URL` or mainnet default). */
export function resolveHttpRpcUrl(override?: string): string {
   return override ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
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

/** Walk `error.cause` so Kit wrappers (e.g. CU-estimate failures) are included. */
export function getErrorCauseChain(error: unknown): unknown[] {
   const chain: unknown[] = [];
   const seen = new Set<unknown>();
   let current: unknown = error;
   while (current != null && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      if (typeof current === 'object' && 'cause' in current) {
         current = (current as { cause: unknown }).cause;
      } else {
         break;
      }
   }
   return chain;
}

function isRateLimitedMessage(message: string): boolean {
   return message.includes('429') || /rate.?limit/i.test(message);
}

export function isRpcRateLimited(error: unknown): boolean {
   for (const item of getErrorCauseChain(error)) {
      if (item === null || typeof item !== 'object') {
         continue;
      }
      const e = item as {
         statusCode?: number;
         message?: string;
         context?: { statusCode?: number; message?: string };
      };
      if (e.statusCode === 429 || e.context?.statusCode === 429) {
         return true;
      }
      if (typeof e.message === 'string' && isRateLimitedMessage(e.message)) {
         return true;
      }
      if (typeof e.context?.message === 'string' && isRateLimitedMessage(e.context.message)) {
         return true;
      }
   }
   return false;
}

/** `SolanaError.cause` is often non-enumerable, so `console.error(error)` hides it. */
export function logSolanaError(prefix: string, error: unknown): void {
   console.error(prefix, error);
   const chain = getErrorCauseChain(error);
   for (let i = 1; i < chain.length; i++) {
      const item = chain[i];
      console.error(`cause[${i}]:`, item);
      if (item !== null && typeof item === 'object' && 'context' in item) {
         const ctx = (item as { context?: { logs?: unknown } }).context;
         if (ctx?.logs != null) {
            console.error('simulation logs:', ctx.logs);
         }
      }
   }
   const top = chain[0];
   if (top !== null && typeof top === 'object' && 'context' in top) {
      const ctx = (top as { context?: { logs?: unknown } }).context;
      if (ctx?.logs != null) {
         console.error('simulation logs:', ctx.logs);
      }
   }
}

/** Shared so concurrent `withRpcRetry` callers back off together instead of retrying in lockstep. */
let rpcRateLimitCooldownUntilMs = 0;
/** Consecutive 429s across independent RPC calls (blockhash / simulate / send each wrap `withRpcRetry`). */
let rpcRateLimitStreak = 0;
let rpcExclusiveDepth = 0;
const runRpcExclusive = createAsyncMutex();

function createAsyncMutex() {
   let tail: Promise<void> = Promise.resolve();
   return async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
         release = resolve;
      });
      await previous;
      try {
         return await fn();
      } finally {
         release();
      }
   };
}

async function sleepMs(ms: number): Promise<void> {
   await new Promise((resolve) => setTimeout(resolve, ms));
}

function rateLimitDelayMs(baseDelayMs: number, maxAttempts: number): number {
   const exponent = Math.min(Math.max(rpcRateLimitStreak - 1, 0), maxAttempts - 2);
   return baseDelayMs * 2 ** exponent;
}

/**
 * Retry RPC calls when the provider returns HTTP 429.
 * The retry loop is process-wide exclusive so a burst of callers cannot all fire attempt 1 together.
 * Nested `withRpcRetry` (e.g. send helpers called from an outer retry) reuses the same lock.
 * Backoff streak is process-wide: a send does several independent `withRpcRetry` calls, so per-call
 * attempt counters never reached 2/6 even while the RPC stayed hot.
 */
export async function withRpcRetry<T>(
   fn: () => Promise<T>,
   options?: Readonly<{ maxAttempts?: number; baseDelayMs?: number }>,
): Promise<T> {
   const run = async (): Promise<T> => {
      rpcExclusiveDepth++;
      try {
         const maxAttempts = options?.maxAttempts ?? 6;
         const baseDelayMs = options?.baseDelayMs ?? 1000;
         let lastError: unknown;
         let sawRateLimit = false;
         for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const cooldownMs = rpcRateLimitCooldownUntilMs - Date.now();
            if (cooldownMs > 0) {
               await sleepMs(cooldownMs);
            }
            try {
               const result = await fn();
               if (sawRateLimit) {
                  rpcRateLimitCooldownUntilMs = Math.max(
                     rpcRateLimitCooldownUntilMs,
                     Date.now() + rateLimitDelayMs(baseDelayMs, maxAttempts),
                  );
               } else {
                  rpcRateLimitStreak = 0;
               }
               return result;
            } catch (error) {
               lastError = error;
               if (!isRpcRateLimited(error) || attempt === maxAttempts - 1) {
                  throw error;
               }
               sawRateLimit = true;
               rpcRateLimitStreak++;
               const delayMs = rateLimitDelayMs(baseDelayMs, maxAttempts);
               rpcRateLimitCooldownUntilMs = Math.max(rpcRateLimitCooldownUntilMs, Date.now() + delayMs);
               console.warn(
                  `RPC rate limited, retrying in ${delayMs}ms (${attempt + 1}/${maxAttempts}, streak ${rpcRateLimitStreak})`,
               );
               await sleepMs(delayMs);
            }
         }
         throw lastError;
      } finally {
         rpcExclusiveDepth--;
      }
   };
   if (rpcExclusiveDepth > 0) {
      return run();
   }
   return runRpcExclusive(run);
}

/** Round loaded-accounts data size up to the next 32 KiB page (+1 so exact pages get headroom). */
export function roundUpLoadedAccountsDataSize(bytes: number): number {
   const rounded = Math.ceil((bytes + 1) / LOADED_ACCOUNTS_DATA_SIZE_PAGE_BYTES) * LOADED_ACCOUNTS_DATA_SIZE_PAGE_BYTES;
   return Math.min(rounded, MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT);
}

function createEstimateAndSetResourceLimits(rpc: Rpc<SolanaRpcApi>) {
   const estimateResourceLimits = estimateResourceLimitsFactory({ rpc });
   return estimateAndSetResourceLimitsFactory(async (message, estimateConfig) => {
      const estimate = await withRpcRetry(() => estimateResourceLimits(message, estimateConfig));
      const computeUnitLimit = Math.min(
         MAX_COMPUTE_UNIT_LIMIT,
         Math.ceil(estimate.computeUnitLimit * 1.1),
      );
      if (!('loadedAccountsDataSizeLimit' in estimate) || estimate.loadedAccountsDataSizeLimit == null) {
         throw new Error('v1 resource estimate missing loadedAccountsDataSizeLimit');
      }
      return {
         computeUnitLimit,
         loadedAccountsDataSizeLimit: roundUpLoadedAccountsDataSize(estimate.loadedAccountsDataSizeLimit),
      };
   });
}

export type BuildSignV1Params = Readonly<{
   feePayer: KeyPairSigner;
   instructions: readonly Instruction[];
   /** Every signer required by the instructions (typically includes `feePayer`). */
   signers: readonly TransactionSigner[];
   /**
    * Optional explicit v1 message config (CU / data-size / heap / priority fee).
    * Unset CU or loaded-accounts limits are still estimated via simulation.
    */
   config?: V1TransactionConfig;
}>;

/** Fetch blockhash, assemble v1 message, estimate resource limits, attach signers, sign. */
export async function buildSignV1Transaction(
   rpc: Rpc<SolanaRpcApi>,
   params: BuildSignV1Params,
): Promise<ReturnType<typeof signTransactionMessageWithSigners>> {
   const { value: latestBlockhash } = await withRpcRetry(() =>
      rpc.getLatestBlockhash({ commitment: 'confirmed' }).send(),
   );

   const txMessageBase = pipe(
      createTransactionMessage({ version: 1 }),
      (m) => setTransactionMessageFeePayerSigner(params.feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([...params.instructions], m),
      (m) => (params.config ? setTransactionMessageConfig(params.config, m) : m),
      (m) => fillTransactionMessageProvisoryResourceLimits(m),
   );

   const estimateAndSet = createEstimateAndSetResourceLimits(rpc);

   const txMessage = await estimateAndSet(txMessageBase, { commitment: 'confirmed' });
   const txMessageWithSigners = addSignersToTransactionMessage([...params.signers], txMessage);
   const signedTransaction = await signTransactionMessageWithSigners(txMessageWithSigners);
   assertIsTransactionWithBlockhashLifetime(signedTransaction);
   return signedTransaction;
}

export type SendConfirmParams = Readonly<{
   commitment?: Commitment;
}>;

/** Send a fully signed blockhash-lifetime v1 transaction and wait for confirmation. */
export async function sendAndConfirmSignedTransaction(
   clients: RpcClients,
   signedTransaction: Awaited<ReturnType<typeof buildSignV1Transaction>>,
   options?: SendConfirmParams,
): Promise<Signature> {
   const commitment = options?.commitment ?? 'confirmed';
   const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
      rpc: clients.rpc,
      rpcSubscriptions: clients.rpcSubscriptions,
   } as never);
   await withRpcRetry(() => sendAndConfirmTransaction(signedTransaction as never, { commitment }));
   return getSignatureFromTransaction(signedTransaction);
}

/**
 * Build, sign, send, and confirm a single v1 transaction.
 * Use when the instruction list is known to fit in one transaction.
 * `signers[0]` is the fee payer.
 */
export async function sendAndConfirmInstructions(
   instructions: readonly Instruction[],
   signers: readonly KeyPairSigner[],
): Promise<Signature> {
   const clients = createRpcClients();
   const signedTransaction = await buildSignV1Transaction(clients.rpc, {
      feePayer: signers[0]!,
      instructions,
      signers,
   });
   return sendAndConfirmSignedTransaction(clients, signedTransaction);
}

export type SendInstructionGroupsParams = Readonly<{
   commitment?: Commitment;
   /**
    * Cap on instructions packed into each planned transaction, including compute-budget ixs.
    * Kit default is 16 (hard max 64).
    */
   maxInstructionsPerTransaction?: number;
   /** Optional explicit v1 message config applied to every planned transaction. */
   config?: V1TransactionConfig;
}>;

/**
 * Plan and send many instructions as separate v1 transactions when they cannot fit in one.
 *
 * Each inner array is a sequential group (order preserved; Kit may split a group across txs).
 * Groups are independent and may be packed and sent in parallel.
 */
export async function sendAndConfirmInstructionGroups(
   instructionGroups: readonly (readonly Instruction[])[],
   signers: readonly KeyPairSigner[],
   options?: SendInstructionGroupsParams,
): Promise<readonly Signature[]> {
   const groups = instructionGroups.filter((group) => group.length > 0);
   if (groups.length === 0) {
      return [];
   }

   const feePayer = signers[0]!;
   const clients = createRpcClients();
   const commitment = options?.commitment ?? 'confirmed';
   const estimateAndSet = createEstimateAndSetResourceLimits(clients.rpc);
   const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
      rpc: clients.rpc,
      rpcSubscriptions: clients.rpcSubscriptions,
   } as never);

   const instructionPlan = parallelInstructionPlan(
      groups.map((group) =>
         group.length === 1 ? group[0]! : sequentialInstructionPlan([...group]),
      ),
   );

   const transactionPlanner = createTransactionPlanner({
      maxInstructionsPerTransaction: options?.maxInstructionsPerTransaction ?? 32,
      createTransactionMessage: () =>
         pipe(
            createTransactionMessage({ version: 1 }),
            (m) => setTransactionMessageFeePayerSigner(feePayer, m),
            (m) => (options?.config ? setTransactionMessageConfig(options.config, m) : m),
            (m) => fillTransactionMessageProvisoryResourceLimits(m),
         ),
      onTransactionMessageUpdated: (message) =>
         addSignersToTransactionMessage([...signers], message),
   });

   const runExclusive = createAsyncMutex();
   const transactionPlanExecutor = createTransactionPlanExecutor({
      executeTransactionMessage: async (context, message) =>
         runExclusive(async () => {
            const { value: latestBlockhash } = await withRpcRetry(() =>
               clients.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send(),
            );
            const messageWithBlockhash = setTransactionMessageLifetimeUsingBlockhash(
               latestBlockhash,
               message,
            );
            context.message = messageWithBlockhash;
            const estimatedMessage = await estimateAndSet(messageWithBlockhash, {
               commitment: 'confirmed',
            });
            context.message = estimatedMessage;
            const signedTransaction = await signTransactionMessageWithSigners(estimatedMessage);
            context.transaction = signedTransaction;
            assertIsSendableTransaction(signedTransaction);
            assertIsTransactionWithBlockhashLifetime(signedTransaction);
            const signature = getSignatureFromTransaction(signedTransaction);
            await withRpcRetry(() =>
               sendAndConfirmTransaction(signedTransaction as never, { commitment }),
            );
            return { signature, transaction: signedTransaction };
         }),
   });

   const transactionPlan = await transactionPlanner(instructionPlan);
   const result = await transactionPlanExecutor(transactionPlan);
   return flattenTransactionPlanResult(result).flatMap((single) =>
      single.status === 'successful' ? [single.context.signature] : [],
   );
}

export async function simulateTransaction(
   rpc: Rpc<SolanaRpcApi>,
   instructions: readonly Instruction[],
   signers: readonly KeyPairSigner[],
): Promise<Base64EncodedDataResponse | undefined> {
   const transaction = await buildSignV1Transaction(rpc, {
      feePayer: signers[0]!,
      instructions,
      signers,
   });
   const encodedTransaction = getBase64EncodedWireTransaction(transaction);
   const simulation = await withRpcRetry(async () => await rpc
      .simulateTransaction(encodedTransaction, { encoding: 'base64', sigVerify: false })
      .send(), { maxAttempts: 3 });
   return simulation.value.returnData?.data;
}