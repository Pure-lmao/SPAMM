import { airdropUser } from "./solana";
import {
   fetchEvents,
   fetchEventsByLeague,
   fetchEventsBySport,
   fetchEventsGrouped,
   fetchLeagues,
   fetchLeaguesBySport,
   fetchSports,
   fetchPredictionContest,
   fetchPredictionContestToday,
   fetchPredictionContestsHistory,
   predictionContestToJson,
   fetchActivePromotionalMarkets,
   fetchPromotionalMarketsForEvent,
   fetchPromotionalMarketsForEventLookup,
   fetchPromotionalMarket,
   listPromotionalMarkets,
   promotionalMarketToJson,
} from "./localDb";
import { safeJSONStringify } from "./utils";
import { getClosedBetRecordsByUser } from "./quickIndexer";
import { parseRfqHttpRequestJson, RFQ_MM_WS_PATH } from "spamm-aggregator-sdk";
import { rfqHub, type MmWsData } from "./rfqHub";

const TTL_MS = 5000;

export const HTTPS_TLS_CERT_PATH =
   process.env.TLS_CERT_PATH ?? "/etc/ssl/certs/your-api/fullchain.pem";
export const HTTPS_TLS_KEY_PATH =
   process.env.TLS_KEY_PATH ?? "/etc/ssl/private/your-api/privkey.pem";

/** Pass to `Bun.serve({ tls: tlsOptionsForHttps(), ... })` when serving HTTPS. */
export function tlsOptionsForHttps(): { cert: Bun.BunFile; key: Bun.BunFile } {
   return {
      cert: Bun.file(HTTPS_TLS_CERT_PATH),
      key: Bun.file(HTTPS_TLS_KEY_PATH),
   };
}


function corsHeadersFor(req: Request): Record<string, string> {
   const origin = req.headers.get("Origin");
   const allow =
      origin != null && origin !== ""
         ? origin
         : "*";
   return {
      "Access-Control-Allow-Origin": allow,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
   };
}

function withCors(req: Request, res: Response): Response {
   const h = new Headers(res.headers);
   for (const [k, v] of Object.entries(corsHeadersFor(req))) {
      h.set(k, v);
   }
   return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: h,
   });
}

/**
 * Manages API requests.
 *
 * Endpoints:
 * - /api/events?all=true
 * - /api/events?sport={sportId}
 * - /api/events?sport={sportId}&league={leagueId}
 * - /api/events?sport={sportId}&league={leagueId}&event={eventId}
 * - /api/sports
 * - /api/leagues?all=true
 * - /api/leagues?sport={sportId}
 * - /api/airdrop/sol?user={userAddress}
 * - /api/betHistory?user={userAddress}
 * - /api/predictions/today
 * - /api/predictions/contest?id=
 * - /api/predictions/history?limit=
 * - /api/promos?active=true
 * - /api/promos?sport={sportId}&league={leagueId}&event={eventId}
 * - /api/promos?id={promoId}
 * - POST /api/rfq — fan-out RFQ to connected MMs (WS), wait 2s, return quotes
 * - WS  /ws/mm — MM sockets: send signed `mm.hello` (mmProgramId + rfqSigner + timestamp);
 *   server checks mm_list, on-chain config, recent timestamp, ed25519
 */
