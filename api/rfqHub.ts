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
   getMmAccountConfigData,
   getMmListData,
   parseRfqWsHelloMessage,
   parseRfqWsQuoteMessage,
   quoteJsonFromWsMessage,
   verifyMmHelloAuth,
   type RfqHttpRequestJson,
   type RfqHttpResponseJson,
   type RfqQuoteJson,
   type RfqWsClientMessage,
   type RfqWsHelloMessage,
} from 'spamm-aggregator-sdk';
import { createRpcClients, type RpcClients } from '../aggregator/client/txSend';
import { address } from '@solana/kit';

export type MmWsData = {
   /** Set after a valid `mm.hello`. */
   mmProgramId: string | null;
   /** Set after a valid `mm.hello`. */
   rfqSigner: string | null;
};

type PendingRfq = {
   requestId: string;
   selectionCount: number;
   quotes: RfqQuoteJson[];
   replied: Set<string>;
   expected: Set<string>;
   timedOut: boolean;
   settle: (response: RfqHttpResponseJson) => void;
   timer: ReturnType<typeof setTimeout>;
};

/** RPC type expected by SDK readers (avoid duplicate `@solana/kit` identity clashes). */
type SdkRpc = Parameters<typeof getMmListData>[0];

function parseWsJson(message: string | Buffer): unknown {
   const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
   return JSON.parse(text) as unknown;
}

export class RfqHub {
   /** mmProgramId → socket (one connection per MM program). */
   private readonly mms = new Map<string, ServerWebSocket<MmWsData>>();
   private readonly pending = new Map<string, PendingRfq>();
   private readonly rpc: SdkRpc;

   constructor(rpc?: RpcClients['rpc'] | SdkRpc) {
      this.rpc = (rpc ?? createRpcClients().rpc) as SdkRpc;
   }

   connectedMmCount(): number {
      return this.mms.size;
   }

   onOpen(ws: ServerWebSocket<MmWsData>): void {
      ws.data.mmProgramId = null;
      ws.data.rfqSigner = null;
   }

   onClose(ws: ServerWebSocket<MmWsData>): void {
      const id = ws.data.mmProgramId;
      if (id != null && this.mms.get(id) === ws) {
         this.mms.delete(id);
      }
   }

   onMessage(ws: ServerWebSocket<MmWsData>, message: string | Buffer): void {
      let raw: unknown;
      try {
         raw = parseWsJson(message);
      } catch {
         ws.send(JSON.stringify({ type: 'error', error: 'invalid JSON' }));
         return;
      }

      if (typeof raw !== 'object' || raw === null || !('type' in raw)) {
         ws.send(JSON.stringify({ type: 'error', error: 'missing type' }));
         return;
      }

      const type = (raw as RfqWsClientMessage).type;
      if (type === 'mm.hello') {
         void this.handleHello(ws, raw).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            try {
               ws.send(JSON.stringify({ type: 'error', error: msg }));
            } catch {
               // ignore
            }
         });
         return;
      }
      try {
         if (type === 'rfq.quote') {
            this.handleQuote(ws, parseRfqWsQuoteMessage(raw));
            return;
         }
         ws.send(JSON.stringify({ type: 'error', error: `unknown type: ${String(type)}` }));
      } catch (e) {
         const msg = e instanceof Error ? e.message : String(e);
         ws.send(JSON.stringify({ type: 'error', error: msg }));
      }
   }

   private async handleHello(ws: ServerWebSocket<MmWsData>, raw: unknown): Promise<void> {
      const hello = parseRfqWsHelloMessage(raw);
      await this.authenticateHello(hello);

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
            `hello timestamp too old/skewed (|Δ|=${Math.abs(now - hello.timestamp)}s; max ${MM_HELLO_AUTH_MAX_AGE_SECS}s)`,
         );
      }

      const mmProgramId = address(hello.mmProgramId);
      const claimedRfqSigner = address(hello.rfqSigner);

      const mmList = await getMmListData(this.rpc);
      if (!mmList.mmProgramAddresses.includes(mmProgramId)) {
         throw new Error('mmProgramId is not registered on the aggregator mm_list');
      }

      let config;
      try {
         config = await getMmAccountConfigData(this.rpc, mmProgramId);
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
      if (pending == null || pending.timedOut) {
         return;
      }
      if (!pending.expected.has(quote.mmProgramId)) {
         return;
      }
      if (pending.replied.has(quote.mmProgramId)) {
         return;
      }
      if (quote.legOddsScaled.length !== pending.selectionCount) {
         ws.send(
            JSON.stringify({
               type: 'error',
               error: `legOddsScaled.length must be ${pending.selectionCount}`,
            }),
         );
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
            timedOut: false,
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
            } catch {
               // treat as non-reply; timeout / other MMs still apply
            }
         }
      });

      return response;
   }

   private finishPending(pending: PendingRfq, timedOut: boolean): void {
      if (!this.pending.has(pending.requestId)) {
         return;
      }
      this.pending.delete(pending.requestId);
      clearTimeout(pending.timer);
      pending.timedOut = timedOut;
      pending.settle({
         requestId: pending.requestId,
         quotes: pending.quotes,
         timedOut,
         mmCount: pending.expected.size,
      });
   }
}

/** Process-wide hub (one API process → one MM connection set). */
export const rfqHub = new RfqHub();
