import type { MarketRow } from "./types";
import { formatMarketLineDisplay } from "../markets/oddsFormat";
import { spreadHandicapNumber, totalLineNumber } from "../markets/lineFromMarket";

export type MarketLabelTeams = {
   homeName: string;
   awayName: string;
};

function sideLabel(teams: MarketLabelTeams | undefined, side: "home" | "away", fallback: string): string {
   const raw = side === "home" ? teams?.homeName : teams?.awayName;
   const t = raw?.trim();
   return t !== undefined && t !== "" ? t : fallback;
}

/** Build `+1` / `-0.5` style raw for `formatMarketLineDisplay` (spread). */
function spreadNumericToRaw(h: number): string {
   if (!Number.isFinite(h)) {
      return "";
   }
   if (h > 0) {
      return `+${h}`;
   }
   if (h < 0) {
      return String(h);
   }
   return "0";
}

export function buildMarketLabel(
   column: "main" | "spread" | "total",
   market: MarketRow,
   outcomeIndex: number,
   teams?: MarketLabelTeams,
): string {
   const s = market.mkt_string;
   if (column === "main") {
      if (s === "1X2") {
         const lab =
            outcomeIndex === 0
               ? sideLabel(teams, "home", "Home")
               : outcomeIndex === 1
                 ? "Draw"
                 : sideLabel(teams, "away", "Away");
         return `${lab} (1X2)`;
      }
      if (s === "ML") {
         const lab = outcomeIndex === 0 ? sideLabel(teams, "home", "Home") : sideLabel(teams, "away", "Away");
         return `${lab} (ML)`;
      }
      if (s === "TQ") {
         const lab = outcomeIndex === 0 ? sideLabel(teams, "home", "Home") : sideLabel(teams, "away", "Away");
         return `${lab} (To qualify)`;
      }
      return `${s} (${outcomeIndex})`;
   }
   if (column === "spread") {
      const L = spreadHandicapNumber(market);
      const homeN = sideLabel(teams, "home", "Home");
      const awayN = sideLabel(teams, "away", "Away");
      if (!Number.isFinite(L)) {
         return outcomeIndex === 0 ? `${homeN} —` : `${awayN} —`;
      }
      if (outcomeIndex === 0) {
         return `${homeN} ${formatMarketLineDisplay(spreadNumericToRaw(L), "spread")}`;
      }
      return `${awayN} ${formatMarketLineDisplay(spreadNumericToRaw(-L), "spread")}`;
   }
   if (column === "total") {
      const t = totalLineNumber(market);
      const lab = outcomeIndex === 0 ? "Over" : "Under";
      const raw = Number.isFinite(t) ? String(t) : "0";
      return `${lab} ${formatMarketLineDisplay(raw, "total")}`;
   }
   return s;
}
