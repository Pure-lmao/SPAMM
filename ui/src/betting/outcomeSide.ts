import { displayColumnToChainSide } from "spamm-aggregator-sdk";
import type { BetColumn } from "./types";

/** Map UI column + outcome index to on-chain `side`. */
export function pickBetSide(column: BetColumn, mktString: string, outcomeIndex: number, mktWireId?: number): number {
   const mkt = mktWireId ?? (mktString === "1X2" ? 1 : 0);
   if (column === "main" && (mktString === "1X2" || mkt === 1)) {
      return displayColumnToChainSide(1, outcomeIndex);
   }
   return displayColumnToChainSide(mkt, outcomeIndex);
}
