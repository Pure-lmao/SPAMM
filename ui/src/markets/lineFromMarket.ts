/** Fields needed to resolve display line (DB `line_value` or `mkt_string` tail). */
import { formatMarketLineDisplay } from "./oddsFormat";

export type MarketLineSource = {
   mkt_string: string;
   line_value: number | null;
};

/**
 * Spread / total line string for `formatMarketLineDisplay` — prefers `line_value` from the DB
 * (signed spread, unsigned total).
 */
export function lineRawForSpreadOrTotal(m: MarketLineSource, kind: "spread" | "total"): string {
   if (m.line_value !== null && Number.isFinite(m.line_value)) {
      const v = m.line_value;
      if (kind === "total") {
         return String(v);
      }
      if (v > 0) {
         return `+${v}`;
      }
      if (v < 0) {
         return String(v);
      }
      return "0";
   }
   if (kind === "spread" && m.mkt_string.startsWith("AH ")) {
      return m.mkt_string.replace(/^AH\s+/, "");
   }
   if (kind === "total" && m.mkt_string.startsWith("OU ")) {
      return m.mkt_string.replace(/^OU\s+/, "");
   }
   return "";
}

/** Numeric handicap for spread labels (home side line). */
export function spreadHandicapNumber(m: MarketLineSource): number {
   if (m.line_value !== null && Number.isFinite(m.line_value)) {
      return m.line_value;
   }
   const tail = m.mkt_string.replace(/^AH\s+/, "").trim();
   return Number(tail);
}

/** Total line for over/under labels. */
export function totalLineNumber(m: MarketLineSource): number {
   if (m.line_value !== null && Number.isFinite(m.line_value)) {
      return m.line_value;
   }
   const tail = m.mkt_string.replace(/^OU\s+/, "").trim();
   return Number(tail);
}

/** Display handicap for home (`0`) or away (`1`) from the home-centric wire line. */
export function spreadLineDisplayForOutcome(m: MarketLineSource, outcomeIndex: 0 | 1): string {
   let h = spreadHandicapNumber(m);
   if (!Number.isFinite(h)) {
      const raw = lineRawForSpreadOrTotal(m, "spread");
      const t = raw.trim().replace(/^\+/, "");
      h = Number(t);
   }
   if (!Number.isFinite(h)) {
      return "—";
   }
   const sideH = outcomeIndex === 0 ? h : -h;
   const raw = sideH > 0 ? `+${sideH}` : sideH < 0 ? String(sideH) : "0";
   return formatMarketLineDisplay(raw, "spread");
}
