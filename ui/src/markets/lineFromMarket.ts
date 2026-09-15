import { decodeMarketLine, resolveMarketDisplay } from "spamm-aggregator-sdk";
import { formatMarketLineDisplay } from "./oddsFormat";

/** Fields needed to resolve display line (DB `line_value` or wire `mkt`). */
export type MarketLineSource = {
   id?: number;
   mkt_string: string;
   line_value: number | null;
};

function wireLine(m: MarketLineSource): number | null {
   if (m.line_value !== null && Number.isFinite(m.line_value)) {
      return m.line_value;
   }
   if (m.id != null) {
      return decodeMarketLine(m.id);
   }
   return null;
}

export function lineRawForSpreadOrTotal(m: MarketLineSource, kind: "spread" | "total"): string {
   const n = wireLine(m);
   if (n !== null && Number.isFinite(n)) {
      if (kind === "total") {
         return String(n);
      }
      if (n > 0) {
         return `+${n}`;
      }
      if (n < 0) {
         return String(n);
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

export function spreadHandicapNumber(m: MarketLineSource): number {
   const n = wireLine(m);
   if (n !== null && Number.isFinite(n)) {
      return n;
   }
   const tail = m.mkt_string.replace(/^AH\s+/, "").trim();
   return Number(tail);
}

export function totalLineNumber(m: MarketLineSource): number {
   const n = wireLine(m);
   if (n !== null && Number.isFinite(n)) {
      return n;
   }
   const tail = m.mkt_string.replace(/^OU\s+/, "").trim();
   return Number(tail);
}

export function spreadLineDisplayForOutcome(m: MarketLineSource, outcomeIndex: 0 | 1): string {
   let h = spreadHandicapNumber(m);
   if (!Number.isFinite(h) && m.id != null) {
      const family = resolveMarketDisplay(m.id).family;
      if (family !== "spread" && family !== "asian") {
         return "—";
      }
   }
   if (!Number.isFinite(h)) {
      return "—";
   }
   const sideH = outcomeIndex === 0 ? h : -h;
   const raw = sideH > 0 ? `+${sideH}` : sideH < 0 ? String(sideH) : "0";
   return formatMarketLineDisplay(raw, "spread");
}