export class ApiServer {
   private async handleGetEvents(params: URLSearchParams): Promise<Response> {
      const sport = params.get("sport");
      const league = params.get("league");
      const event = params.get("event");
      const all = params.get("all");

      if (sport != null && league != null && event != null) {
         const result = fetchEvents([Number(event)], true);
         // if (!result) return Response.json({ error: result.error }, { status: 404 });
         return new Response(safeJSONStringify(result), { headers: { "Content-Type": "application/json" } });
      }
      if (sport != null && league != null) {
         const result = fetchEventsByLeague(Number(sport), [Number(league)], true);
         // if (!result.success) return Response.json({ error: result.error }, { status: 404 });
         return new Response(safeJSONStringify(result), { headers: { "Content-Type": "application/json" } });
      }
      if (sport != null) {
         const result = fetchEventsBySport([Number(sport)], true);
         // if (!result.success) return Response.json({ error: result.error }, { status: 404 });
         return new Response(safeJSONStringify(result), { headers: { "Content-Type": "application/json" } });
      }
      if (all === "true") {
         const result = fetchEventsGrouped(true);
         return new Response(safeJSONStringify(result), { headers: { "Content-Type": "application/json" } });
      }
      return Response.json({ error: "Missing query params. Use all=true, sport=, league=, or event=" }, { status: 400 });
   }

   private async handleGetSports(params: URLSearchParams): Promise<Response> {
      const result = fetchSports();
      return new Response(safeJSONStringify(result), { headers: { "Content-Type": "application/json" } });
   }

   private async handleGetLeagues(params: URLSearchParams): Promise<Response> {
      const sport = params.get("sport");
      const all = params.get("all");
      if (all === "true") {
         const result = fetchLeagues();
         return new Response(safeJSONStringify(result), { headers: { "Content-Type": "application/json" } });
      }
      if (sport != null) {
         const result = fetchLeaguesBySport(Number(sport));
         return new Response(safeJSONStringify(result), { headers: { "Content-Type": "application/json" } });
      }
      return Response.json({ error: "Missing query params. Use all=true or sport=" }, { status: 400 });
   }

   // private async handleGetSolAirdrop(params: URLSearchParams): Promise<Response> {
   //    const user = params.get("user");
   //    if (!user) {
   //       return Response.json({ error: "Missing query params. Use user=" }, { status: 400 });
   //    }
   //    const result = await airdropUser(user);
   //    return new Response(safeJSONStringify(result), { headers: { "Content-Type": "application/json" } });
   // }

   private async handleGetBetHistory(params: URLSearchParams): Promise<Response> {
      const user = params.get("user");
      if (!user) {
         return Response.json({ error: "Missing query params. Use user=" }, { status: 400 });
      }
      const result = getClosedBetRecordsByUser(user);
      return new Response(safeJSONStringify(result), { headers: { "Content-Type": "application/json" } });
   }

   private async handleGetPredictionsToday(): Promise<Response> {
      const contest = fetchPredictionContestToday();
      if (!contest) {
         return new Response("null", { headers: { "Content-Type": "application/json" } });
      }
      return new Response(
         safeJSONStringify({
            ...predictionContestToJson(contest),
            entry_open: contest.entry_open,
         }),
         { headers: { "Content-Type": "application/json" } },
      );
   }

   private async handleGetPredictionContest(params: URLSearchParams): Promise<Response> {
      const idRaw = params.get("id");
      if (!idRaw) {
         return Response.json({ error: "Missing query param id=" }, { status: 400 });
      }
      const contest = fetchPredictionContest(Number(idRaw));
      if (!contest) {
         return Response.json({ error: "Contest not found" }, { status: 404 });
      }
      return new Response(safeJSONStringify(predictionContestToJson(contest)), {
         headers: { "Content-Type": "application/json" },
      });
   }

   private async handleGetPredictionsHistory(params: URLSearchParams): Promise<Response> {
      const limitRaw = params.get("limit");
      const limit = limitRaw != null ? Number(limitRaw) : 30;
      const rows = fetchPredictionContestsHistory(Number.isFinite(limit) ? limit : 30);
      return new Response(safeJSONStringify(rows.map(predictionContestToJson)), {
         headers: { "Content-Type": "application/json" },
      });
   }

