import { sleep } from "bun";
import {
   address,
   getBase58Decoder,
   getBase58Encoder,
   getCompiledTransactionMessageDecoder,
   getTransactionDecoder,
   type Address,
   type Base64EncodedBytes,
   type Base64EncodedDataResponse,
   type Rpc,
   type Signature,
   type SolanaRpcApi,
   type SolanaRpcSubscriptionsApi,
   type RpcSubscriptions,
} from "@solana/kit";
import { AGGREGATOR_PROGRAM_ID } from "spamm-aggregator-sdk";
import { createRpcClients, type RpcClients } from "../aggregator/client/txSend";
import { withRpcRetry } from "../aggregator/client/txSendV1";
import {
   getIndexerWatermark,
   setIndexerWatermark,
} from "./indexerDb";
import {
   applyV1Instruction,
   retryUnresolvedAccounts as retryUnresolvedV1,
   V1_FROM_SLOT,
   type IndexedInstruction,
   type IndexedTxContext,
} from "./indexerV1";

export type {
   BetRecord,
   BetRecordType,
   CashoutEscrowRecord,
   CashoutEscrowStatus,
   CashoutRecord,
   EventState,
   Filler,
   Selection,
} from "./indexerDb";
export { BetRecordStatus, getCashoutEscrowRecordsByUser, getClosedBetRecordsByUser } from "./indexerDb";

const KEEPALIVE_MS = 5 * 60 * 1000;
const RECONNECT_MS = 2_000;
const RETRY_UNRESOLVED_MS = 30_000;
const BACKFILL_PAGE_LIMIT = 100;

const txDecoder = getTransactionDecoder();
const msgDecoder = getCompiledTransactionMessageDecoder();
const base58Encoder = getBase58Encoder();
const base58Decoder = getBase58Decoder();

type HeliusHistoryPage = {
   data?: HeliusHistoryRow[];
   paginationToken?: string | null;
};

type HeliusHistoryRow = {
   slot?: number | string;
   blockTime?: number | null;
   signature?: string;
   transaction?: unknown;
   meta?: unknown;
};

type ProgramVersion = {
   id: "v1";
   fromSlot: bigint;
   toSlot: bigint | null;
   applyInstruction: (
      rpc: Rpc<SolanaRpcApi>,
      ix: IndexedInstruction,
      ctx: IndexedTxContext,
   ) => Promise<void>;
};

const PROGRAM_VERSIONS: ProgramVersion[] = [
   {
      id: "v1",
      fromSlot: V1_FROM_SLOT,
      toSlot: null,
      applyInstruction: applyV1Instruction,
   },
];

export type ChainTransaction = {
   signature: string;
   slot: bigint;
   blockTime: number | null;
   err: unknown;
   wire: Base64EncodedDataResponse | null;
   meta: unknown;
};

function versionForSlot(slot: bigint): ProgramVersion | null {
   for (const version of PROGRAM_VERSIONS) {
      if (slot < version.fromSlot) {
         continue;
      }
      if (version.toSlot != null && slot >= version.toSlot) {
         continue;
      }
      return version;
   }
   return null;
}

function heliusWsUrl(httpUrl: string): string {
   if (httpUrl.startsWith("https://")) {
      return `wss://${httpUrl.slice("https://".length)}`;
   }
   if (httpUrl.startsWith("http://")) {
      return `ws://${httpUrl.slice("http://".length)}`;
   }
   return httpUrl;
}

function requireHeliusHttpUrl(): string {
   const httpUrl = process.env.HELIUS_RPC_URL;
   if (httpUrl == null || httpUrl === "") {
      throw new Error("HELIUS_RPC_URL is not set");
   }
   return httpUrl;
}

export async function indexTransaction(tx: ChainTransaction, rpc: Rpc<SolanaRpcApi>): Promise<void> {
   if (tx.slot < V1_FROM_SLOT) {
      return;
   }
   if (tx.err != null) {
      setIndexerWatermark(tx.signature, Number(tx.slot));
      return;
   }
   const version = versionForSlot(tx.slot);
   if (version == null || tx.wire == null) {
      return;
   }
   const blockTime = await resolveBlockTime(rpc, tx.slot, tx.blockTime);
   const instructions = parseAggregatorInstructions(tx.wire, tx.meta);
   const ctx: IndexedTxContext = {
      signature: tx.signature,
      slot: Number(tx.slot),
      blockTime,
      meta: tx.meta,
   };
   for (const ix of instructions) {
      await version.applyInstruction(rpc, ix, ctx);
   }
   setIndexerWatermark(tx.signature, Number(tx.slot));
}

