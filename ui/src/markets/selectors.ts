import type { BetColumn } from "../betting/types";
import {
   eventGroupKey,
   isMainPeriod,
   isPlayerProp,
   isSoccerToQualify,
   playerPropBase,
   resolveMarketDisplay,
   type MarketLayout,
} from "spamm-aggregator-sdk";
import { isPromoMarket, uiMarketDisplayCtx } from "./eventMarketsDisplay";
import { lineRawForSpreadOrTotal } from "./lineFromMarket";
import { decimalOddsFromDb, orderOneX2WireToDisplay, parseOdds } from "./oddsFormat";
import type { UiGroupedEvent, UiGroupedSport, UiMarket } from "./types";

export type EventMarketSectionKind =
   | "money"
   | "tq"
   | "spread"
   | "asian"
   | "total"
   | "btts"
   | "promo"
   | "yesNo"
   | "multiWay"
   | "overUnder"
   | "correctScore"
   | "playerProp"
   | "homeTotal"
   | "awayTotal"
   | "extra";

export type EventMarketSection = {
   kind: EventMarketSectionKind;
   layout: MarketLayout;
   title: string;
   tooltip: string;
   rows: UiMarket[];
};

function sortById(a: UiMarket, b: UiMarket): number {
   return a.id - b.id || a.player_id - b.player_id || a.period_id - b.period_id;
}

export type PlayerPropCluster = {
   playerKey: string;
   playerId: number;
   playerName: string;
   markets: UiMarket[];
};

function playerPropPlayerKey(m: UiMarket): string {
   return String(m.player_id ?? 0);
}

function sortPlayerPropLines(a: UiMarket, b: UiMarket): number {
   const la = a.line_value;
   const lb = b.line_value;
   if (la != null && lb != null && la !== lb) {
      return la - lb;
   }
   if (la != null && lb == null) {
      return -1;
   }
   if (la == null && lb != null) {
      return 1;
   }
   return sortById(a, b);
}

/** Last-scorer line in First/Next/Last Scorer (UI label "Last"). */
const NTH_SCORER_LAST_LINE = 99;

/**
 * Line used to rank a player in the table. Independent of the row's line picker
 * so switching first → last scorer does not reshuffle rows.
 * Uses the lowest line (first scorer / anytime 0.5 / Top 1), skipping last-scorer.
 */
function playerPropRankingMarket(markets: readonly UiMarket[]): UiMarket {
   const sorted = [...markets].sort(sortPlayerPropLines);
   const first = sorted[0];
   if (first == null) {
      throw new Error("playerPropRankingMarket: empty markets");
   }
   const forRank = sorted.filter((m) => m.line_value !== NTH_SCORER_LAST_LINE);
   return forRank[0] ?? first;
}

/** Yes / Over db odds for ranking; 0 and missing sort last. */
function playerPropRankingOddsDb(markets: readonly UiMarket[]): number | null {
   const yesOrOver = parseOdds(playerPropRankingMarket(markets).last_odds)[0] ?? 0;
   return yesOrOver > 0 ? yesOrOver : null;
}

function comparePlayerPropClusters(a: PlayerPropCluster, b: PlayerPropCluster): number {
   const oa = playerPropRankingOddsDb(a.markets);
   const ob = playerPropRankingOddsDb(b.markets);
   if (oa != null && ob != null && oa !== ob) {
      return oa - ob;
   }
   if (oa == null && ob != null) {
      return 1;
   }
   if (oa != null && ob == null) {
      return -1;
   }
   return a.playerName.localeCompare(b.playerName) || a.playerId - b.playerId;
}

/** Group player-prop markets in a section into one row per player (all lines). */
export function clusterPlayerPropMarkets(rows: readonly UiMarket[]): PlayerPropCluster[] {
   const buckets = new Map<string, UiMarket[]>();
   for (const m of rows) {
      const key = playerPropPlayerKey(m);
      let list = buckets.get(key);
      if (!list) {
         list = [];
         buckets.set(key, list);
      }
      list.push(m);
   }
   const clusters: PlayerPropCluster[] = [];
   for (const [playerKey, markets] of buckets) {
      const first = markets[0]!;
      clusters.push({
         playerKey,
         playerId: first.player_id ?? 0,
         playerName: first.player_name?.trim() || "Player",
         markets: [...markets].sort(sortPlayerPropLines),
      });
   }
   clusters.sort(comparePlayerPropClusters);
   return clusters;
}

function twoWayBalanceScore(m: UiMarket): number | null {
   const values = parseOdds(m.last_odds);
   if (values.length < 2) {
      return null;
   }
   return balanceScoreDb(values[0]!, values[1]!);
}

/** Prefer the line closest to even two-way odds; otherwise the first sorted line. */
export function defaultPlayerPropMarket(markets: readonly UiMarket[]): UiMarket {
   const sorted = [...markets].sort(sortPlayerPropLines);
   const first = sorted[0];
   if (first == null) {
      throw new Error("defaultPlayerPropMarket: empty markets");
   }
   let best = first;
   let bestScore = twoWayBalanceScore(first);
   for (const m of sorted.slice(1)) {
      const score = twoWayBalanceScore(m);
      if (score == null) {
         continue;
      }
      if (bestScore == null || score < bestScore) {
         best = m;
         bestScore = score;
      }
   }
   return best;
}