   private async handleGetPromos(params: URLSearchParams): Promise<Response> {
      const idRaw = params.get("id");
      if (idRaw != null) {
         const promo = fetchPromotionalMarket(Number(idRaw));
         if (!promo) {
            return Response.json({ error: "Promotional market not found" }, { status: 404 });
         }
         return new Response(safeJSONStringify(promotionalMarketToJson(promo)), {
            headers: { "Content-Type": "application/json" },
         });
      }

      const sport = params.get("sport");
      const league = params.get("league");
      const event = params.get("event");
      if (sport != null && league != null && event != null) {
         const fetchPromos =
            params.get("lookup") === "true"
               ? fetchPromotionalMarketsForEventLookup
               : fetchPromotionalMarketsForEvent;
         const rows = fetchPromos(Number(sport), Number(league), Number(event));
         return new Response(safeJSONStringify(rows.map(promotionalMarketToJson)), {
            headers: { "Content-Type": "application/json" },
         });
      }

      if (params.get("active") === "true") {
         const rows = fetchActivePromotionalMarkets();
         return new Response(safeJSONStringify(rows.map(promotionalMarketToJson)), {
            headers: { "Content-Type": "application/json" },
         });
      }

      const rows = listPromotionalMarkets().slice(0, 50);
      return new Response(safeJSONStringify(rows.map(promotionalMarketToJson)), {
         headers: { "Content-Type": "application/json" },
      });
   }

   private async handlePostRfq(req: Request): Promise<Response> {
      let body: unknown;
      try {
         body = await req.json();
      } catch {
         return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }

      let parsed;
      try {
         parsed = parseRfqHttpRequestJson(body);
      } catch (e) {
         const message = e instanceof Error ? e.message : String(e);
         return Response.json({ error: message }, { status: 400 });
      }

      const result = await rfqHub.collectQuotes(parsed);
      return new Response(safeJSONStringify(result), {
         headers: { "Content-Type": "application/json" },
      });
   }

   /**
    * HTTP fetch handler. Pass `server` from `Bun.serve` so `/ws/mm` can upgrade.
    * Returns `undefined` when a WebSocket upgrade succeeds (Bun sends 101).
    */
   fetch(req: Request, server?: Bun.Server<MmWsData>): Response | Promise<Response> | undefined {
      const url = new URL(req.url);

      if (url.pathname === RFQ_MM_WS_PATH && server != null) {
         const upgraded = server.upgrade(req, {
            data: { mmProgramId: null, rfqSigner: null },
         });
         if (upgraded) {
            return undefined;
         }
         return new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (req.method === "OPTIONS" && url.pathname.startsWith("/api")) {
         return new Response(null, { status: 204, headers: corsHeadersFor(req) });
      }

      const params = url.searchParams;

      if (url.pathname === "/api/events") {
         return this.handleGetEvents(params).then((r) => withCors(req, r));
      }
      if (url.pathname === "/api/sports") {
         return this.handleGetSports(params).then((r) => withCors(req, r));
      }
      if (url.pathname === "/api/leagues") {
         return this.handleGetLeagues(params).then((r) => withCors(req, r));
      }
      // if (url.pathname === "/api/airdrop/sol") {
      //    return this.handleGetSolAirdrop(params).then((r) => withCors(req, r));
      // }
      if (url.pathname === "/api/betHistory") {
         return this.handleGetBetHistory(params).then((r) => withCors(req, r));
      }
      if (url.pathname === "/api/predictions/today") {
         return this.handleGetPredictionsToday().then((r) => withCors(req, r));
      }
      if (url.pathname === "/api/predictions/contest") {
         return this.handleGetPredictionContest(params).then((r) => withCors(req, r));
      }
      if (url.pathname === "/api/predictions/history") {
         return this.handleGetPredictionsHistory(params).then((r) => withCors(req, r));
      }
      if (url.pathname === "/api/promos") {
         return this.handleGetPromos(params).then((r) => withCors(req, r));
      }
      if (url.pathname === "/api/rfq" && req.method === "POST") {
         return this.handlePostRfq(req).then((r) => withCors(req, r));
      }

      return withCors(req, new Response("Not Found", { status: 404 }));

   }
}