export async function indexSignature(signature: string, rpc: Rpc<SolanaRpcApi> = defaultRpc()): Promise<void> {
   const tx = await fetchTransaction(rpc, signature);
   if (tx == null) {
      console.error("transaction unavailable:", signature);
      return;
   }
   await indexTransaction(tx, rpc);
}

export async function backfillProgramHistory(
   options?: { afterSlot?: number },
   rpc: Rpc<SolanaRpcApi> = defaultRpc(),
): Promise<void> {
   const floor = options?.afterSlot ?? Number(V1_FROM_SLOT) - 1;
   try {
      await backfillViaHelius(rpc, floor);
   } catch (error) {
      console.error("getTransactionsForAddress failed, using getSignaturesForAddress:", error);
      await backfillViaSignatures(rpc, floor);
   }
}

export async function retryUnresolvedAccounts(rpc: Rpc<SolanaRpcApi> = defaultRpc()): Promise<void> {
   await retryUnresolvedV1(rpc);
}

let sharedRpc: Rpc<SolanaRpcApi> | null = null;

function defaultRpc(): Rpc<SolanaRpcApi> {
   if (sharedRpc == null) {
      sharedRpc = createRpcClients({ httpUrl: requireHeliusHttpUrl() }).rpc;
   }
   return sharedRpc;
}

async function resolveBlockTime(rpc: Rpc<SolanaRpcApi>, slot: bigint, blockTime: number | null): Promise<number> {
   if (blockTime != null) {
      return blockTime;
   }
   try {
      const fetched = await withRpcRetry(() => rpc.getBlockTime(slot).send());
      return fetched == null ? 0 : Number(fetched);
   } catch (error) {
      console.error("getBlockTime failed", slot, error instanceof Error ? error.message : error);
      return 0;
   }
}

async function fetchTransaction(rpc: Rpc<SolanaRpcApi>, signature: string): Promise<ChainTransaction | null> {
   for (let attempt = 0; attempt < 4; attempt++) {
      const value = await withRpcRetry(() =>
         rpc.getTransaction(signature as Signature, {
            commitment: "confirmed",
            encoding: "base64",
            maxSupportedTransactionVersion: 1,
         }).send(),
      );
      if (value != null) {
         const wire = asBase64Wire(value.transaction);
         return {
            signature,
            slot: BigInt(value.slot),
            blockTime: value.blockTime == null ? null : Number(value.blockTime),
            err: value.meta?.err ?? null,
            wire,
            meta: value.meta,
         };
      }
      await sleep(400 * (attempt + 1));
   }
   return null;
}

async function backfillViaHelius(rpc: Rpc<SolanaRpcApi>, floor: number): Promise<void> {
   const httpUrl = requireHeliusHttpUrl();
   let paginationToken: string | null = null;
   for (;;) {
      const page: HeliusHistoryPage = await heliusCall<HeliusHistoryPage>(httpUrl, "getTransactionsForAddress", [
         AGGREGATOR_PROGRAM_ID,
         {
            transactionDetails: "full",
            encoding: "base64",
            sortOrder: "asc",
            commitment: "confirmed",
            maxSupportedTransactionVersion: 1,
            limit: BACKFILL_PAGE_LIMIT,
            ...(paginationToken != null ? { paginationToken } : {}),
            filters: {
               status: "succeeded",
               slot: { gt: floor },
            },
         },
      ]);
      const rows = page.data ?? [];
      for (const row of rows) {
         const tx = chainTransactionFromHistoryRow(row);
         if (tx == null) {
            continue;
         }
         await indexTransaction(tx, rpc);
      }
      if (page.paginationToken == null || page.paginationToken === "" || rows.length === 0) {
         return;
      }
      if (page.paginationToken === paginationToken) {
         return;
      }
      paginationToken = page.paginationToken;
   }
}

async function backfillViaSignatures(rpc: Rpc<SolanaRpcApi>, floor: number): Promise<void> {
   const sigs: { signature: string; slot: bigint; err: unknown }[] = [];
   let before: Signature | null = null;
   let reachedFloor = false;
   while (!reachedFloor) {
      const page = await withRpcRetry(() =>
         rpc.getSignaturesForAddress(AGGREGATOR_PROGRAM_ID, {
            commitment: "confirmed",
            limit: 1000,
            ...(before != null ? { before } : {}),
         }).send(),
      );
      if (page.length === 0) {
         break;
      }
      for (const sig of page) {
         if (Number(sig.slot) <= floor) {
            reachedFloor = true;
            break;
         }
         sigs.push({ signature: sig.signature, slot: BigInt(sig.slot), err: sig.err });
      }
      before = page[page.length - 1]!.signature;
      if (page.length < 1000) {
         break;
      }
   }
   sigs.sort((a, b) => Number(a.slot - b.slot));
   for (const sig of sigs) {
      if (sig.err != null) {
         setIndexerWatermark(sig.signature, Number(sig.slot));
         continue;
      }
      await indexSignature(sig.signature, rpc);
   }
}

