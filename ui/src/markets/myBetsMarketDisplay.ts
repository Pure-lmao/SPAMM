import type { MarketId } from "spamm-aggregator-sdk";
import { buildMarketLabel } from "../betting/marketLabel";
import type { MarketRow } from "../betting/types";
import { displayEventTitle } from "./eventDisplay";
import {
   handicapTableKind,
   marketPrimaryLabel,
   periodCaption,
   PROMO_MKT_ID,
   shouldShowPeriodBadge,
   totalsSectionTitle,
} from "./eventMarketsDisplay";
import { inferBetColumn } from "./selectors";
import type { UiGroupedEvent, UiMarket, UiPromotionalMarket } from "./types";

export function eventLookupKey(chain: MarketId): string {
   const eid = chain.eventId;
   return `${eid.sport}:${eid.league}:${Number(eid.event)}`;
}

export function isPromoMarketChain(chain: MarketId): boolean {
   return Number(chain.mkt) === PROMO_MKT_ID;
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
   const exact = mkts.find((m) => m.id === id && m.period_id === pid);
   if (exact !== undefined) {
      return exact;
   }
   return mkts.find((m) => m.id === id);
}

function toMarketRow(m: UiMarket): MarketRow {
   return { id: m.id, mkt_string: m.mkt_string, period_id: m.period_id, line_value: m.line_value };
}

/** Section-style label for My Bets (no raw `AH …` / `OU …` strings). */
function marketCategoryTitle(ev: UiGroupedEvent, m: UiMarket): string {
   if (m.mkt_string.startsWith("AH ")) {
      return handicapTableKind(m) === "asian" ? "Asian Handicap" : "Spread";
   }
   if (m.mkt_string.startsWith("OU ")) {
      return totalsSectionTitle([m]);
   }
   return marketPrimaryLabel(ev.sport_id, m);
}

function formatPickLabel(
   side: number,
   column: ReturnType<typeof inferBetColumn>,
   m: MarketRow,
   teams: { homeName: string; awayName: string },
): string {
   const raw = buildMarketLabel(column, m, side, teams);
   return raw
      .replace(/\s*\(1X2\)\s*$/, "")
      .replace(/\s*\(ML\)\s*$/, "")
      .replace(/\s*\(To qualify\)\s*$/, "");
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

/** Human-readable event title, LIVE marker, and period / market / pick for a bet row. */
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
   if (m == null) {
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

   const teams = { homeName: ev.home_name, awayName: ev.away_name };
   const column = inferBetColumn(m.mkt_string);
   const pick = formatPickLabel(side, column, toMarketRow(m), teams);
   const periodMarket = shouldShowPeriodBadge(ev.sport_id, m)
      ? `${periodCaption(m.period_id)} · ${marketCategoryTitle(ev, m)}`
      : marketCategoryTitle(ev, m);
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
