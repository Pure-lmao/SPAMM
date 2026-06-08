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
} from "./localDb";
import { safeJSONStringify } from "./utils";
import { getClosedBetRecordsByUser } from "quickIndexer";

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
      "Access-Control-Allow-Methods": "GET, OPTIONS",
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

   fetch(req: Request): Response | Promise<Response> {
      const url = new URL(req.url);

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

      return withCors(req, new Response("Not Found", { status: 404 }));

   }
}