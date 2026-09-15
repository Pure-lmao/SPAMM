import { sleep } from "bun";
import { address } from "@solana/kit";
import {
   encodeRfqSignatureBase64,
   marketIdFromJson,
   productParlayOdds,
   RFQ_MM_WS_PATH,
   RFQ_NETWORK_DOMAIN,
   signMmHelloAuth,
   signRfqBetQuote,
   signRfqParlayQuote,
   type RfqWsCashoutRequestMessage,
   type RfqWsRequestMessage,
} from "spamm-aggregator-sdk";
import { getMmConfigData, getMmMarketData, MARKET_MAKER_PROGRAM_ID, ODDS_SCALE } from "spamm-market-maker-sdk";
import { ADMIN_SIGNER } from "../client/admin";
import { createRpcClients, withRpcRetry } from "../../aggregator/client/txSendV1";

const OFFER_TTL_SECS = 30;
const RECONNECT_MS = 2000;
const HELLO_TIMEOUT_MS = 10_000;
const MM_PROGRAM = MARKET_MAKER_PROGRAM_ID;
const RFQ_SIGNER = ADMIN_SIGNER;

function rfqWsUrl(): string {
   if (process.env.RFQ_WS_URL) {
      return process.env.RFQ_WS_URL;
   }
   const port = process.env.PORT ?? "8787";
   return `ws://127.0.0.1:${port}${RFQ_MM_WS_PATH}`;
}

function oddsForSide(odds0: bigint, odds1: bigint, odds2: bigint, side: number): bigint {
   if (side === 0) return odds0;
   if (side === 1) return odds1;
   return odds2;
}

async function main() {
   const clients = createRpcClients({
      httpUrl: process.env.SOLANA_RPC_URL,
      wsUrl: process.env.SOLANA_WS_URL,
   });
   const cfg = await withRpcRetry(() => getMmConfigData(clients.rpc, MM_PROGRAM));
   if (cfg.rfqSigner !== RFQ_SIGNER.address) {
      throw new Error(
         `rfqSigner mismatch: keypair=${RFQ_SIGNER.address} on-chain=${cfg.rfqSigner} (run set_rfq_signer)`,
      );
   }
   console.log("RFQ signer ok:", RFQ_SIGNER.address);

   const url = rfqWsUrl();
   for (;;) {
      try {
         await runSession(clients, url);
      } catch (error) {
         console.error("RFQ session ended:", error);
      }
      console.log(`reconnect in ${RECONNECT_MS}ms`);
      await sleep(RECONNECT_MS);
   }
}

async function runSession(
   clients: ReturnType<typeof createRpcClients>,
   url: string,
): Promise<void> {
   console.log("connecting", url);
   const ws = new WebSocket(url);
   await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", (ev) => reject(ev), { once: true });
   });

   const hello = await signMmHelloAuth(RFQ_SIGNER, { mmProgramId: MM_PROGRAM });
   ws.send(JSON.stringify(hello));

   await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
         ws.close();
         reject(new Error("hello timeout"));
      }, HELLO_TIMEOUT_MS);
      const onMessage = (ev: MessageEvent) => {
         let raw: unknown;
         try {
            raw = JSON.parse(String(ev.data));
         } catch {
            return;
         }
         if (typeof raw !== "object" || raw === null || !("type" in raw)) {
            return;
         }
         const type = (raw as { type: string }).type;
         if (type === "mm.hello.ack") {
            clearTimeout(timeout);
            ws.removeEventListener("message", onMessage);
            resolve();
            return;
         }
         if (type === "error") {
            clearTimeout(timeout);
            ws.removeEventListener("message", onMessage);
            reject(new Error(String((raw as { error?: string }).error ?? "hello error")));
         }
      };
      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", () => {
         clearTimeout(timeout);
         reject(new Error("socket closed before hello.ack"));
      }, { once: true });
   });
   console.log("RFQ hello ack; listening for bets");

   await new Promise<void>((resolve) => {
      ws.addEventListener("close", () => resolve(), { once: true });
      ws.addEventListener("message", (ev) => {
         void handleMessage(ws, clients, ev.data).catch((error) => {
            console.error("quote failed:", error);
         });
      });
   });
}

