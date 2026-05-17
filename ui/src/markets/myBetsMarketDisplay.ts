import type { MarketId } from "spamm-aggregator-sdk";
import { buildMarketLabel } from "../betting/marketLabel";
import type { MarketRow } from "../betting/types";
import { displayEventTitle } from "./eventDisplay";
import {
   handicapTableKind,
   marketPrimaryLabel,
   periodCaption,
   shouldShowPeriodBadge,
   totalsSectionTitle,
} from "./eventMarketsDisplay";
import { inferBetColumn } from "./selectors";
import type { UiGroupedEvent, UiMarket } from "./types";

export function eventLookupKey(chain: MarketId): string {
   const eid = chain.eventId;
   return `${eid.sport}:${eid.league}:${Number(eid.event)}`;
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
}>;

/** Human-readable event title, LIVE marker, and period / market / pick for a bet row. */
export function betMarketDisplayLines(ev: UiGroupedEvent | undefined, chain: MarketId, side: number): BetMarketDisplayLines {
   const eventTitle = ev != null ? displayEventTitle(ev) : `Event ${chain.eventId.event.toString()}`;
   const liveSuffix = !chain.isPregame ? " · LIVE" : "";

   if (ev == null) {
      const fb = `Market #${chain.mkt.toString()}`;
      const pick = `side ${side}`;
      return {
         eventTitle,
         liveSuffix,
         periodMarket: fb,
         pick,
         detailLine: `${fb} · ${pick}`,
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
   };
}
