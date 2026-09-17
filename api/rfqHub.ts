/**
 * RFQ hub: MM WebSocket registry + fan-out / 2s collect for POST `/api/rfq`.
 *
 * MM sockets must pass `mm.hello` auth: recent timestamp + on-chain RFQ signer + ed25519 verify.
 */

import { randomUUID } from 'node:crypto';
import type { ServerWebSocket } from 'bun';
import {
   MM_ACCOUNT_CONFIG_DISCRIMINATOR,
   MM_HELLO_AUTH_MAX_AGE_SECS,
   RFQ_COLLECT_TIMEOUT_MS,
   SYSTEM_PROGRAM_ID,
   buildRfqWsRequestMessage,
   cashoutQuoteJsonFromWsMessage,
   cashoutWsRequestFromHttp,
   getMmAccountConfigData,
   getMmListData,
   parseRfqWsCashoutQuoteMessage,
   parseRfqWsHelloMessage,
   parseRfqWsQuoteMessage,
   quoteJsonFromWsMessage,
   verifyMmHelloAuth,
   type RfqCashoutHttpRequestJson,
   type RfqCashoutHttpResponseJson,
   type RfqCashoutQuoteJson,
   type RfqHttpRequestJson,
   type RfqHttpResponseJson,
   type RfqQuoteJson,
   type RfqWsClientMessage,
   type RfqWsHelloMessage,
} from 'spamm-aggregator-sdk';
import { createRpcClients, type RpcClients } from '../aggregator/client/txSend';
import { address, type Rpc, type SolanaRpcApi } from '@solana/kit';

/** TTL for cached RPC results (mm_list, per-MM config). */
const RPC_CACHE_TTL_MS = 10 * 60 * 1000;

/** Reject a `mm.hello` payload reuse within double the auth window (replay protection). */
const MM_HELLO_REPLAY_TTL_MS = MM_HELLO_AUTH_MAX_AGE_SECS * 2 * 1000;

/** Close a socket after this many protocol errors (invalid JSON, bad auth, malformed quotes, ...). */
const MAX_SOCKET_ERRORS = 5;

export type MmWsData = {
   /** Set after a valid `mm.hello`. */
   mmProgramId: string | null;
   /** Set after a valid `mm.hello`. */
   rfqSigner: string | null;
   /** Set in `onClose` so an in-flight `handleHello` can stop before registering. */
   closed: boolean;
   /** Set while a `mm.hello` auth is in flight (prevents concurrent RPC hammering). */
   helloInFlight: boolean;
   /** Protocol error counter; socket is closed at {@link MAX_SOCKET_ERRORS}. */
   errorCount: number;
};

type Cached<T> = { data: T; expiresAt: number };
type MmListData = Awaited<ReturnType<typeof getMmListData>>;
type MmAccountConfigData = Awaited<ReturnType<typeof getMmAccountConfigData>>;

type PendingRfq = {
   requestId: string;
   selectionCount: number;
   quotes: RfqQuoteJson[];
   replied: Set<string>;
   expected: Set<string>;
   /** Sockets the fan-out payload was successfully sent to (reported as `mmCount`). */
   fannedOut: number;
   settle: (response: RfqHttpResponseJson) => void;
   timer: ReturnType<typeof setTimeout>;
};

type PendingCashout = {
   requestId: string;
   quotes: RfqCashoutQuoteJson[];
   replied: Set<string>;
   expected: Set<string>;
   fannedOut: number;
   settle: (response: RfqCashoutHttpResponseJson) => void;
   timer: ReturnType<typeof setTimeout>;
};

function parseWsJson(message: string | Buffer): unknown {
   const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
   return JSON.parse(text) as unknown;
}

export class RfqHub {
   /** mmProgramId → socket (one connection per MM program). */
   private readonly mms = new Map<string, ServerWebSocket<MmWsData>>();
   private readonly pending = new Map<string, PendingRfq>();
   private readonly pendingCashout = new Map<string, PendingCashout>();
   private readonly rpc: Rpc<SolanaRpcApi>;
   /** mm_list cache to keep hello auth off the RPC hot path. */
   private mmListCache: Cached<MmListData> | null = null;
   /** Per-MM config cache (keyed by MM program id). */
   private readonly configCache = new Map<string, Cached<MmAccountConfigData>>();
   /** hello signature → expiry (ms epoch); replay protection. */
   private readonly recentHellos = new Map<string, number>();

   constructor(rpc?: Rpc<SolanaRpcApi>) {
      this.rpc = (rpc ?? createRpcClients({
         httpUrl: process.env.HELIUS_RPC_URL,
      }).rpc);
   }

