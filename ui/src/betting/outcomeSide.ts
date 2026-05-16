import type { BetColumn } from "./types";

/** Map UI column + outcome index to on-chain `side` (`validateBetSide` / `MarketId.mkt`). */
export function pickBetSide(column: BetColumn, mktString: string, outcomeIndex: number): number {
   if (column === "main") {
      if (mktString === "1X2") {
         return outcomeIndex;
      }
      return outcomeIndex;
   }
   if (column === "spread") {
      return outcomeIndex;
   }
   return outcomeIndex;
}
