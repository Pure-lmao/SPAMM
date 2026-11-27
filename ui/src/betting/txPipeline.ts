import {
   addSignersToTransactionMessage,
   appendTransactionMessageInstructions,
   assertIsSendableTransaction,
   assertIsTransactionWithBlockhashLifetime,
   assertIsTransactionWithinSizeLimit,
   compileTransaction,
   createNoopSigner,
   createTransactionMessage,
   estimateAndSetResourceLimitsFactory,
   estimateResourceLimitsFactory,
   fillTransactionMessageProvisoryResourceLimits,
   getBase58Decoder,
   getBase64Decoder,
   getBase64EncodedWireTransaction,
   getBase64Encoder,
   getCompiledTransactionMessageDecoder,
   getSignatureFromTransaction,
   getTransactionDecoder,
   getTransactionLifetimeConstraintFromCompiledTransactionMessage,
   isTransactionModifyingSigner,
   isTransactionPartialSigner,
   isTransactionSendingSigner,
   pipe,
   sendAndConfirmTransactionFactory,
   setTransactionMessageConfig,
   setTransactionMessageFeePayer,
   setTransactionMessageFeePayerSigner,
   setTransactionMessageLifetimeUsingBlockhash,
   signAndSendTransactionMessageWithSigners,
   signTransactionMessageWithSigners,
   type Address,
   type Blockhash,
   type Instruction,
   type Rpc,
   type Signature,
   type SignatureBytes,
   type SolanaRpcApi,
   type Transaction,
   type TransactionSigner,
   type TransactionWithBlockhashLifetime,
} from "@solana/kit";
import { PUBLIC_SOLANA_RPC, SOLANA_RPC_URL } from "../network";
import { ensureSolFreeAddress, requestSolFreeSignature, solBalanceNeedsSponsor } from "../wallet/solFreeSponsor";
import { isRecoverableSignAndSendFailure } from "../wallet/walletStandardV1Signer";

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
      return PUBLIC_SOLANA_RPC;
   }
   if (u.startsWith("https://") || u.startsWith("http://")) {
      return u;
   }
   const key = u.replace(/^solana:/i, "").toLowerCase();
   if (key in PUBLIC_HTTP_RPC) {
      return PUBLIC_HTTP_RPC[key]!;
   }
   return PUBLIC_SOLANA_RPC;
}

/** Prefer the NETWORK-selected RPC, then the connector cluster URL, then the public cluster RPC. */
export function resolveAppHttpRpcUrl(clusterUrl?: string | null): string {
   if (SOLANA_RPC_URL !== "") {
      return resolveHttpRpcUrl(SOLANA_RPC_URL);
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
): Promise<Transaction & TransactionWithBlockhashLifetime> {
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
   if (params.signers.some((signer) => isTransactionSendingSigner(signer))) {
      try {
         const signatureBytes = await signAndSendTransactionMessageWithSigners(txMessageWithSigners);
         if (signatureBytes == null) {
            throw new Error("Wallet did not return a transaction signature");
         }
         const signedTransaction = attachFeePayerSignature(
            compileTransaction(txMessageWithSigners),
            params.feePayer.address,
            signatureBytes,
         );
         assertIsTransactionWithBlockhashLifetime(signedTransaction);
         rememberWalletBroadcast(signedTransaction, signatureBytesToSignature(signatureBytes));
         return signedTransaction;
      } catch (error) {
         const canSignWithoutSend = params.signers.every(
            (signer) =>
               !isTransactionSendingSigner(signer) ||
               isTransactionModifyingSigner(signer) ||
               isTransactionPartialSigner(signer),
         );
         if (!canSignWithoutSend || !isRecoverableSignAndSendFailure(error)) {
            throw error;
         }
      }
   }
   const signedTransaction = await signTransactionMessageWithSigners(txMessageWithSigners);
   assertIsTransactionWithBlockhashLifetime(signedTransaction);
   return signedTransaction;
}

/** Wallet pays fees at or above `SOL_FREE_MIN_LAMPORTS`. Below that, the stored sol-free signer pays. */
export async function resolveUserTxFeePayer(rpc: Rpc<SolanaRpcApi>, wallet: Address): Promise<Address> {
   const { value: lamports } = await runPacedRpc(() => rpc.getBalance(wallet).send());
   if (!solBalanceNeedsSponsor(lamports)) {
      return wallet;
   }
   return ensureSolFreeAddress();
}

const SPONSOR_PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111" as Blockhash;

function hasRealSignature(sig: Uint8Array | null | undefined): boolean {
   if (sig == null || sig.length === 0) {
      return false;
   }
   for (let i = 0; i < sig.length; i++) {
      if (sig[i] !== 0) {
         return true;
      }
   }
   return false;
}

function compiledSponsorMessageBase64(feePayer: Address, instructions: readonly Instruction[]): string {
   const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(feePayer, m),
      (m) =>
         setTransactionMessageLifetimeUsingBlockhash(
            { blockhash: SPONSOR_PLACEHOLDER_BLOCKHASH, lastValidBlockHeight: 1n },
            m,
         ),
      (m) => appendTransactionMessageInstructions([...instructions], m),
   );
   return getBase64Decoder().decode(compileTransaction(message).messageBytes);
}

