import {
   PROMO_MKT_ID,
   isMainPeriod,
   isPromoMarketId,
   periodCaption as sdkPeriodCaption,
   type MarketDisplayCtx,
} from "spamm-aggregator-sdk";
import type { UiMarket } from "./types";

export { PROMO_MKT_ID };
export const PROMO_MKT_STRING = "PROMO";

/** Esports sport ids (`api/initDb.ts`). Map N is period 10 + N, up to map 10. */
const ESPORTS_SPORT_IDS: ReadonlySet<number> = new Set([101, 102, 103, 104]);
const MAP_PERIOD_BASE = 10;
const MAX_MAP_PERIOD = 20;

export function isEsportsSport(sportId: number): boolean {
   return ESPORTS_SPORT_IDS.has(sportId);
}

export function isEsportsMapPeriod(sportId: number, period: number): boolean {
   return isEsportsSport(sportId) && period > MAP_PERIOD_BASE && period <= MAX_MAP_PERIOD;
}

export function periodCaption(sportId: number, period: number): string {
   if (isEsportsMapPeriod(sportId, period)) {
      return `Map ${period - MAP_PERIOD_BASE}`;
   }
   return sdkPeriodCaption(period);
}

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
