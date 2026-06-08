import type { BetColumn } from "../betting/types";
import {
   handicapTableKind,
   isSoccerToQualify,
   moneylineSectionTitle,
   totalsSectionTitle,
   type EventMarketSectionKind,
} from "./eventMarketsDisplay";
import { lineRawForSpreadOrTotal } from "./lineFromMarket";
import { decimalOddsFromDb, orderOneX2WireToDisplay, parseOdds } from "./oddsFormat";
import type { UiGroupedEvent, UiGroupedSport, UiMarket } from "./types";

export type { EventMarketSectionKind } from "./eventMarketsDisplay";

export type EventMarketSection = {
   kind: EventMarketSectionKind;
   title: string;
   rows: UiMarket[];
};

function sortById(a: UiMarket, b: UiMarket): number {
   return a.id - b.id;
}

/** Soccer: main 1X2 is regular time (`period_id === 1`). Omit cup-only `period_id === 0` 1X2 when RT exists. */
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

/** Front-page spread/total lines use RT for soccer, full game for other sports. */
function linePeriodOk(m: UiMarket, sportId: number): boolean {
   return sportId === 1 ? m.period_id === 1 : m.period_id === 0;
}

/** Lower is closer to 2.0/2.0 on both sides. `null` = both odds zero (not eligible as “balanced”). */
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
      const line = lineRawForSpreadOrTotal(m, lineKind);
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
   if (mk.mkt_string === "1X2") {
      return { market: mk, values: orderOneX2WireToDisplay(parseOdds(mk.last_odds)) };
   }
   const [home, away] = parseOdds(mk.last_odds);
   return { market: mk, values: [home, away] };
}

export function getSpreadOdds(
   markets: UiMarket[] | undefined,
   sportId: number,
): { market: UiMarket; line: string; values: number[] } | null {
   const r = pickBestTwoWayLine(
      markets,
      sportId,
      (m) => m.mkt_string.startsWith("AH "),
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
      (m) => m.mkt_string.startsWith("OU "),
      (m) => parseOdds(m.last_odds) as [number, number],
      "total",
   );
   if (!r) {
      return null;
   }
   const [o0, o1] = r.values;
   return { market: r.market, line: r.line, values: [o0, o1] };
}

export function extraMarketsCount(markets: UiMarket[] | undefined): number {
   if (!markets || markets.length <= 3) {
      return 0;
   }
   return markets.length - 3;
}

/** True if some market has at least one non-zero odds entry in `last_odds` (DB scale). */
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

/** Drops events (and empty leagues / sports) where every market’s odds are all zero. */
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

export function inferBetColumn(mktString: string): BetColumn {
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

function isMoneyCore(m: UiMarket): boolean {
   return m.mkt_string === "1X2" || m.mkt_string === "ML";
}

export function groupMarketsForEventPage(markets: UiMarket[]): EventMarketSection[] {
   const sorted = [...markets].sort(sortById);
   const money = sorted.filter(isMoneyCore);
   const tq = sorted.filter((m) => isSoccerToQualify(m, m.sport_id));
   const btts = sorted.filter((m) => m.mkt_string === "BTTS");
   const ah = sorted.filter((m) => m.mkt_string.startsWith("AH "));
   const spreadRows = ah.filter((m) => handicapTableKind(m) === "spread").sort(sortById);
   const asianRows = ah.filter((m) => handicapTableKind(m) === "asian").sort(sortById);
   const totals = sorted.filter((m) => m.mkt_string.startsWith("OU ")).sort(sortById);
   const rest = sorted.filter(
      (m) =>
         !isMoneyCore(m) &&
         !isSoccerToQualify(m, m.sport_id) &&
         m.mkt_string !== "BTTS" &&
         !m.mkt_string.startsWith("AH ") &&
         !m.mkt_string.startsWith("OU ")
   );
   const byMkt = new Map<string, UiMarket[]>();
   for (const m of rest) {
      const k = m.mkt_string;
      let list = byMkt.get(k);
      if (!list) {
         list = [];
         byMkt.set(k, list);
      }
      list.push(m);
   }
   const extraSections: EventMarketSection[] = [...byMkt.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, rows]) => ({
         kind: "extra" as const,
         title,
         rows: [...rows].sort(sortById),
      }));

   const out: EventMarketSection[] = [];
   if (money.length) {
      out.push({ kind: "money", title: moneylineSectionTitle(money), rows: money });
   }
   if (tq.length) {
      out.push({ kind: "tq", title: "To Qualify", rows: tq });
   }
   if (btts.length) {
      out.push({ kind: "btts", title: "Both Teams To Score", rows: btts });
   }
   if (spreadRows.length) {
      out.push({ kind: "spread", title: "Spread", rows: spreadRows });
   }
   if (asianRows.length) {
      out.push({ kind: "asian", title: "Asian Handicap", rows: asianRows });
   }
   if (totals.length) {
      out.push({ kind: "total", title: totalsSectionTitle(totals), rows: totals });
   }
   out.push(...extraSections);
   return out;
}
