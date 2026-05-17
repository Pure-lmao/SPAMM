import type { UiMarket } from "./types";

export type EventMarketSectionKind = "money" | "tq" | "spread" | "asian" | "total" | "extra";

/** Section heading: wire `id` 1 with 1X2 → Full Time Result; `id` 0 with ML → Moneyline (see `fetch.ts` seed ids). */
export function moneylineSectionTitle(rows: UiMarket[]): string {
   const has1x2 = rows.some((m) => m.mkt_string === "1X2" && m.id === 1);
   const hasMl = rows.some((m) => m.mkt_string === "ML" && m.id === 0);
   if (has1x2) {
      return "Full Time Result";
   }
   if (hasMl) {
      return "Moneyline";
   }
   return rows.some((m) => m.mkt_string === "1X2") ? "Full Time Result" : "Moneyline";
}

/** OU section title — wire `id` bands match `api/fetch.ts` vs id-system.md (51–99 goals ladder, 1001–1999 points). */
export function totalsSectionTitle(rows: UiMarket[]): string {
   const id = rows[0]?.id;
   if (id == null) {
      return "Totals";
   }
   if (id > 50 && id < 100) {
      return "Total Goals";
   }
   if (id > 1000 && id < 2000) {
      return "Total Points";
   }
   return "Totals";
}

const PERIOD_CAPTION: Record<number, string> = {
   0: "Result incl OT",
   1: "Regular Time",
   2: "Half Time",
};

export function periodCaption(periodId: number): string {
   return PERIOD_CAPTION[periodId] ?? `Period ${periodId}`;
}

/** Hide default period for the sport (soccer RT = 1, other main = 0). */
export function shouldShowPeriodBadge(sportId: number, m: UiMarket): boolean {
   if (sportId === 1) {
      return m.period_id !== 1;
   }
   return m.period_id !== 0;
}

/** AH split: wire id in (100, 299) → Spread; in (300, 499) → Asian Handicap; otherwise infer from side of gap. */
export function handicapTableKind(m: UiMarket): "spread" | "asian" {
   const id = m.id;
   if (id > 300 && id < 499) {
      return "asian";
   }
   if (id > 100 && id < 299) {
      return "spread";
   }
   if (id >= 300) {
      return "asian";
   }
   return "spread";
}

/** Soccer wire `mkt` 0 “to qualify” (not ML). */
export function isSoccerToQualify(m: UiMarket, sportId: number): boolean {
   return sportId === 1 && m.id === 0 && m.mkt_string === "TQ";
}

/** Left-column label for money / “other” rows (not spread/total line tables). */
export function marketPrimaryLabel(sportId: number, m: UiMarket): string {
   if (isSoccerToQualify(m, sportId)) {
      return "To Qualify";
   }
   if (m.mkt_string === "1X2") {
      return "1X2";
   }
   if (m.mkt_string === "ML") {
      return "ML";
   }
   return m.mkt_string;
}
