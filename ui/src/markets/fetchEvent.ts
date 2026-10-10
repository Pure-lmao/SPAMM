import type { BetCardEvent, UiGroupedEvent } from "./types";
const apiDomain = import.meta.env.VITE_API_DOMAIN?.trim() ?? "";

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

const BET_CARD_ID_CHUNK = 150;

/** Bet-card labels for many events (`/api/events/cards?ids=`). */
export async function fetchBetCardEvents(eventIds: readonly number[]): Promise<BetCardEvent[]> {
   const unique: number[] = [];
   const seen = new Set<number>();
   for (const id of eventIds) {
      if (!seen.has(id)) {
         seen.add(id);
         unique.push(id);
      }
   }
   if (unique.length === 0) {
      return [];
   }
   const out: BetCardEvent[] = [];
   for (let i = 0; i < unique.length; i += BET_CARD_ID_CHUNK) {
      const chunk = unique.slice(i, i + BET_CARD_ID_CHUNK);
      const q = new URLSearchParams({ ids: chunk.join(",") });
      const res = await fetch(`${apiDomain}/api/events/cards?${q.toString()}`);
      if (!res.ok) {
         throw new Error(`${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) {
         throw new Error("Expected array from /api/events/cards");
      }
      out.push(...(data as BetCardEvent[]));
   }
   return out;
}