async function handleMessage(
   ws: WebSocket,
   clients: ReturnType<typeof createRpcClients>,
   data: unknown,
): Promise<void> {
   let raw: unknown;
   try {
      raw = JSON.parse(String(data));
   } catch {
      console.error("invalid JSON from hub");
      return;
   }
   if (typeof raw !== "object" || raw === null || !("type" in raw)) {
      return;
   }
   const type = (raw as { type: string }).type;
   if (type === "error") {
      console.error("hub error:", (raw as { error?: string }).error);
      return;
   }
   if (type === "rfq.cashout.request") {
      const req = raw as RfqWsCashoutRequestMessage;
      console.log("skip cashout rfq", req.requestId);
      return;
   }
   if (type !== "rfq.request") {
      return;
   }
   const req = raw as RfqWsRequestMessage;
   await quoteBet(ws, clients, req);
}

async function quoteBet(
   ws: WebSocket,
   clients: ReturnType<typeof createRpcClients>,
   req: RfqWsRequestMessage,
): Promise<void> {
   const offerExpiry = Math.floor(Date.now() / 1000) + OFFER_TTL_SECS;
   const user = address(req.user);
   const betId = BigInt(req.betId);
   const amount = BigInt(req.amount);
   const maxStake = amount;

   const legs = await Promise.all(req.selections.map(async (sel) => {
      const marketId = marketIdFromJson(sel.marketId);
      const market = await withRpcRetry(() =>
         getMmMarketData(clients.rpc, MM_PROGRAM, marketId),
      );
      const oddsScaled = oddsForSide(market.odds0, market.odds1, market.odds2, sel.side);
      if (oddsScaled <= ODDS_SCALE) {
         throw new Error(`no live odds for mkt=${marketId.mkt} side=${sel.side}`);
      }
      return {
         marketId,
         side: sel.side,
         eventStateSequence: sel.eventStateSequence,
         eventGameState: sel.eventGameState,
         oddsScaled,
      };
   }));

   if (legs.length === 1) {
      const leg = legs[0]!;
      const signed = await signRfqBetQuote(RFQ_SIGNER, {
         networkDomain: RFQ_NETWORK_DOMAIN,
         user,
         betId,
         marketId: leg.marketId,
         eventGameState: leg.eventGameState,
         eventStateSequence: leg.eventStateSequence,
         side: leg.side,
         maxStake,
         oddsScaled: leg.oddsScaled,
         offerExpiry,
         mmProgramId: MM_PROGRAM,
      });
      ws.send(JSON.stringify({
         type: "rfq.quote",
         requestId: req.requestId,
         mmProgramId: MM_PROGRAM,
         maxStake: maxStake.toString(),
         oddsScaled: signed.offer.oddsScaled.toString(),
         offerExpiry,
         signature: encodeRfqSignatureBase64(signed.signature),
         legOddsScaled: [signed.offer.oddsScaled.toString()],
      }));
      console.log("quoted bet", req.requestId, signed.offer.oddsScaled.toString());
      return;
   }

   const oddsScaled = productParlayOdds(legs);
   const signed = await signRfqParlayQuote(RFQ_SIGNER, {
      networkDomain: RFQ_NETWORK_DOMAIN,
      user,
      betId,
      maxStake,
      oddsScaled,
      offerExpiry,
      mmProgramId: MM_PROGRAM,
      numLegs: legs.length,
      legs,
   });
   ws.send(JSON.stringify({
      type: "rfq.quote",
      requestId: req.requestId,
      mmProgramId: MM_PROGRAM,
      maxStake: maxStake.toString(),
      oddsScaled: signed.offer.oddsScaled.toString(),
      offerExpiry,
      signature: encodeRfqSignatureBase64(signed.signature),
      legOddsScaled: legs.map((leg) => leg.oddsScaled.toString()),
   }));
   console.log("quoted parlay", req.requestId, signed.offer.oddsScaled.toString(), "legs", legs.length);
}

if (import.meta.main === true) {
   await main();
}
