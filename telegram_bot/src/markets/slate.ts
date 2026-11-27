import { SLATE_TTL_MS } from "../constants";
import { ttlCache } from "../cache";
import { logError } from "../chain/rpc";
import { debug } from "../debug";
import { API_DOMAIN } from "../network";
import type { UiEvent, UiMarket, UiSport } from "./types";

const slateCache = ttlCache<UiSport[]>(SLATE_TTL_MS);

function num(value: unknown, fallback = 0): number {
   const n = Number(value);
   return Number.isFinite(n) ? n : fallback;
}

function marketFrom(raw: unknown): UiMarket | null {
   if (raw == null || typeof raw !== "object") {
      return null;
   }
   const row = raw as Record<string, unknown>;
   return {
      id: num(row.id),
      event_id: num(row.event_id),
      league_id: num(row.league_id),
      sport_id: num(row.sport_id),
      period_id: num(row.period_id),
      player_id: num(row.player_id),
      player_name: typeof row.player_name === "string" ? row.player_name : "",
      line_value: row.line_value == null || row.line_value === "" ? null : num(row.line_value),
      last_odds: typeof row.last_odds === "string" ? row.last_odds : "[]",
      mkt_string: typeof row.mkt_string === "string" ? row.mkt_string : "",
      operator: typeof row.operator === "string" ? row.operator : "",
      mint: typeof row.mint === "string" ? row.mint : "",
   };
}

function eventFrom(raw: unknown): UiEvent | null {
   if (raw == null || typeof raw !== "object") {
      return null;
   }
   const row = raw as Record<string, unknown>;
   const markets = Array.isArray(row.markets)
      ? row.markets.map(marketFrom).filter((m): m is UiMarket => m != null)
      : [];
   return {
      id: num(row.id),
      league_id: num(row.league_id),
      sport_id: num(row.sport_id),
      home_name: typeof row.home_name === "string" ? row.home_name : "",
      away_name: typeof row.away_name === "string" ? row.away_name : "",
      event_name: typeof row.event_name === "string" ? row.event_name : "",
      start_time: num(row.start_time),
      markets,
   };
}

export function parseOdds(json: string): number[] {
   try {
      const value = JSON.parse(json) as unknown;
      if (!Array.isArray(value)) {
         return [];
      }
      return value.map((item) => Number(item)).filter((n) => Number.isFinite(n));
   } catch {
      return [];
   }
}

export function eventHasPrice(ev: UiEvent): boolean {
   for (const market of ev.markets ?? []) {
      for (const odd of parseOdds(market.last_odds)) {
         if (odd !== 0) {
            return true;
         }
      }
   }
   return false;
}

export function filterSlate(tree: readonly UiSport[]): UiSport[] {
   return tree
      .map((sport) => ({
         ...sport,
         leagues: sport.leagues
            .map((league) => ({
               ...league,
               events: league.events.filter(eventHasPrice),
            }))
            .filter((league) => league.events.length > 0),
      }))
      .filter((sport) => sport.leagues.length > 0);
}

function eventCount(sports: readonly UiSport[]): number {
   let count = 0;
   for (const sport of sports) {
      for (const league of sport.leagues) {
         count += league.events.length;
      }
   }
   return count;
}

async function fetchSlate(): Promise<UiSport[]> {
   const started = Date.now();
   debug("slate fetch");
   const res = await fetch(`${API_DOMAIN}/api/events?all=true`);
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const data = (await res.json()) as unknown;
   if (!Array.isArray(data)) {
      throw new Error("Expected array from /api/events?all=true");
   }
   const sports: UiSport[] = [];
   for (const rawSport of data) {
      if (rawSport == null || typeof rawSport !== "object") {
         continue;
      }
      const sport = rawSport as Record<string, unknown>;
      const leaguesRaw = Array.isArray(sport.leagues) ? sport.leagues : [];
      const leagues = [];
      for (const rawLeague of leaguesRaw) {
         if (rawLeague == null || typeof rawLeague !== "object") {
            continue;
         }
         const league = rawLeague as Record<string, unknown>;
         const events = (Array.isArray(league.events) ? league.events : [])
            .map(eventFrom)
            .filter((ev): ev is UiEvent => ev != null);
         leagues.push({
            id: num(league.id),
            sport_id: num(league.sport_id),
            name: typeof league.name === "string" ? league.name : "League",
            events,
         });
      }
      sports.push({
         id: num(sport.id),
         sport: typeof sport.sport === "string" ? sport.sport : "",
         name: typeof sport.name === "string" ? sport.name : "Sport",
         leagues,
      });
   }
   const slate = filterSlate(sports);
   debug("slate ready", { ms: Date.now() - started, sports: slate.length, events: eventCount(slate) });
   return slate;
}

export function loadSlate(): Promise<UiSport[]> {
   return slateCache.current(fetchSlate);
}

/** Download the slate at startup and again every TTL. Browse reads the copy already in memory. */
export function startSlateRefresh(after?: () => void): void {
   const run = () => {
      const started = Date.now();
      debug("slate background start");
      void slateCache.refresh(fetchSlate).then(() => {
         debug("slate background done", { ms: Date.now() - started });
         after?.();
      }).catch((error: unknown) => {
         debug("slate background failed", { ms: Date.now() - started });
         logError(error);
      });
   };
   debug("slate background every", SLATE_TTL_MS);
   run();
   setInterval(run, SLATE_TTL_MS);
}

export function findEvent(tree: readonly UiSport[], sportId: number, leagueId: number, eventId: number): {
   sport: UiSport;
   leagueName: string;
   event: UiEvent;
} | null {
   const sport = tree.find((item) => item.id === sportId);
   const league = sport?.leagues.find((item) => item.id === leagueId);
   const event = league?.events.find((item) => item.id === eventId);
   if (sport == null || league == null || event == null) {
      return null;
   }
   return { sport, leagueName: league.name, event };
}
