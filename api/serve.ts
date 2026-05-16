import { fetchEvents, fetchEventsByLeague, fetchEventsBySport, fetchEventsGrouped, fetchLeagues, fetchSports } from "./localDb";
import { safeJSONStringify } from "./utils";

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
         const result = fetchLeagues([Number(sport)]);
         return new Response(safeJSONStringify(result), { headers: { "Content-Type": "application/json" } });
      }
      const result = fetchLeagues([Number(sport)]);
      return new Response(safeJSONStringify(result), { headers: { "Content-Type": "application/json" } });
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

      return withCors(req, new Response("Not Found", { status: 404 }));

   }
}
