import { betSlipLabel, groupTitle, periodCaption, type MarketId } from "spamm-aggregator-sdk";
import { useMemo } from "react";
import { useI18n } from "../i18n/useI18n";
import { displayEventTitle } from "./eventDisplay";
import { shouldShowPeriodBadge } from "./eventMarketsDisplay";
import type { BetCardEvent, UiMarket, UiPromotionalMarket } from "./types";

export function eventLookupKey(chain: MarketId): string {
   const eid = chain.eventId;
   return `${eid.sport}:${eid.league}:${Number(eid.event)}`;
}

export function isPromoMarketChain(chain: MarketId): boolean {
   return Number(chain.mkt) === 9;
}

export function promoMarketLookupKey(chain: MarketId): string {
   const eid = chain.eventId;
   return `${eid.sport}:${eid.league}:${Number(eid.event)}:${chain.period}`;
}

export function indexPromotionalMarkets(promos: readonly UiPromotionalMarket[]): Map<string, UiPromotionalMarket> {
   const map = new Map<string, UiPromotionalMarket>();
   for (const promo of promos) {
      const events = [
         { sport_id: promo.sport_id, league_id: promo.league_id, event_id: promo.event_id },
         ...promo.related_events,
      ];
      for (const ev of events) {
         map.set(`${ev.sport_id}:${ev.league_id}:${ev.event_id}:${promo.period_id}`, promo);
      }
   }
   return map;
}

function promoPickLabel(side: number, promo: UiPromotionalMarket, noLabel: string): string {
   return side === 0 ? promo.yes_label : noLabel;
}

export type BetMarketCopy = {
   live: string;
   no: string;
   promo: string;
   event: (id: string) => string;
   market: (id: string) => string;
   side: (side: number) => string;
};

const englishBetCopy: BetMarketCopy = {
   live: " · LIVE",
   no: "No",
   promo: "Promo",
   event: (id) => `Event ${id}`,
   market: (id) => `Market #${id}`,
   side: (side) => `side ${side}`,
};

export function useBetMarketCopy(): BetMarketCopy {
   const { t } = useI18n();
   return useMemo(
      () => ({
         live: t("myBets.live"),
         no: t("myBets.no"),
         promo: t("myBets.promo"),
         event: (id: string) => t("myBets.event", { id }),
         market: (id: string) => t("myBets.market", { id }),
         side: (side: number) => t("myBets.side", { side }),
      }),
      [t],
   );
}

export type BetMarketDisplayLines = Readonly<{
   eventTitle: string;
   liveSuffix: string;
   periodMarket: string;
   pick: string;
   detailLine: string;
   promoTitle: string | null;
   promoDescription: string | null;
}>;

export function betMarketDisplayLines(
   ev: BetCardEvent | undefined,
   chain: MarketId,
   side: number,
   promo?: UiPromotionalMarket | null,
   copy: BetMarketCopy = englishBetCopy,
): BetMarketDisplayLines {
   const eventTitle = ev != null ? displayEventTitle(ev) : copy.event(chain.eventId.event.toString());
   const liveSuffix = !chain.isPregame ? copy.live : "";

   if (promo != null) {
      const pick = promoPickLabel(side, promo, copy.no);
      const sportId = ev?.sport_id ?? promo.sport_id;
      const periodMarket = shouldShowPeriodBadge(sportId, { period_id: promo.period_id } as UiMarket)
         ? `${periodCaption(promo.period_id)} · ${promo.title}`
         : promo.title;
      return {
         eventTitle,
         liveSuffix,
         periodMarket,
         pick,
         detailLine: `${promo.title} · ${pick}`,
         promoTitle: promo.title,
         promoDescription: promo.description.trim() !== "" ? promo.description : null,
      };
   }

   if (ev == null) {
      const fb = copy.market(chain.mkt.toString());
      const pick = copy.side(side);
      return {
         eventTitle,
         liveSuffix,
         periodMarket: fb,
         pick,
         detailLine: `${fb} · ${pick}`,
         promoTitle: null,
         promoDescription: null,
      };
   }

   const ctx = {
      sport: ev.sport_id,
      homeName: ev.home_name,
      awayName: ev.away_name,
      playerId: Number(chain.player),
      period: chain.period,
   };
   const mkt = Number(chain.mkt);
   const pick = betSlipLabel(mkt, side, ctx)
      .replace(/\s*\(1X2\)\s*$/, "")
      .replace(/\s*\(ML\)\s*$/, "")
      .replace(/\s*\(To qualify\)\s*$/, "");
   const category = isPromoMarketChain(chain) ? copy.promo : groupTitle(mkt, ctx);
   const periodId = chain.period;
   const periodMarket = shouldShowPeriodBadge(ev.sport_id, { period_id: periodId } as UiMarket)
      ? `${periodCaption(periodId)} · ${category}`
      : category;
   const detailLine = `${periodMarket} · ${pick}`;
   return {
      eventTitle,
      liveSuffix,
      periodMarket,
      pick,
      detailLine,
      promoTitle: null,
      promoDescription: null,
   };
}