async function heliusCall<T>(httpUrl: string, method: string, params: unknown[]): Promise<T> {
   const response = await fetch(httpUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
   });
   const body = await response.json() as { result?: T; error?: { message?: string } };
   if (body.error != null) {
      throw new Error(body.error.message ?? "helius rpc error");
   }
   if (body.result == null) {
      throw new Error(`${method} returned no result`);
   }
   return body.result;
}

function chainTransactionFromHistoryRow(row: HeliusHistoryRow): ChainTransaction | null {
   const slot = row.slot == null ? null : BigInt(row.slot);
   if (slot == null) {
      return null;
   }
   const nested = row.transaction != null && typeof row.transaction === "object" && "meta" in (row.transaction as object)
      ? row.transaction as { transaction?: unknown; meta?: unknown }
      : null;
   const wire = asBase64Wire(nested?.transaction ?? row.transaction);
   const meta = nested?.meta ?? row.meta ?? null;
   const err = meta != null && typeof meta === "object" && "err" in meta ? (meta as { err: unknown }).err : null;
   let signature = row.signature ?? "";
   if (signature === "" && wire != null) {
      signature = signatureFromWire(wire);
   }
   if (signature === "") {
      return null;
   }
   return {
      signature,
      slot,
      blockTime: row.blockTime == null ? null : Number(row.blockTime),
      err,
      wire,
      meta,
   };
}

function chainTransactionFromNotification(result: unknown): ChainTransaction | null {
   if (result == null || typeof result !== "object") {
      return null;
   }
   const note = result as {
      signature?: string;
      slot?: number | string;
      transaction?: { transaction?: unknown; meta?: unknown };
   };
   if (note.signature == null || note.slot == null || note.transaction == null) {
      return null;
   }
   const wire = asBase64Wire(note.transaction.transaction);
   const meta = note.transaction.meta ?? null;
   const err = meta != null && typeof meta === "object" && "err" in meta ? (meta as { err: unknown }).err : null;
   return {
      signature: note.signature,
      slot: BigInt(note.slot),
      blockTime: null,
      err,
      wire,
      meta,
   };
}

function asBase64Wire(value: unknown): Base64EncodedDataResponse | null {
   if (Array.isArray(value) && typeof value[0] === "string") {
      return [value[0] as Base64EncodedBytes, "base64"];
   }
   if (value != null && typeof value === "object" && "transaction" in value) {
      return asBase64Wire((value as { transaction: unknown }).transaction);
   }
   return null;
}

function signatureFromWire(wire: Base64EncodedDataResponse): string {
   const bytes = new Uint8Array(Buffer.from(wire[0], "base64"));
   const decoded = txDecoder.decode(bytes);
   const first = Object.values(decoded.signatures)[0];
   if (first == null) {
      return "";
   }
   return base58Decoder.decode(first);
}

function parseAggregatorInstructions(wire: Base64EncodedDataResponse, meta: unknown): IndexedInstruction[] {
   const bytes = new Uint8Array(Buffer.from(wire[0], "base64"));
   const decodedTransaction = txDecoder.decode(bytes);
   const decodedMessage = msgDecoder.decode(decodedTransaction.messageBytes);
   const keys = fullAccountKeys(decodedMessage.staticAccounts, meta);
   const outers = outerInstructions(decodedMessage, keys);
   const inners = innerInstructionsByOuter(meta, keys);
   const parsed: IndexedInstruction[] = [];
   let exec = 0;
   for (let i = 0; i < outers.length; i++) {
      const outer = outers[i]!;
      if (outer != null && outer.programId === AGGREGATOR_PROGRAM_ID) {
         parsed.push({ ixIndex: exec, accounts: outer.accounts, data: outer.data });
      }
      exec++;
      for (const inner of inners.get(i) ?? []) {
         if (inner.programId === AGGREGATOR_PROGRAM_ID) {
            parsed.push({ ixIndex: exec, accounts: inner.accounts, data: inner.data });
         }
         exec++;
      }
   }
   return parsed;
}

type CompiledIx = {
   programId: Address;
   accounts: Address[];
   data: Uint8Array;
};

