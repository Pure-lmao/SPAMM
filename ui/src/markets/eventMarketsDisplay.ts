import {
   PROMO_MKT_ID,
   isMainPeriod,
   isPromoMarketId,
   periodCaption,
   type MarketDisplayCtx,
} from "spamm-aggregator-sdk";
import type { UiMarket } from "./types";

export { PROMO_MKT_ID, periodCaption };
export const PROMO_MKT_STRING = "PROMO";

export function uiMarketDisplayCtx(
   m: Pick<UiMarket, "id" | "mkt_string" | "line_value" | "period_id" | "sport_id" | "player_id" | "player_name">,
   teams?: { homeName: string; awayName: string },
): MarketDisplayCtx {
   return {
      sport: m.sport_id,
      homeName: teams?.homeName,
      awayName: teams?.awayName,
      playerId: m.player_id,
      playerName: m.player_name,
      period: m.period_id,
      lineValue: m.line_value,
      mktString: m.mkt_string,
   };
}

export function isPromoMarket(m: Pick<UiMarket, "mkt_string" | "id">): boolean {
   return m.mkt_string === PROMO_MKT_STRING || isPromoMarketId(m.id);
}

export function shouldShowPeriodBadge(sportId: number, m: Pick<UiMarket, "period_id">): boolean {
   return !isMainPeriod(sportId, m.period_id);
}

export function marketDomKey(m: Pick<UiMarket, "id" | "period_id" | "player_id">): string {
   return `${m.id}-${m.period_id}-${m.player_id ?? 0}`;
}
