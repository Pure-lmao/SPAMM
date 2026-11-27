import {
   eventGroupKey,
   fullMarketName,
   isMainPeriod,
   isPromoMarketId,
   orderOneX2WireToDisplay,
   resolveMarketDisplay,
   sideLabel,
} from "spamm-aggregator-sdk";
import { columnFor, displayCtx, makeLeg, type BetColumn, type Leg } from "./leg";
import { parseOdds } from "./slate";
import type { UiEvent, UiMarket } from "./types";
import { formatOddsNumber, type OddsFormat } from "../usdc";

export type OutcomeButton = { text: string; leg: Leg };

function sortMarkets(a: UiMarket, b: UiMarket): number {
   return a.id - b.id || a.player_id - b.player_id || a.period_id - b.period_id;
}

function priceOf(db: number, format: OddsFormat): string {
   if (db === 0) {
      return "";
   }
   const shown = formatOddsNumber(db / 10000, format);
   return shown === "—" ? "" : shown;
}

function pickMain(markets: readonly UiMarket[], sportId: number): UiMarket | undefined {
   if (sportId === 1) {
      return markets.filter((m) => m.mkt_string === "1X2" && m.period_id === 1).sort(sortMarkets)[0];
   }
   return markets.filter((m) => m.mkt_string === "ML" && m.period_id === 0).sort(sortMarkets)[0]
      ?? markets.filter((m) => m.mkt_string === "1X2" && m.period_id === 0).sort(sortMarkets)[0];
}

function family(market: UiMarket, event: UiEvent): string {
   return resolveMarketDisplay(market.id, displayCtx(market, event)).family;
}

function balance(values: number[]): number | null {
   if (values.length < 2 || (values[0] === 0 && values[1] === 0)) {
      return null;
   }
   const a = values[0]! / 10000;
   const b = values[1]! / 10000;
   return Math.abs(a - 2) + Math.abs(b - 2);
}

function pickLine(markets: readonly UiMarket[], event: UiEvent, kind: "spread" | "total"): UiMarket | undefined {
   const sportId = event.sport_id;
   const rows = markets.filter((market) => {
      const name = family(market, event);
      const ok = kind === "spread" ? name === "spread" || name === "asian" : name === "total";
      return ok && isMainPeriod(sportId, market.period_id);
   });
   if (rows.length === 0) {
      return undefined;
   }
   let best = rows[0]!;
   let bestScore = balance(parseOdds(best.last_odds));
   for (const market of rows.slice(1)) {
      const score = balance(parseOdds(market.last_odds));
      if (score == null) {
         continue;
      }
      if (bestScore == null || score < bestScore || (score === bestScore && market.id < best.id)) {
         best = market;
         bestScore = score;
      }
   }
   return best;
}

function marketKey(market: UiMarket): string {
   return `${market.id}:${market.period_id}:${market.player_id}`;
}

function buttonsFor(event: UiEvent, market: UiMarket, column: BetColumn, format: OddsFormat): OutcomeButton[] {
   const wire = parseOdds(market.last_odds);
   const ctx = displayCtx(market, event);
   const oneX2 = market.mkt_string === "1X2" || market.id === 1;
   const values = oneX2 ? orderOneX2WireToDisplay(wire) : wire;
   const out: OutcomeButton[] = [];
   values.forEach((db, index) => {
      if (db === 0) {
         return;
      }
      const leg = makeLeg(event, market, index, db, column);
      const price = priceOf(db, format);
      out.push({ text: price === "" ? leg.outcomeLabel : `${leg.outcomeLabel} | ${price}`, leg });
   });
   if (!oneX2 && out.length === 0) {
      const count = resolveMarketDisplay(market.id, ctx).sideCount;
      for (let index = 0; index < count; index++) {
         const db = wire[index] ?? 0;
         if (db === 0) {
            continue;
         }
         const leg = makeLeg(event, market, index, db, column);
         out.push({ text: `${sideLabel(market.id, index, ctx)} | ${priceOf(db, format)}`, leg });
      }
   }
   return out;
}

export function mainOutcomes(event: UiEvent, format: OddsFormat = "decimal"): OutcomeButton[] {
   const markets = event.markets ?? [];
   const main = pickMain(markets, event.sport_id);
   const spread = pickLine(markets, event, "spread");
   const total = pickLine(markets, event, "total");
   return [
      ...(main == null ? [] : buttonsFor(event, main, "main", format)),
      ...(spread == null ? [] : buttonsFor(event, spread, "spread", format)),
      ...(total == null ? [] : buttonsFor(event, total, "total", format)),
   ];
}

export function extraCount(event: UiEvent): number {
   const markets = event.markets ?? [];
   const featured = new Set<string>();
   const main = pickMain(markets, event.sport_id);
   const spread = pickLine(markets, event, "spread");
   const total = pickLine(markets, event, "total");
   for (const market of [main, spread, total]) {
      if (market != null) {
         featured.add(marketKey(market));
      }
   }
   return markets.filter((market) => !featured.has(marketKey(market)) && market.mkt_string !== "PROMO" && !isPromoMarketId(market.id)).length;
}

export type MarketSection = { title: string; rows: UiMarket[] };

export function sectionsFor(event: UiEvent): MarketSection[] {
   const markets = event.markets ?? [];
   const featured = new Set<string>();
   const main = pickMain(markets, event.sport_id);
   const spread = pickLine(markets, event, "spread");
   const total = pickLine(markets, event, "total");
   for (const market of [main, spread, total]) {
      if (market != null) {
         featured.add(marketKey(market));
      }
   }
   const buckets = new Map<string, UiMarket[]>();
   for (const market of markets) {
      if (featured.has(marketKey(market)) || market.mkt_string === "PROMO" || isPromoMarketId(market.id)) {
         continue;
      }
      const key = eventGroupKey(market.id, displayCtx(market, event));
      const list = buckets.get(key) ?? [];
      list.push(market);
      buckets.set(key, list);
   }
   const sections: MarketSection[] = [];
   for (const rows of buckets.values()) {
      const first = rows[0]!;
      sections.push({
         title: fullMarketName(first.id, displayCtx(first, event)),
         rows: [...rows].sort(sortMarkets),
      });
   }
   sections.sort((a, b) => a.title.localeCompare(b.title));
   return sections;
}

export function sectionOutcomes(event: UiEvent, rows: readonly UiMarket[], format: OddsFormat = "decimal"): OutcomeButton[] {
   const out: OutcomeButton[] = [];
   for (const market of rows) {
      const column: BetColumn = family(market, event) === "spread" || family(market, event) === "asian"
         ? "spread"
         : family(market, event) === "total" || family(market, event) === "homeTotal" || family(market, event) === "awayTotal"
            ? "total"
            : columnFor(market);
      out.push(...buttonsFor(event, market, column, format));
   }
   return out;
}
