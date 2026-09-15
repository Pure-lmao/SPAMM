import { betSlipLabel, groupTitle, periodCaption, type MarketId } from "spamm-aggregator-sdk";
import { displayEventTitle } from "./eventDisplay";
import { isPromoMarket, shouldShowPeriodBadge, uiMarketDisplayCtx } from "./eventMarketsDisplay";
import type { UiGroupedEvent, UiMarket, UiPromotionalMarket } from "./types";

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

function promoPickLabel(side: number, promo: UiPromotionalMarket): string {
   return side === 0 ? promo.yes_label : "No";
}

function findUiMarket(ev: UiGroupedEvent, chain: MarketId): UiMarket | undefined {
   const mkts = ev.markets ?? [];
   const id = Number(chain.mkt);
   const pid = chain.period;
   const player = Number(chain.player);
   const exact = mkts.find((m) => m.id === id && m.period_id === pid && (m.player_id ?? 0) === player);
   if (exact !== undefined) {
      return exact;
   }
   return mkts.find((m) => m.id === id && m.period_id === pid) ?? mkts.find((m) => m.id === id);
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
   ev: UiGroupedEvent | undefined,
   chain: MarketId,
   side: number,
   promo?: UiPromotionalMarket | null,
): BetMarketDisplayLines {
   const eventTitle = ev != null ? displayEventTitle(ev) : `Event ${chain.eventId.event.toString()}`;
   const liveSuffix = !chain.isPregame ? " · LIVE" : "";

   if (promo != null) {
      const pick = promoPickLabel(side, promo);
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
      const fb = `Market #${chain.mkt.toString()}`;
      const pick = `side ${side}`;
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

   const m = findUiMarket(ev, chain);
   const ctx = m
      ? uiMarketDisplayCtx(m, { homeName: ev.home_name, awayName: ev.away_name })
      : {
         sport: ev.sport_id,
         homeName: ev.home_name,
         awayName: ev.away_name,
         playerId: Number(chain.player),
      };
   const mkt = m?.id ?? Number(chain.mkt);
   const pick = betSlipLabel(mkt, side, ctx)
      .replace(/\s*\(1X2\)\s*$/, "")
      .replace(/\s*\(ML\)\s*$/, "")
      .replace(/\s*\(To qualify\)\s*$/, "");
   const category =
      m != null && isPromoMarket(m)
         ? "Promo"
         : m?.player_name?.trim() || groupTitle(mkt, ctx);
   const periodId = m?.period_id ?? chain.period;
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