async function addWalletSignature(
   walletSigner: TransactionSigner,
   transaction: Transaction & TransactionWithBlockhashLifetime,
): Promise<Transaction & TransactionWithBlockhashLifetime> {
   assertIsTransactionWithinSizeLimit(transaction);
   const signerProbe = walletSigner as { [key: string]: unknown; address: Address };
   if (isTransactionPartialSigner(signerProbe)) {
      const [added] = await signerProbe.signTransactions([transaction]);
      return {
         ...transaction,
         signatures: { ...transaction.signatures, ...added },
      };
   }
   if (isTransactionModifyingSigner(signerProbe)) {
      const [signed] = await signerProbe.modifyAndSignTransactions([transaction]);
      const withLifetime = {
         messageBytes: signed.messageBytes,
         signatures: signed.signatures,
         lifetimeConstraint:
            "lifetimeConstraint" in signed && "blockhash" in signed.lifetimeConstraint
               ? signed.lifetimeConstraint
               : transaction.lifetimeConstraint,
      };
      assertIsTransactionWithBlockhashLifetime(withLifetime);
      return withLifetime;
   }
   throw new Error("Wallet cannot sign transactions");
}

async function signSponsoredTransaction(
   rpc: Rpc<SolanaRpcApi>,
   walletSigner: TransactionSigner,
   wireB64: string,
): Promise<Transaction & TransactionWithBlockhashLifetime> {
   const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(wireB64));
   const compiled = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
   const lifetime = await getTransactionLifetimeConstraintFromCompiledTransactionMessage(compiled);
   if (!("blockhash" in lifetime)) {
      throw new Error("Sponsored transaction is missing a blockhash");
   }
   const { value: latest } = await runPacedRpc(() => rpc.getLatestBlockhash({ commitment: "confirmed" }).send());
   const withLifetime = {
      ...decoded,
      lifetimeConstraint: {
         blockhash: lifetime.blockhash,
         lastValidBlockHeight: latest.lastValidBlockHeight,
      },
   };
   assertIsTransactionWithBlockhashLifetime(withLifetime);
   const userSig = withLifetime.signatures[walletSigner.address];
   const needsUser = userSig !== undefined && !hasRealSignature(userSig);
   const signed = needsUser ? await signSponsoredWithWallet(walletSigner, withLifetime) : withLifetime;
   if (walletBroadcastSignatures.has(signed)) {
      assertIsTransactionWithBlockhashLifetime(signed);
      return signed;
   }
   const sponsor = compiled.staticAccounts[0];
   if (sponsor == null || !hasRealSignature(signed.signatures[sponsor])) {
      throw new Error("Sponsored fee payer signature missing");
   }
   if (needsUser && !hasRealSignature(signed.signatures[walletSigner.address])) {
      throw new Error("Wallet did not sign the transaction");
   }
   assertIsTransactionWithBlockhashLifetime(signed);
   assertIsSendableTransaction(signed);
   return signed;
}

