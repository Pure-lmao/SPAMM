import { addMarket, fetchEventsByEventId, fetchMarket, fetchUpcomingEvents } from "./localDb";
import type { Event, Market } from "./types";
import { safeJSONStringify } from "./utils";

export type MarketLineKind = "spread" | "total";

export type UpcomingEventSummary = {
   id: number;
   sport_id: number;
   league_id: number;
   event_name: string;
   home_name: string;
   away_name: string;
   start_time: number;
};

export function listUpcomingEvents(): UpcomingEventSummary[] {
   return fetchUpcomingEvents().map((e) => ({
      id: e.id,
      sport_id: e.sport_id,
      league_id: e.league_id,
      event_name: e.event_name,
      home_name: e.home_name,
      away_name: e.away_name,
      start_time: e.start_time,
   }));
}

export function marketIdForLine(sportId: number, kind: MarketLineKind, line: number): number {
   if (kind === "total") {
      const base = sportId === 1 ? 50 : 1000;
      const mult = sportId === 1 ? 4 : 2;
      return base + line * mult;
   }
   const base = sportId === 1 ? 400 : 200;
   const mult = sportId === 1 ? 4 : 2;
   return base + line * mult;
}

export function mktStringForLine(kind: MarketLineKind, line: number): string {
   if (kind === "total") {
      return `OU ${line}`;
   }
   const sign = line > 0 ? "+" : "";
   return `AH ${sign}${line}`;
}

export function periodIdForSport(sportId: number): number {
   return sportId === 1 ? 1 : 0;
}

function resolveEvent(eventId: number): Event {
   const matches = fetchEventsByEventId(eventId);
   if (matches.length === 0) {
      throw new Error(`Event ${eventId} not found`);
   }
   if (matches.length > 1) {
      const keys = matches.map((e) => `sport ${e.sport_id}, league ${e.league_id}`).join("; ");
      throw new Error(`Event ${eventId} is ambiguous (${keys}) — resolve duplicates in the DB first`);
   }
   return matches[0]!;
}

export function addEventLineMarket(eventId: number, kind: MarketLineKind, line: number): Market {
   const event = resolveEvent(eventId);
   if (event.start_time <= Date.now()) {
      throw new Error(`Event ${eventId} has already started`);
   }

   const id = marketIdForLine(event.sport_id, kind, line);
   const mkt_string = mktStringForLine(kind, line);
   const period_id = periodIdForSport(event.sport_id);

   const existing = fetchMarket(id, eventId, event.league_id, event.sport_id);
   if (existing) {
      throw new Error(`Market already exists: ${existing.mkt_string} (id ${existing.id})`);
   }

   const market: Market = {
      id,
      event_id: eventId,
      league_id: event.league_id,
      sport_id: event.sport_id,
      period_id,
      line_value: line,
      last_odds: safeJSONStringify([0, 0]),
      last_update: Date.now(),
      mkt_string,
   };
   addMarket(market);
   return market;
}