function fullAccountKeys(staticAccounts: readonly Address[], meta: unknown): Address[] {
   const keys: Address[] = [...staticAccounts];
   if (meta == null || typeof meta !== "object" || !("loadedAddresses" in meta)) {
      return keys;
   }
   const loaded = (meta as { loadedAddresses?: { writable?: readonly string[]; readonly?: readonly string[] } }).loadedAddresses;
   for (const key of loaded?.writable ?? []) {
      keys.push(address(key));
   }
   for (const key of loaded?.readonly ?? []) {
      keys.push(address(key));
   }
   return keys;
}

function outerInstructions(message: ReturnType<typeof msgDecoder.decode>, keys: readonly Address[]): (CompiledIx | null)[] {
   const outers: (CompiledIx | null)[] = [];
   if (message.version === 0 || message.version === "legacy") {
      for (const instruction of message.instructions) {
         outers.push(compileAccounts(keys, instruction.programAddressIndex, instruction.accountIndices, bytesOf(instruction.data)));
      }
      return outers;
   }
   if (message.version === 1) {
      for (let i = 0; i < message.instructionHeaders.length; i++) {
         const header = message.instructionHeaders[i]!;
         const payload = message.instructionPayloads[i]!;
         outers.push(compileAccounts(
            keys,
            header.programAccountIndex,
            payload.instructionAccountIndices,
            bytesOf(payload.instructionData),
         ));
      }
   }
   return outers;
}

function innerInstructionsByOuter(meta: unknown, keys: readonly Address[]): Map<number, CompiledIx[]> {
   const grouped = new Map<number, CompiledIx[]>();
   if (meta == null || typeof meta !== "object" || !("innerInstructions" in meta)) {
      return grouped;
   }
   const innerInstructions = (meta as { innerInstructions?: unknown }).innerInstructions;
   if (!Array.isArray(innerInstructions)) {
      return grouped;
   }
   for (const group of innerInstructions) {
      if (group == null || typeof group !== "object") {
         continue;
      }
      const index = (group as { index?: unknown }).index;
      const instructions = (group as { instructions?: unknown }).instructions;
      if (typeof index !== "number" || !Array.isArray(instructions)) {
         continue;
      }
      const compiled: CompiledIx[] = [];
      for (const instruction of instructions) {
         if (instruction == null || typeof instruction !== "object") {
            continue;
         }
         const row = instruction as { programIdIndex?: unknown; accounts?: unknown; accountIndices?: unknown; data?: unknown };
         const programIndex = row.programIdIndex;
         const accountIndexes = Array.isArray(row.accounts) ? row.accounts : row.accountIndices;
         if (typeof programIndex !== "number" || !Array.isArray(accountIndexes)) {
            continue;
         }
         const ix = compileAccounts(keys, programIndex, accountIndexes as number[], decodeIxData(row.data));
         if (ix != null) {
            compiled.push(ix);
         }
      }
      grouped.set(index, compiled);
   }
   return grouped;
}

function compileAccounts(
   keys: readonly Address[],
   programIndex: number,
   accountIndexes: readonly number[] | undefined,
   data: Uint8Array,
): CompiledIx | null {
   const programId = keys[programIndex];
   if (programId == null || accountIndexes == null) {
      return null;
   }
   const accounts: Address[] = [];
   for (const index of accountIndexes) {
      const key = keys[index];
      if (key == null) {
         return null;
      }
      accounts.push(key);
   }
   return { programId, accounts, data };
}

function bytesOf(data: { length: number; [index: number]: number } | undefined): Uint8Array {
   if (data == null) {
      return new Uint8Array();
   }
   return data instanceof Uint8Array ? data : Uint8Array.from(data);
}

function decodeIxData(data: unknown): Uint8Array {
   if (data instanceof Uint8Array) {
      return data;
   }
   if (typeof data !== "string" || data.length === 0) {
      return new Uint8Array();
   }
   return new Uint8Array(base58Encoder.encode(data));
}

let workTail: Promise<void> = Promise.resolve();

function enqueue(job: () => Promise<void>): void {
   workTail = workTail.then(job).catch((error) => {
      console.error("indexer job failed:", error);
   });
}

async function runListener(clients: RpcClients): Promise<void> {
   const wsUrl = heliusWsUrl(clients.httpUrl);
   for (;;) {
      try {
         await runHeliusSession(wsUrl, clients.rpc);
      } catch (error) {
         console.error("Helius transactionSubscribe unavailable, using logsSubscribe:", error);
         try {
            await runLogsSession(clients.rpcSubscriptions, clients.rpc);
         } catch (logsError) {
            console.error("logsSubscribe failed:", logsError);
         }
      }
      await sleep(RECONNECT_MS);
   }
}

