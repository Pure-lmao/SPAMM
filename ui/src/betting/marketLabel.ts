import { betSlipLabel, type MarketDisplayCtx } from "spamm-aggregator-sdk";
import type { MarketRow } from "./types";
import { uiMarketDisplayCtx } from "../markets/eventMarketsDisplay";

export type MarketLabelTeams = {
   homeName: string;
   awayName: string;
};

function ctxFromRow(market: MarketRow, teams?: MarketLabelTeams): MarketDisplayCtx {
   return uiMarketDisplayCtx(
      {
         id: market.id,
         mkt_string: market.mkt_string,
         line_value: market.line_value,
         period_id: market.period_id,
         sport_id: market.sport_id ?? 0,
         player_id: market.player_id ?? 0,
         player_name: market.player_name ?? "",
      },
      teams,
   );
}

/**
 * @param side On-chain `side` for fills.
 */
export function buildMarketLabel(
   _column: "main" | "spread" | "total",
   market: MarketRow,
   side: number,
   teams?: MarketLabelTeams,
): string {
   return betSlipLabel(market.id, side, ctxFromRow(market, teams));
}
