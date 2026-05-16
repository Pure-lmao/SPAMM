import type { MarketRow } from "./types";

function parseSignedLineFromAh(mktString: string): number {
   const tail = mktString.replace(/^AH\s+/, "").trim();
   return Number(tail);
}

function parseOuLine(mktString: string): number {
   return Number(mktString.replace(/^OU\s+/, "").trim());
}

export function buildMarketLabel(
   column: "main" | "spread" | "total",
   market: MarketRow,
   outcomeIndex: number,
): string {
   const s = market.mkt_string;
   if (column === "main") {
      if (s === "1X2") {
         const lab = outcomeIndex === 0 ? "Home" : outcomeIndex === 1 ? "Draw" : "Away";
         return `${lab} (1X2)`;
      }
      if (s === "ML") {
         const lab = outcomeIndex === 0 ? "Home" : "Away";
         return `${lab} (ML)`;
      }
      return `${s} (${outcomeIndex})`;
   }
   if (column === "spread") {
      const L = parseSignedLineFromAh(s);
      if (outcomeIndex === 0) {
         return `Home ${L >= 0 ? "+" : ""}${L}`;
      }
      const awayL = -L;
      return `Away ${awayL >= 0 ? "+" : ""}${awayL}`;
   }
   if (column === "total") {
      const t = parseOuLine(s);
      const lab = outcomeIndex === 0 ? "Over" : "Under";
      return `${lab} ${t}`;
   }
   return s;
}
