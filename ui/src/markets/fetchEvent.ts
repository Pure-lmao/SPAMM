import type { UiGroupedEvent } from "./types";

/** Single event + markets (`/api/events?sport=&league=&event=`). */
export async function fetchOneEvent(sportId: number, leagueId: number, eventId: number): Promise<UiGroupedEvent> {
   const q = new URLSearchParams({
      sport: String(sportId),
      league: String(leagueId),
      event: String(eventId),
   });
   const res = await fetch(`/api/events?${q.toString()}`);
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