function runHeliusSession(wsUrl: string, rpc: Rpc<SolanaRpcApi>): Promise<void> {
   return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let subscribed = false;
      let settled = false;
      let subscribeTimer: ReturnType<typeof setTimeout>;
      const timer = setInterval(() => {
         if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: "keepalive", method: "getSlot" }));
         }
      }, KEEPALIVE_MS);
      const fail = (error: unknown) => {
         if (settled) {
            return;
         }
         settled = true;
         clearTimeout(subscribeTimer);
         clearInterval(timer);
         ws.close();
         reject(error instanceof Error ? error : new Error("helius websocket failed"));
      };
      const finish = () => {
         if (settled) {
            return;
         }
         settled = true;
         clearTimeout(subscribeTimer);
         clearInterval(timer);
         resolve();
      };
      subscribeTimer = setTimeout(() => {
         fail(new Error("transactionSubscribe timed out"));
      }, 15_000);
      ws.addEventListener("open", () => {
         console.log("Helius transactionSubscribe connecting", wsUrl);
         ws.send(JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "transactionSubscribe",
            params: [
               {
                  failed: false,
                  vote: false,
                  accountInclude: [AGGREGATOR_PROGRAM_ID],
               },
               {
                  commitment: "confirmed",
                  encoding: "base64",
                  transactionDetails: "full",
                  maxSupportedTransactionVersion: 1,
               },
            ],
         }));
      });
      ws.addEventListener("message", (ev) => {
         let msg: { id?: unknown; error?: { message?: string }; result?: unknown; method?: string; params?: { result?: unknown } };
         try {
            msg = JSON.parse(String(ev.data)) as typeof msg;
         } catch {
            return;
         }
         if (msg.id === 1) {
            if (msg.error != null) {
               fail(new Error(msg.error.message ?? "transactionSubscribe rejected"));
               return;
            }
            subscribed = true;
            clearTimeout(subscribeTimer);
            console.log("Helius transactionSubscribe active", msg.result);
            return;
         }
         if (msg.method !== "transactionNotification") {
            return;
         }
         const tx = chainTransactionFromNotification(msg.params?.result);
         if (tx == null) {
            return;
         }
         enqueue(() => indexTransaction(tx, rpc));
      });
      ws.addEventListener("error", () => {
         if (!subscribed) {
            fail(new Error("helius websocket error"));
         }
      });
      ws.addEventListener("close", () => {
         if (!subscribed) {
            fail(new Error("helius websocket closed before subscribe"));
            return;
         }
         console.log("Helius websocket closed");
         finish();
      });
   });
}

async function runLogsSession(
   rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
   rpc: Rpc<SolanaRpcApi>,
): Promise<void> {
   console.log("logsSubscribe on", AGGREGATOR_PROGRAM_ID);
   const abort = new AbortController();
   const notifications = await rpcSubscriptions
      .logsNotifications({ mentions: [AGGREGATOR_PROGRAM_ID] }, { commitment: "confirmed" })
      .subscribe({ abortSignal: abort.signal });
   for await (const note of notifications) {
      if (note.value.err != null) {
         continue;
      }
      const signature = note.value.signature;
      enqueue(() => indexSignature(signature, rpc));
   }
}

async function main(): Promise<void> {
   const httpUrl = requireHeliusHttpUrl();
   const clients = createRpcClients({ httpUrl });
   sharedRpc = clients.rpc;
   const backfillOnly = process.argv.includes("--backfill-only");
   const fullBackfill = process.argv.includes("--backfill") || backfillOnly;
   if (backfillOnly) {
      await backfillProgramHistory(undefined, clients.rpc);
      return;
   }
   const watermark = fullBackfill ? null : getIndexerWatermark();
   enqueue(async () => {
      if (watermark == null) {
         console.log("backfill from slot", V1_FROM_SLOT.toString());
         await backfillProgramHistory(undefined, clients.rpc);
         return;
      }
      console.log("catch up after slot", watermark.slot);
      await backfillProgramHistory({ afterSlot: watermark.slot }, clients.rpc);
   });
   setInterval(() => {
      enqueue(() => retryUnresolvedV1(clients.rpc));
   }, RETRY_UNRESOLVED_MS);
   await runListener(clients);
}

if (import.meta.main === true) {
   main().catch((error) => {
      console.error(error);
      process.exit(1);
   });
}