   connectedMmCount(): number {
      return this.mms.size;
   }

   onOpen(ws: ServerWebSocket<MmWsData>): void {
      ws.data.mmProgramId = null;
      ws.data.rfqSigner = null;
      ws.data.closed = false;
      ws.data.helloInFlight = false;
      ws.data.errorCount = 0;
   }

   onClose(ws: ServerWebSocket<MmWsData>): void {
      ws.data.closed = true;
      const id = ws.data.mmProgramId;
      if (id != null && this.mms.get(id) === ws) {
         this.mms.delete(id);
      }
      if (id == null) {
         return;
      }
      // MM disconnected mid-collect: drop it from every in-flight request and
      // finish early once all remaining MMs have replied.
      for (const pending of this.pending.values()) {
         if (!pending.expected.delete(id)) {
            continue;
         }
         if (pending.replied.size >= pending.expected.size) {
            this.finishPending(pending, false);
         }
      }
      for (const pending of this.pendingCashout.values()) {
         if (!pending.expected.delete(id)) {
            continue;
         }
         if (pending.replied.size >= pending.expected.size) {
            this.finishPendingCashout(pending, false);
         }
      }
   }

   /** Send a protocol error and close the socket once it repeats too many times. */
   private sendError(ws: ServerWebSocket<MmWsData>, error: string): void {
      ws.data.errorCount++;
      try {
         ws.send(JSON.stringify({ type: 'error', error }));
      } catch {
         // ignore
      }
      if (ws.data.errorCount >= MAX_SOCKET_ERRORS) {
         try {
            ws.close(1008, 'too many protocol errors');
         } catch {
            // ignore
         }
      }
   }

   onMessage(ws: ServerWebSocket<MmWsData>, message: string | Buffer): void {
      let raw: unknown;
      try {
         raw = parseWsJson(message);
      } catch {
         this.sendError(ws, 'invalid JSON');
         return;
      }

      if (typeof raw !== 'object' || raw === null || !('type' in raw)) {
         this.sendError(ws, 'missing type');
         return;
      }

      const type = (raw as RfqWsClientMessage).type;
      if (type === 'mm.hello') {
         if (ws.data.helloInFlight) {
            this.sendError(ws, 'mm.hello already in progress');
            return;
         }
         ws.data.helloInFlight = true;
         void this.handleHello(ws, raw)
            .catch((e) => {
               const msg = e instanceof Error ? e.message : String(e);
               this.sendError(ws, msg);
            })
            .finally(() => {
               ws.data.helloInFlight = false;
            });
         return;
      }
      try {
         if (type === 'rfq.quote') {
            this.handleQuote(ws, parseRfqWsQuoteMessage(raw));
            return;
         }
         if (type === 'rfq.cashout.quote') {
            this.handleCashoutQuote(ws, parseRfqWsCashoutQuoteMessage(raw));
            return;
         }
         this.sendError(ws, `unknown type: ${String(type)}`);
      } catch (e) {
         const msg = e instanceof Error ? e.message : String(e);
         this.sendError(ws, msg);
      }
   }

   private async handleHello(ws: ServerWebSocket<MmWsData>, raw: unknown): Promise<void> {
      const hello = parseRfqWsHelloMessage(raw);
      this.assertHelloNotReplayed(hello);
      await this.authenticateHello(hello);

      if (ws.data.closed) {
         // Socket died while the auth RPC calls were in flight; nothing to register.
         return;
      }
      this.rememberHello(hello);

      const prev = ws.data.mmProgramId;
      if (prev != null && prev !== hello.mmProgramId && this.mms.get(prev) === ws) {
         this.mms.delete(prev);
      }
      const existing = this.mms.get(hello.mmProgramId);
      if (existing != null && existing !== ws) {
         try {
            existing.close(4000, 'replaced by new connection');
         } catch {
            // ignore
         }
      }
      ws.data.mmProgramId = hello.mmProgramId;
      ws.data.rfqSigner = hello.rfqSigner;
      this.mms.set(hello.mmProgramId, ws);
      ws.send(
         JSON.stringify({
            type: 'mm.hello.ack',
            mmProgramId: hello.mmProgramId,
            rfqSigner: hello.rfqSigner,
         }),
      );
   }

