import type { BetColumn } from "./types";

/** 1X2: UI columns home / draw / away (indices 0,1,2) → chain `side` 0 / 1 / 2 (home / away / draw). */
const ONE_X2_UI_COLUMN_TO_CHAIN_SIDE = [0, 2, 1] as const;

/** Map UI column + outcome index to on-chain `side` (`validateBetSide` / `MarketId.mkt`). */
export function pickBetSide(column: BetColumn, mktString: string, outcomeIndex: number): number {
   if (column === "main") {
      if (mktString === "1X2") {
         if (outcomeIndex >= 0 && outcomeIndex < ONE_X2_UI_COLUMN_TO_CHAIN_SIDE.length) {
            return ONE_X2_UI_COLUMN_TO_CHAIN_SIDE[outcomeIndex]!;
         }
         return outcomeIndex;
      }
      return outcomeIndex;
   }
   if (column === "spread") {
      return outcomeIndex;
   }
   return outcomeIndex;
}
