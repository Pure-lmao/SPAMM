import type { BetCardEvent, UiGroupedEvent } from "./types";
import { API_DOMAIN, LABS_DOMAIN } from "../network";

const apiDomain = API_DOMAIN;

/** Single event + markets (`/api/events?sport=&league=&event=`). */
export async function fetchOneEvent(sportId: number, leagueId: number, eventId: number): Promise<UiGroupedEvent> {
   const q = new URLSearchParams({
      sport: String(sportId),
      league: String(leagueId),
      event: String(eventId),
   });
   const res = await fetch(`${apiDomain}/api/events?${q.toString()}`);
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const raw = (await res.json()) as Record<string, UiGroupedEvent>;
   const compositeKey = `${sportId}:${leagueId}:${eventId}`;
   const ev = raw[compositeKey];
   if (!ev) {
      throw new Error("Event not found in API response");
   }
   return ev;
}

/** Labs `/api/events` accepts at most 100 ids per request. */
const BET_CARD_ID_CHUNK = 100;

export type BetCardEventRef = {
   sportId: number;
   leagueId: number;
   eventId: number;
   operator: string;
};

function optionalScore(value: unknown): number | null {
   if (value == null || value === "") {
      return null;
   }
   const n = Number(value);
   return Number.isFinite(n) ? n : null;
}

function periodsFromLabs(raw: unknown): BetCardEvent["periods"] {
   let parsed: unknown = raw;
   if (typeof parsed === "string") {
      try {
         parsed = JSON.parse(parsed);
      } catch {
         return [];
      }
   }
   if (!Array.isArray(parsed)) {
      return [];
   }
   const periods: { periodId: number; homeScore: number | null; awayScore: number | null }[] = [];
   for (const item of parsed) {
      if (item == null || typeof item !== "object") {
         continue;
      }
      const row = item as Record<string, unknown>;
      const periodId = Number(row.period_id ?? row.periodId);
      if (!Number.isFinite(periodId)) {
         continue;
      }
      periods.push({
         periodId,
         homeScore: optionalScore(row.home_score ?? row.homeScore),
         awayScore: optionalScore(row.away_score ?? row.awayScore),
      });
   }
   return periods;
}

function betCardEventFromLabs(raw: unknown): BetCardEvent | null {
   if (raw == null || typeof raw !== "object") {
      return null;
   }
   const row = raw as Record<string, unknown>;
   const id = Number(row.event_id ?? row.id);
   const leagueId = Number(row.league_id);
   const sportId = Number(row.sport_id);
   if (!Number.isFinite(id) || !Number.isFinite(leagueId) || !Number.isFinite(sportId)) {
      return null;
   }
   const text = (value: unknown): string => (typeof value === "string" ? value : "");
   return {
      id,
      league_id: leagueId,
      sport_id: sportId,
      home_name: text(row.home_name),
      away_name: text(row.away_name),
      event_name: text(row.event_name),
      home_score: optionalScore(row.home_score),
      away_score: optionalScore(row.away_score),
      periods: periodsFromLabs(row.periods),
   };
}

/**
 * Bet-card labels from labs (`/api/events?operator=&ids={sport}|{league}|{event},...`).
 * Labs keeps the full event archive; the markets host only has the live slate.
 */
export async function fetchBetCardEvents(events: readonly BetCardEventRef[]): Promise<BetCardEvent[]> {
   const byOperator = new Map<string, BetCardEventRef[]>();
   const seen = new Set<string>();
   for (const ev of events) {
      const operator = ev.operator.trim();
      if (operator === "") {
         continue;
      }
      const key = `${operator}|${ev.sportId}|${ev.leagueId}|${ev.eventId}`;
      if (seen.has(key)) {
         continue;
      }
      seen.add(key);
      const list = byOperator.get(operator) ?? [];
      list.push(ev);
      byOperator.set(operator, list);
   }
   const out: BetCardEvent[] = [];
   for (const [operator, refs] of byOperator) {
      for (let i = 0; i < refs.length; i += BET_CARD_ID_CHUNK) {
         const chunk = refs.slice(i, i + BET_CARD_ID_CHUNK);
         const q = new URLSearchParams({
            operator,
            ids: chunk.map((ev) => `${ev.sportId}|${ev.leagueId}|${ev.eventId}`).join(","),
         });
         const res = await fetch(`${LABS_DOMAIN}/api/events?${q.toString()}`);
         if (!res.ok) {
            throw new Error(`${res.status} ${res.statusText}`);
         }
         const data = (await res.json()) as unknown;
         if (data == null || typeof data !== "object" || !Array.isArray((data as { events?: unknown }).events)) {
            throw new Error("Expected { events } from /api/events");
         }
         for (const item of (data as { events: unknown[] }).events) {
            const card = betCardEventFromLabs(item);
            if (card != null) {
               out.push(card);
            }
         }
      }
   }
   return out;
}