function marketKey(m: UiMarket): string {
   return `${m.id}:${m.period_id}:${m.player_id ?? 0}`;
}

function pickSoccerMain1x2(markets: UiMarket[]): UiMarket | undefined {
   const rt = markets.filter((m) => m.mkt_string === "1X2" && m.period_id === 1);
   if (rt.length) {
      return [...rt].sort(sortById)[0];
   }
   return undefined;
}

function pickNonSoccerMainMl(markets: UiMarket[]): UiMarket | undefined {
   const rows = markets.filter((m) => m.mkt_string === "ML" && m.period_id === 0);
   if (!rows.length) {
      return undefined;
   }
   return [...rows].sort(sortById)[0];
}

export function pickMainMoneylineMarket(markets: UiMarket[] | undefined, sportId: number): UiMarket | undefined {
   if (!markets?.length) {
      return undefined;
   }
   if (sportId === 1) {
      return pickSoccerMain1x2(markets);
   }
   return pickNonSoccerMainMl(markets);
}

function linePeriodOk(m: UiMarket, sportId: number): boolean {
   return isMainPeriod(sportId, m.period_id);
}

function balanceScoreDb(a: number, b: number): number | null {
   if (a === 0 && b === 0) {
      return null;
   }
   const da = decimalOddsFromDb(a);
   const db = decimalOddsFromDb(b);
   return Math.abs(da - 2) + Math.abs(db - 2);
}

function pickBestTwoWayLine(
   markets: UiMarket[] | undefined,
   sportId: number,
   pred: (m: UiMarket) => boolean,
   parseValues: (m: UiMarket) => [number, number],
   lineKind: "spread" | "total",
): { market: UiMarket; line: string; values: [number, number] } | null {
   if (!markets?.length) {
      return null;
   }
   const candidates = markets.filter((m) => pred(m) && linePeriodOk(m, sportId)).sort(sortById);
   if (!candidates.length) {
      return null;
   }

   type Scored = { market: UiMarket; line: string; values: [number, number]; score: number | null };
   const scored: Scored[] = candidates.map((m) => {
      const values = parseValues(m) as [number, number];
      const [x, y] = values;
      const line = lineRawForSpreadOrTotal({ ...m, id: m.id }, lineKind);
      return {
         market: m,
         line,
         values,
         score: balanceScoreDb(x, y),
      };
   });

   const balanced = scored.filter((s) => s.score !== null);
   const pick =
      balanced.length > 0
         ? balanced.reduce((best, s) => {
              if (s.score! < best.score!) {
                 return s;
              }
              if (s.score! > best.score!) {
                 return best;
              }
              return s.market.id < best.market.id ? s : best;
           })
         : scored[0]!;

   return { market: pick.market, line: pick.line, values: pick.values };
}

export function getMainOddsDetail(
   markets: UiMarket[] | undefined,
   sportId: number,
): { market: UiMarket; values: number[] } | null {
   const mk = pickMainMoneylineMarket(markets, sportId);
   if (!mk) {
      return null;
   }
   if (mk.mkt_string === "1X2" || mk.id === 1) {
      return { market: mk, values: orderOneX2WireToDisplay(parseOdds(mk.last_odds)) };
   }
   const [home, away] = parseOdds(mk.last_odds);
   return { market: mk, values: [home, away] };
}

function isSpreadFamily(m: UiMarket): boolean {
   const family = resolveMarketDisplay(m.id, uiMarketDisplayCtx(m)).family;
   return family === "spread" || family === "asian";
}

function isMatchTotalFamily(m: UiMarket): boolean {
   return resolveMarketDisplay(m.id, uiMarketDisplayCtx(m)).family === "total";
}

export function getSpreadOdds(
   markets: UiMarket[] | undefined,
   sportId: number,
): { market: UiMarket; line: string; values: number[] } | null {
   const r = pickBestTwoWayLine(
      markets,
      sportId,
      isSpreadFamily,
      (m) => parseOdds(m.last_odds) as [number, number],
      "spread",
   );
   if (!r) {
      return null;
   }
   const [home, away] = r.values;
   return { market: r.market, line: r.line, values: [home, away] };
}

export function getTotalOdds(
   markets: UiMarket[] | undefined,
   sportId: number,
): { market: UiMarket; line: string; values: number[] } | null {
   const r = pickBestTwoWayLine(
      markets,
      sportId,
      isMatchTotalFamily,
      (m) => parseOdds(m.last_odds) as [number, number],
      "total",
   );
   if (!r) {
      return null;
   }
   const [o0, o1] = r.values;
   return { market: r.market, line: r.line, values: [o0, o1] };
}