async function signSponsoredWithWallet(
   walletSigner: TransactionSigner,
   transaction: Transaction & TransactionWithBlockhashLifetime,
): Promise<Transaction & TransactionWithBlockhashLifetime> {
   if (!isTransactionSendingSigner(walletSigner)) {
      return addWalletSignature(walletSigner, transaction);
   }
   try {
      const [signatureBytes] = await walletSigner.signAndSendTransactions([transaction]);
      if (signatureBytes == null) {
         throw new Error("Wallet did not return a transaction signature");
      }
      rememberWalletBroadcast(transaction, signatureBytesToSignature(signatureBytes));
      return transaction;
   } catch (error) {
      const canSignWithoutSend = isTransactionModifyingSigner(walletSigner) || isTransactionPartialSigner(walletSigner);
      if (!canSignWithoutSend || !isRecoverableSignAndSendFailure(error)) {
         throw error;
      }
      return addWalletSignature(walletSigner, transaction);
   }
}

const walletBroadcastSignatures = new WeakMap<object, Signature>();

function rememberWalletBroadcast(transaction: object, signature: Signature): void {
   walletBroadcastSignatures.set(transaction, signature);
}

function signatureBytesToSignature(signature: SignatureBytes): Signature {
   return getBase58Decoder().decode(signature) as Signature;
}

function attachFeePayerSignature<T extends Transaction>(transaction: T, feePayer: Address, signature: SignatureBytes): T {
   return {
      ...transaction,
      signatures: {
         ...transaction.signatures,
         [feePayer]: signature,
      },
   };
}

async function confirmWalletBroadcast(
   rpc: Rpc<SolanaRpcApi>,
   signature: Signature,
   lastValidBlockHeight: bigint,
): Promise<void> {
   for (;;) {
      const { value } = await runPacedRpc(() =>
         rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send(),
      );
      const status = value[0];
      if (status != null) {
         if (status.err != null) {
            throw new Error(`Transaction failed: ${stringifyUnknown(status.err)}`);
         }
         if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
            return;
         }
      }
      const height = await runPacedRpc(() => rpc.getBlockHeight({ commitment: "confirmed" }).send());
      if (height > lastValidBlockHeight) {
         throw new Error("Transaction expired before confirmation");
      }
      await sleepMs(800);
   }
}

/**
 * Send a signed transaction and wait for confirmation.
 * When the wallet already broadcast it via sign-and-send, only confirmation runs.
 */
export async function broadcastUserTransaction(
   rpc: Rpc<SolanaRpcApi>,
   rpcSubscriptions: unknown,
   transaction: Transaction & TransactionWithBlockhashLifetime,
): Promise<Signature> {
   const alreadySent = walletBroadcastSignatures.get(transaction);
   if (alreadySent != null) {
      await confirmWalletBroadcast(rpc, alreadySent, transaction.lifetimeConstraint.lastValidBlockHeight);
      return alreadySent;
   }
   const sendAndConfirm = sendAndConfirmTransactionFactory({
      rpc,
      rpcSubscriptions,
   } as never);
   await sendAndConfirm(transaction as never, { commitment: "confirmed" });
   return getSignatureFromTransaction(transaction);
}

/**
 * Sign aggregator user instructions.
 * Wallets that support sign-and-send broadcast the transaction here. Other wallets only sign, and
 * `broadcastUserTransaction` sends it.
 * When `feePayer` is the sol-free signer, the server replaces the blockhash and pays the fee, then
 * the wallet signs the returned transaction if it moves USDC.
 */
export async function signUserInstructions(
   rpc: Rpc<SolanaRpcApi>,
   params: Readonly<{
      walletSigner: TransactionSigner;
      feePayer: Address;
      instructions: readonly Instruction[];
   }>,
): Promise<Awaited<ReturnType<typeof buildSignV1Transaction>>> {
   if (params.feePayer === params.walletSigner.address) {
      return buildSignV1Transaction(rpc, {
         feePayer: params.walletSigner,
         instructions: params.instructions,
         signers: [params.walletSigner],
      });
   }
   const messageB64 = compiledSponsorMessageBase64(params.feePayer, params.instructions);
   const wireB64 = await requestSolFreeSignature(messageB64);
   const signed = await signSponsoredTransaction(rpc, params.walletSigner, wireB64);
   return signed as unknown as Awaited<ReturnType<typeof buildSignV1Transaction>>;
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