   private async authenticateHello(hello: RfqWsHelloMessage): Promise<void> {
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - hello.timestamp) > MM_HELLO_AUTH_MAX_AGE_SECS) {
         throw new Error(
            `hello timestamp too old (|Δ|=${Math.abs(now - hello.timestamp)}s; max ${MM_HELLO_AUTH_MAX_AGE_SECS}s)`,
         );
      }

      const mmProgramId = address(hello.mmProgramId);
      const claimedRfqSigner = address(hello.rfqSigner);

      const mmList = await this.getMmListCached();
      if (!mmList.mmProgramAddresses.includes(mmProgramId)) {
         throw new Error('mmProgramId is not registered on the aggregator mm_list');
      }

      let config;
      try {
         config = await this.getMmConfigCached(mmProgramId);
      } catch {
         throw new Error('MM config account not found (not an initialized MM program)');
      }
      if (config.discriminator !== MM_ACCOUNT_CONFIG_DISCRIMINATOR) {
         throw new Error('invalid MM config discriminator');
      }
      if (config.rfqSigner === SYSTEM_PROGRAM_ID) {
         throw new Error('MM rfqSigner is unset');
      }
      if (config.rfqSigner !== claimedRfqSigner) {
         throw new Error(
            `rfqSigner mismatch: claimed=${claimedRfqSigner} on-chain=${config.rfqSigner}`,
         );
      }

      const ok = await verifyMmHelloAuth(hello);
      if (!ok) {
         throw new Error('invalid mm.hello signature');
      }
   }

   private async getMmListCached(): Promise<MmListData> {
      const cached = this.mmListCache;
      if (cached != null && cached.expiresAt > Date.now()) {
         return cached.data;
      }
      const data = await getMmListData(this.rpc);
      this.mmListCache = { data, expiresAt: Date.now() + RPC_CACHE_TTL_MS };
      return data;
   }

   private async getMmConfigCached(mmProgramId: string): Promise<MmAccountConfigData> {
      const cached = this.configCache.get(mmProgramId);
      if (cached != null && cached.expiresAt > Date.now()) {
         return cached.data;
      }
      const data = await getMmAccountConfigData(this.rpc, address(mmProgramId));
      this.configCache.set(mmProgramId, { data, expiresAt: Date.now() + RPC_CACHE_TTL_MS });
      return data;
   }

   /** Reject a captured hello being replayed on a fresh socket (slot-hijack). */
   private assertHelloNotReplayed(hello: RfqWsHelloMessage): void {
      const nowMs = Date.now();
      for (const [sig, expiresAt] of this.recentHellos) {
         if (expiresAt <= nowMs) {
            this.recentHellos.delete(sig);
         }
      }
      if (this.recentHellos.has(hello.signature)) {
         throw new Error('hello replay detected (mm.hello payload already used)');
      }
   }

   private rememberHello(hello: RfqWsHelloMessage): void {
      this.recentHellos.set(hello.signature, Date.now() + MM_HELLO_REPLAY_TTL_MS);
   }

   private handleQuote(
      ws: ServerWebSocket<MmWsData>,
      quote: ReturnType<typeof parseRfqWsQuoteMessage>,
   ): void {
      const registered = ws.data.mmProgramId;
      if (registered == null) {
         ws.send(JSON.stringify({ type: 'error', error: 'send mm.hello first' }));
         return;
      }
      if (quote.mmProgramId !== registered) {
         ws.send(JSON.stringify({ type: 'error', error: 'mmProgramId does not match hello' }));
         return;
      }

      const pending = this.pending.get(quote.requestId);
      if (pending == null) {
         return;
      }
      if (!pending.expected.has(quote.mmProgramId)) {
         return;
      }
      if (pending.replied.has(quote.mmProgramId)) {
         return;
      }
      if (
         BigInt(quote.maxStake) <= 0n ||
         BigInt(quote.oddsScaled) <= 0n ||
         quote.legOddsScaled.some((v) => BigInt(v) < 0n)
      ) {
         this.sendError(ws, 'maxStake, oddsScaled and legOddsScaled must be positive');
         return;
      }
      if (quote.legOddsScaled.length !== pending.selectionCount) {
         this.sendError(ws, `legOddsScaled.length must be ${pending.selectionCount}`);
         return;
      }

      pending.replied.add(quote.mmProgramId);
      pending.quotes.push(quoteJsonFromWsMessage(quote));

      if (pending.replied.size >= pending.expected.size) {
         this.finishPending(pending, false);
      }
   }

   /**
    * Fan out to all connected MMs, wait up to {@link RFQ_COLLECT_TIMEOUT_MS},
    * return whatever quotes arrived.
    */
   async collectQuotes(body: RfqHttpRequestJson): Promise<RfqHttpResponseJson> {
      const requestId = randomUUID();
      const expected = new Set(this.mms.keys());
      const mmCount = expected.size;

      if (mmCount === 0) {
         return {
            requestId,
            quotes: [],
            timedOut: false,
            mmCount: 0,
         };
      }

      const wsPayload = JSON.stringify(buildRfqWsRequestMessage(requestId, body));

      const response = await new Promise<RfqHttpResponseJson>((resolve) => {
         const pending: PendingRfq = {
            requestId,
            selectionCount: body.selections.length,
            quotes: [],
            replied: new Set(),
            expected,
            fannedOut: 0,
            settle: resolve,
            timer: setTimeout(() => {
               this.finishPending(pending, true);
            }, RFQ_COLLECT_TIMEOUT_MS),
         };
         this.pending.set(requestId, pending);

         for (const mmProgramId of expected) {
            const sock = this.mms.get(mmProgramId);
            if (sock == null) {
               continue;
            }
            try {
               sock.send(wsPayload);
               pending.fannedOut++;
            } catch {
               // treat as non-reply; timeout / other MMs still apply
            }
         }

         if (pending.fannedOut === 0) {
            // Nobody received the request; return immediately instead of waiting.
            this.finishPending(pending, false);
         }
      });

      return response;
   }

   async collectCashoutQuotes(body: RfqCashoutHttpRequestJson): Promise<RfqCashoutHttpResponseJson> {
      const requestId = randomUUID();
      const expected = new Set(this.mms.keys());
      const mmCount = expected.size;

      if (mmCount === 0) {
         return {
            requestId,
            quotes: [],
            timedOut: false,
            mmCount: 0,
         };
      }

      const wsPayload = JSON.stringify(cashoutWsRequestFromHttp(requestId, body));

      const response = await new Promise<RfqCashoutHttpResponseJson>((resolve) => {
         const pending: PendingCashout = {
            requestId,
            quotes: [],
            replied: new Set(),
            expected,
            fannedOut: 0,
            settle: resolve,
            timer: setTimeout(() => {
               this.finishPendingCashout(pending, true);
            }, RFQ_COLLECT_TIMEOUT_MS),
         };
         this.pendingCashout.set(requestId, pending);

         for (const mmProgramId of expected) {
            const sock = this.mms.get(mmProgramId);
            if (sock == null) {
               continue;
            }
            try {
               sock.send(wsPayload);
               pending.fannedOut++;
            } catch {
               // treat as non-reply; timeout / other MMs still apply
            }
         }

         if (pending.fannedOut === 0) {
            this.finishPendingCashout(pending, false);
         }
      });

      return response;
   }

   private handleCashoutQuote(
      ws: ServerWebSocket<MmWsData>,
      quote: ReturnType<typeof parseRfqWsCashoutQuoteMessage>,
   ): void {
      const registered = ws.data.mmProgramId;
      if (registered == null) {
         ws.send(JSON.stringify({ type: 'error', error: 'send mm.hello first' }));
         return;
      }
      if (quote.mmProgramId !== registered) {
         ws.send(JSON.stringify({ type: 'error', error: 'mmProgramId does not match hello' }));
         return;
      }

      const pending = this.pendingCashout.get(quote.requestId);
      if (pending == null) {
         return;
      }
      if (!pending.expected.has(quote.mmProgramId)) {
         return;
      }
      if (pending.replied.has(quote.mmProgramId)) {
         return;
      }
      if (BigInt(quote.maxPayment) <= 0n) {
         this.sendError(ws, 'maxPayment must be positive');
         return;
      }

      pending.replied.add(quote.mmProgramId);
      pending.quotes.push(cashoutQuoteJsonFromWsMessage(quote));

      if (pending.replied.size >= pending.expected.size) {
         this.finishPendingCashout(pending, false);
      }
   }

   private finishPendingCashout(pending: PendingCashout, timedOut: boolean): void {
      if (!this.pendingCashout.has(pending.requestId)) {
         return;
      }
      this.pendingCashout.delete(pending.requestId);
      clearTimeout(pending.timer);
      pending.settle({
         requestId: pending.requestId,
         quotes: pending.quotes,
         timedOut,
         mmCount: pending.fannedOut,
      });
   }

   private finishPending(pending: PendingRfq, timedOut: boolean): void {
      if (!this.pending.has(pending.requestId)) {
         return;
      }
      this.pending.delete(pending.requestId);
      clearTimeout(pending.timer);
      pending.settle({
         requestId: pending.requestId,
         quotes: pending.quotes,
         timedOut,
         mmCount: pending.fannedOut,
      });
   }
}

/** Process-wide hub (one API process → one MM connection set). */
export const rfqHub = new RfqHub();