export function extraMarketsCount(markets: UiMarket[] | undefined, sportId: number): number {
   if (!markets?.length) {
      return 0;
   }
   const featured = new Set<string>();
   const main = pickMainMoneylineMarket(markets, sportId);
   const spread = getSpreadOdds(markets, sportId);
   const total = getTotalOdds(markets, sportId);
   if (main) {
      featured.add(marketKey(main));
   }
   if (spread) {
      featured.add(marketKey(spread.market));
   }
   if (total) {
      featured.add(marketKey(total.market));
   }
   return markets.filter((m) => !featured.has(marketKey(m)) && !isPromoMarket(m)).length;
}

export function eventHasAnyNonZeroOdd(ev: UiGroupedEvent): boolean {
   const mkts = ev.markets;
   if (mkts == null || mkts.length === 0) {
      return false;
   }
   for (const m of mkts) {
      for (const v of parseOdds(m.last_odds)) {
         if (v !== 0) {
            return true;
         }
      }
   }
   return false;
}

export function filterGroupedSportsForHome(tree: readonly UiGroupedSport[]): UiGroupedSport[] {
   return tree
      .map((sport) => ({
         ...sport,
         leagues: sport.leagues
            .map((league) => ({
               ...league,
               events: league.events.filter(eventHasAnyNonZeroOdd),
            }))
            .filter((league) => league.events.length > 0),
      }))
      .filter((sport) => sport.leagues.length > 0);
}

export function inferBetColumn(mktString: string, mktWireId?: number): BetColumn {
   if (mktString === "PROMO" || mktWireId === 9) {
      return "main";
   }
   if (mktWireId != null) {
      const family = resolveMarketDisplay(mktWireId).family;
      if (family === "spread" || family === "asian") {
         return "spread";
      }
      if (family === "total" || family === "homeTotal" || family === "awayTotal") {
         return "total";
      }
      return "main";
   }
   if (mktString === "1X2" || mktString === "ML") {
      return "main";
   }
   if (mktString.startsWith("AH ")) {
      return "spread";
   }
   if (mktString.startsWith("OU ")) {
      return "total";
   }
   return "main";
}

function familyToKind(m: UiMarket): EventMarketSectionKind {
   if (isSoccerToQualify(m.id, m.mkt_string, m.sport_id)) {
      return "tq";
   }
   const family = resolveMarketDisplay(m.id, uiMarketDisplayCtx(m)).family;
   switch (family) {
      case "promo":
         return "promo";
      case "oneX2":
      case "ml":
         return "money";
      case "btts":
         return "btts";
      case "spread":
         return "spread";
      case "asian":
         return "asian";
      case "total":
         return "total";
      case "homeTotal":
         return "homeTotal";
      case "awayTotal":
         return "awayTotal";
      case "correctScore":
         return "correctScore";
      case "playerProp":
         return "playerProp";
      case "dc":
      case "ftBtts":
      case "htFt":
      case "bttsOu":
      case "ftOu":
      case "moneyOdds":
         return "multiWay";
      default:
         return "extra";
   }
}

function sectionPlayerPropBase(rows: readonly UiMarket[]): number {
   let min = Number.POSITIVE_INFINITY;
   for (const m of rows) {
      const base = playerPropBase(m.id);
      if (base != null && base < min) {
         min = base;
      }
   }
   return Number.isFinite(min) ? min : Number.POSITIVE_INFINITY;
}

const SECTION_ORDER: readonly EventMarketSectionKind[] = [
   "promo",
   "money",
   "tq",
   "btts",
   "spread",
   "asian",
   "total",
   "homeTotal",
   "awayTotal",
   "yesNo",
   "multiWay",
   "overUnder",
   "correctScore",
   "playerProp",
   "extra",
];

export function groupMarketsForEventPage(markets: UiMarket[], teams?: { homeName: string; awayName: string }): EventMarketSection[] {
   const sorted = [...markets].sort(sortById);
   const buckets = new Map<string, UiMarket[]>();
   for (const m of sorted) {
      const ctx = uiMarketDisplayCtx(m, teams);
      const key = eventGroupKey(m.id, ctx);
      let list = buckets.get(key);
      if (!list) {
         list = [];
         buckets.set(key, list);
      }
      list.push(m);
   }

   const sections: EventMarketSection[] = [];
   for (const [, rows] of buckets) {
      const first = rows[0]!;
      const ctx = uiMarketDisplayCtx(first, teams);
      const resolved = resolveMarketDisplay(first.id, ctx);
      const kind = isPlayerProp(first.id) ? "playerProp" : familyToKind(first);
      sections.push({
         kind,
         layout: resolved.layout,
         title: resolved.groupTitle,
         tooltip: resolved.groupTooltip,
         rows: [...rows].sort(sortById),
      });
   }

   sections.sort((a, b) => {
      const ia = SECTION_ORDER.indexOf(a.kind);
      const ib = SECTION_ORDER.indexOf(b.kind);
      if (ia !== ib) {
         return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      }
      if (a.kind === "playerProp" && b.kind === "playerProp") {
         const ba = sectionPlayerPropBase(a.rows);
         const bb = sectionPlayerPropBase(b.rows);
         if (ba !== bb) {
            return ba - bb;
         }
      }
      return a.title.localeCompare(b.title);
   });
   return sections;
}
