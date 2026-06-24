import type { UiPromotionalMarket } from "./types";

const apiDomain = import.meta.env.VITE_API_DOMAIN?.trim() ?? "";

export async function fetchActivePromos(): Promise<UiPromotionalMarket[]> {
   const res = await fetch(`${apiDomain}/api/promos?active=true`);
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const data = (await res.json()) as unknown;
   if (!Array.isArray(data)) {
      throw new Error("Expected array from /api/promos?active=true");
   }
   return data as UiPromotionalMarket[];
}

export async function fetchPromosForEvent(
   sportId: number,
   leagueId: number,
   eventId: number,
): Promise<UiPromotionalMarket[]> {
   const q = new URLSearchParams({
      sport: String(sportId),
      league: String(leagueId),
      event: String(eventId),
   });
   const res = await fetch(`${apiDomain}/api/promos?${q}`);
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const data = (await res.json()) as unknown;
   if (!Array.isArray(data)) {
      throw new Error("Expected array from /api/promos for event");
   }
   return data as UiPromotionalMarket[];
}

/** All promos (open + settled) for bet-history label resolution. */
export async function fetchPromosForBetLookup(): Promise<UiPromotionalMarket[]> {
   const res = await fetch(`${apiDomain}/api/promos`);
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const data = (await res.json()) as unknown;
   if (!Array.isArray(data)) {
      throw new Error("Expected array from /api/promos");
   }
   return data as UiPromotionalMarket[];
}

/** Open or settled promos for an event — includes settled unlike {@link fetchPromosForEvent}. */
export async function fetchPromosForEventLookup(
   sportId: number,
   leagueId: number,
   eventId: number,
): Promise<UiPromotionalMarket[]> {
   const q = new URLSearchParams({
      sport: String(sportId),
      league: String(leagueId),
      event: String(eventId),
      lookup: "true",
   });
   const res = await fetch(`${apiDomain}/api/promos?${q}`);
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const data = (await res.json()) as unknown;
   if (!Array.isArray(data)) {
      throw new Error("Expected array from /api/promos lookup");
   }
   return data as UiPromotionalMarket[];
}
