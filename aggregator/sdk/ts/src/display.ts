import { numSidesForMkt } from './helpers.js';

/** 1X2 UI columns are home / draw / away; chain sides are home / away / draw. */
export const ONE_X2_DISPLAY_COLUMN_TO_CHAIN_SIDE = [0, 2, 1] as const;

export const PROMO_MKT_ID = 9;

export type MarketLayout =
   | 'twoWayTeams'
   | 'threeWay1x2'
   | 'yesNo'
   | 'handicapPair'
   | 'overUnder'
   | 'multiWay'
   | 'correctScore'
   | 'playerOverUnder'
   | 'playerYesNo'
   | 'promo'
   | 'moneyOdds';

export type MarketFamily =
   | 'ml'
   | 'oneX2'
   | 'btts'
   | 'dc'
   | 'ftBtts'
   | 'htFt'
   | 'promo'
   | 'moneyOdds'
   | 'total'
   | 'spread'
   | 'asian'
   | 'homeTotal'
   | 'awayTotal'
   | 'bttsOu'
   | 'ftOu'
   | 'correctScore'
   | 'playerProp'
   | 'unknown';

export type MarketDisplayCtx = {
   sport?: number;
   homeName?: string;
   awayName?: string;
   playerId?: number;
   playerName?: string;
   period?: number;
   lineValue?: number | null;
   mktString?: string;
};

export type ResolvedMarketDisplay = {
   family: MarketFamily;
   layout: MarketLayout;
   groupTitle: string;
   groupTooltip: string;
   shortName: string;
   sideCount: number;
   chainSides: readonly string[];
   line: number | null;
};

type LineSpec =
   | { kind: 'none' }
   | { kind: 'total'; base: number; mult: number }
   | { kind: 'spread'; base: number; mult: number }
   | { kind: 'correctScore' }
   | { kind: 'prop'; base: number; encoding: 'halfLine' | 'topX' | 'nthScorer' };

type CatalogRow = {
   family: MarketFamily;
   layout: MarketLayout;
   groupTitle: string;
   groupTooltip: string;
   shortName: string;
   chainSides: readonly string[];
   line: LineSpec;
};

const PERIOD_CAPTION: Record<number, string> = {
   0: 'Result incl OT',
   1: 'Regular Time',
   2: 'First Half',
   3: 'Second Half',
   11: 'Period 1',
   12: 'Period 2',
   13: 'Period 3',
   14: 'Period 4',
   21: 'Overtime',
   22: 'ET First Half',
   23: 'ET Second Half',
   24: 'Penalties',
   25: 'First 10 Penalties',
   30: 'Games',
   31: 'Set 1 Games',
   32: 'Set 2 Games',
};

const EXACT: Record<number, CatalogRow> = {
   0: {
      family: 'ml',
      layout: 'twoWayTeams',
      groupTitle: 'Moneyline',
      groupTooltip: 'Pick the match winner. Includes overtime where used.',
      shortName: 'ML',
      chainSides: ['{home}', '{away}'],
      line: { kind: 'none' },
   },
   1: {
      family: 'oneX2',
      layout: 'threeWay1x2',
      groupTitle: 'Full Time Result',
      groupTooltip: 'Home, draw, or away in regular time (soccer) or listed period.',
      shortName: '1X2',
      chainSides: ['{home}', '{away}', 'Draw'],
      line: { kind: 'none' },
   },
   4: {
      family: 'btts',
      layout: 'yesNo',
      groupTitle: 'Both Teams To Score',
      groupTooltip: 'Will both teams score at least once in the listed period?',
      shortName: 'BTTS',
      chainSides: ['Yes', 'No'],
      line: { kind: 'none' },
   },
   5: {
      family: 'dc',
      layout: 'multiWay',
      groupTitle: 'Double Chance',
      groupTooltip: 'Covers two of the three 1X2 outcomes (not home / not away / not draw).',
      shortName: 'DC',
      chainSides: ['Not {home}', 'Not {away}', 'Not Draw'],
      line: { kind: 'none' },
   },
   6: {
      family: 'ftBtts',
      layout: 'multiWay',
      groupTitle: 'Result & BTTS',
      groupTooltip: 'Match result combined with both teams to score yes or no.',
      shortName: 'FT+BTTS',
      chainSides: [
         '{home} & Yes',
         '{away} & Yes',
         'Draw & Yes',
         '{home} & No',
         '{away} & No',
         'Draw & No',
      ],
      line: { kind: 'none' },
   },
   7: {
      family: 'htFt',
      layout: 'multiWay',
      groupTitle: 'Half Time / Full Time',
      groupTooltip: 'Result at half time paired with the full-time result.',
      shortName: 'HT/FT',
      chainSides: [
         '{home}/{home}',
         '{home}/{away}',
         '{home}/Draw',
         '{away}/{home}',
         '{away}/{away}',
         '{away}/Draw',
         'Draw/{home}',
         'Draw/{away}',
         'Draw/Draw',
      ],
      line: { kind: 'none' },
   },
   9: {
      family: 'promo',
      layout: 'promo',
      groupTitle: 'Promotions',
      groupTooltip: 'Boosted promotional market. One qualifying side.',
      shortName: 'Promo',
      chainSides: ['Yes'],
      line: { kind: 'none' },
   },
};

type BandRow = CatalogRow & { min: number; max: number };

const BANDS: readonly BandRow[] = [
   {
      min: 10,
      max: 50,
      family: 'moneyOdds',
      layout: 'moneyOdds',
      groupTitle: 'Money Odds',
      groupTooltip: 'Named money market: win or not win.',
      shortName: 'MO',
      chainSides: ['Win', 'Not win'],
      line: { kind: 'none' },
   },
   {
      min: 51,
      max: 99,
      family: 'total',
      layout: 'overUnder',
      groupTitle: 'Total Goals',
      groupTooltip: 'Over or under the listed goal line (quarter-goal ladder).',
      shortName: 'OU',
      chainSides: ['Over', 'Under'],
      line: { kind: 'total', base: 50, mult: 4 },
   },
   {
      min: 100,
      max: 299,
      family: 'spread',
      layout: 'handicapPair',
      groupTitle: 'Spread',
      groupTooltip: 'Point spread.',
      shortName: 'AH',
      chainSides: ['{home}', '{away}'],
      line: { kind: 'spread', base: 200, mult: 2 },
   },
   {
      min: 300,
      max: 499,
      family: 'asian',
      layout: 'handicapPair',
      groupTitle: 'Asian Handicap',
      groupTooltip: 'Asian handicap including quarter lines.',
      shortName: 'AH',
      chainSides: ['{home}', '{away}'],
      line: { kind: 'spread', base: 400, mult: 4 },
   },
   {
      min: 1000,
      max: 1999,
      family: 'total',
      layout: 'overUnder',
      groupTitle: 'Total Points',
      groupTooltip: 'Over or under the listed points line.',
      shortName: 'OU',
      chainSides: ['Over', 'Under'],
      line: { kind: 'total', base: 1000, mult: 2 },
   },
   {
      min: 2000,
      max: 2999,
      family: 'homeTotal',
      layout: 'overUnder',
      groupTitle: 'Home Total',
      groupTooltip: 'Over or under the home team\'s points or goals.',
      shortName: 'HOU',
      chainSides: ['Over', 'Under'],
      line: { kind: 'total', base: 2000, mult: 2 },
   },
   {
      min: 3000,
      max: 3999,
      family: 'awayTotal',
      layout: 'overUnder',
      groupTitle: 'Away Total',
      groupTooltip: 'Over or under the away team\'s points or goals.',
      shortName: 'AOU',
      chainSides: ['Over', 'Under'],
      line: { kind: 'total', base: 3000, mult: 2 },
   },
   {
      min: 4000,
      max: 4999,
      family: 'bttsOu',
      layout: 'multiWay',
      groupTitle: 'BTTS & Total',
      groupTooltip: 'Both teams to score combined with over/under the listed line.',
      shortName: 'BTTS+OU',
      chainSides: ['Yes & Over', 'Yes & Under', 'No & Over', 'No & Under'],
      line: { kind: 'total', base: 4000, mult: 2 },
   },
   {
      min: 5000,
      max: 5999,
      family: 'ftOu',
      layout: 'multiWay',
      groupTitle: 'Result & Total',
      groupTooltip: 'Match result combined with over/under the listed line.',
      shortName: 'FT+OU',
      chainSides: [
         '{home} & Over',
         '{away} & Over',
         'Draw & Over',
         '{home} & Under',
         '{away} & Under',
         'Draw & Under',
      ],
      line: { kind: 'total', base: 5000, mult: 2 },
   },
   {
      min: 10000,
      max: 10909,
      family: 'correctScore',
      layout: 'correctScore',
      groupTitle: 'Correct Score',
      groupTooltip: 'Exact final score. One side per scoreline.',
      shortName: 'CS',
      chainSides: ['{score}'],
      line: { kind: 'correctScore' },
   },
];

type PropBase = {
   base: number;
   nextBase: number;
   statName: string;
   tooltip: string;
   encoding: 'halfLine' | 'topX' | 'nthScorer';
};

const PROP_BASES: readonly PropBase[] = [
   { base: 11000, nextBase: 11100, statName: 'Top Place', tooltip: 'Player finishes in the top X places.', encoding: 'topX' },
   { base: 11100, nextBase: 11200, statName: 'First/Next/Last Scorer', tooltip: 'Player scores first, next, or last.', encoding: 'nthScorer' },
   { base: 11200, nextBase: 11300, statName: 'Goals', tooltip: 'Player goal total. Anytime scorer is over 0.5.', encoding: 'halfLine' },
   { base: 11300, nextBase: 11400, statName: 'Shots On Target', tooltip: 'Player shots on target.', encoding: 'halfLine' },
   { base: 11400, nextBase: 11500, statName: 'Shots', tooltip: 'Player shots.', encoding: 'halfLine' },
   { base: 11500, nextBase: 11600, statName: 'To Be Fouled', tooltip: 'Times the player is fouled.', encoding: 'halfLine' },
   { base: 11600, nextBase: 11700, statName: 'Fouls', tooltip: 'Fouls committed by the player.', encoding: 'halfLine' },
   { base: 11700, nextBase: 11800, statName: 'Tackles', tooltip: 'Tackles made.', encoding: 'halfLine' },
   { base: 11800, nextBase: 11900, statName: 'Yellow Cards', tooltip: 'Yellow cards received.', encoding: 'halfLine' },
   { base: 11900, nextBase: 12000, statName: 'Red Cards', tooltip: 'Red cards received.', encoding: 'halfLine' },
   { base: 12000, nextBase: 12100, statName: 'Saves', tooltip: 'Goalkeeper saves.', encoding: 'halfLine' },
   { base: 12100, nextBase: 12200, statName: 'Assists', tooltip: 'Assists made.', encoding: 'halfLine' },
   { base: 13000, nextBase: 13100, statName: 'Touchdowns', tooltip: 'Touchdowns scored.', encoding: 'halfLine' },
   { base: 13100, nextBase: 13200, statName: 'Passing Touchdowns', tooltip: 'Passing touchdowns.', encoding: 'halfLine' },
   { base: 13200, nextBase: 13300, statName: 'Interceptions Thrown', tooltip: 'Interceptions thrown.', encoding: 'halfLine' },
   { base: 13300, nextBase: 13400, statName: 'Rush Attempts', tooltip: 'Rushing attempts.', encoding: 'halfLine' },
   { base: 13400, nextBase: 13500, statName: 'Receptions', tooltip: 'Receptions.', encoding: 'halfLine' },
   { base: 13500, nextBase: 13600, statName: 'Sacks', tooltip: 'Sacks recorded.', encoding: 'halfLine' },
   { base: 13600, nextBase: 13700, statName: 'Kicking Points', tooltip: 'Kicker scoring points.', encoding: 'halfLine' },
   { base: 13700, nextBase: 13800, statName: 'Interceptions Made', tooltip: 'Interceptions made.', encoding: 'halfLine' },
   { base: 13800, nextBase: 13900, statName: 'Field Goals', tooltip: 'Field goals made.', encoding: 'halfLine' },
   { base: 13900, nextBase: 14000, statName: 'Player Prop', tooltip: 'Player proposition.', encoding: 'halfLine' },
   { base: 14000, nextBase: 14100, statName: 'Pitcher Strikeouts', tooltip: 'Pitcher strikeouts.', encoding: 'halfLine' },
   { base: 14100, nextBase: 14200, statName: 'Earned Runs', tooltip: 'Earned runs allowed.', encoding: 'halfLine' },
   { base: 14200, nextBase: 14300, statName: 'Pitcher Outs', tooltip: 'Outs recorded by the pitcher.', encoding: 'halfLine' },
   { base: 14300, nextBase: 14400, statName: 'Hits Allowed', tooltip: 'Hits allowed by the pitcher.', encoding: 'halfLine' },
   { base: 14400, nextBase: 14500, statName: 'Walks Issued', tooltip: 'Walks issued by the pitcher.', encoding: 'halfLine' },
   { base: 14500, nextBase: 15000, statName: 'Player Prop', tooltip: 'Player proposition.', encoding: 'halfLine' },
   { base: 15000, nextBase: 15100, statName: 'Home Runs', tooltip: 'Batter home runs.', encoding: 'halfLine' },
   { base: 15100, nextBase: 15200, statName: 'Runs', tooltip: 'Batter runs scored.', encoding: 'halfLine' },
   { base: 15200, nextBase: 15300, statName: 'Hits', tooltip: 'Batter hits.', encoding: 'halfLine' },
   { base: 15300, nextBase: 15400, statName: 'Total Bases', tooltip: 'Batter total bases.', encoding: 'halfLine' },
   { base: 15400, nextBase: 15500, statName: 'RBIs', tooltip: 'Runs batted in.', encoding: 'halfLine' },
   { base: 15500, nextBase: 15600, statName: 'Batter Strikeouts', tooltip: 'Batter strikeouts.', encoding: 'halfLine' },
   { base: 15600, nextBase: 15700, statName: 'Stolen Bases', tooltip: 'Stolen bases.', encoding: 'halfLine' },
   { base: 15700, nextBase: 15800, statName: 'Batter Strikeouts', tooltip: 'Batter strikeouts.', encoding: 'halfLine' },
   { base: 15800, nextBase: 15900, statName: 'Singles', tooltip: 'Singles.', encoding: 'halfLine' },
   { base: 15900, nextBase: 16000, statName: 'Doubles', tooltip: 'Doubles.', encoding: 'halfLine' },
   { base: 16000, nextBase: 16100, statName: 'Triples', tooltip: 'Triples.', encoding: 'halfLine' },
   { base: 16100, nextBase: 16200, statName: 'Total Hits + Runs + RBIs', tooltip: 'Hits + runs + RBIs.', encoding: 'halfLine' },
   { base: 16200, nextBase: 20000, statName: 'Player Prop', tooltip: 'Player proposition.', encoding: 'halfLine' },
   { base: 20000, nextBase: 21000, statName: 'Passing Yards', tooltip: 'Passing yards.', encoding: 'halfLine' },
   { base: 21000, nextBase: 22000, statName: 'Passing + Rushing Yards', tooltip: 'Passing plus rushing yards.', encoding: 'halfLine' },
   { base: 22000, nextBase: 22500, statName: 'Pass Attempts', tooltip: 'Pass attempts.', encoding: 'halfLine' },
   { base: 22500, nextBase: 23000, statName: 'Pass Completions', tooltip: 'Pass completions.', encoding: 'halfLine' },
   { base: 23000, nextBase: 23500, statName: 'Longest Completion', tooltip: 'Longest pass completion (yards).', encoding: 'halfLine' },
   { base: 23500, nextBase: 24000, statName: 'Rushing Yards', tooltip: 'Rushing yards.', encoding: 'halfLine' },
   { base: 24000, nextBase: 24500, statName: 'Rushing + Receiving Yards', tooltip: 'Rushing plus receiving yards.', encoding: 'halfLine' },
   { base: 24500, nextBase: 25000, statName: 'Longest Rush', tooltip: 'Longest rush (yards).', encoding: 'halfLine' },
   { base: 25000, nextBase: 25500, statName: 'Receiving Yards', tooltip: 'Receiving yards.', encoding: 'halfLine' },
   { base: 25500, nextBase: 26000, statName: 'Longest Reception', tooltip: 'Longest reception (yards).', encoding: 'halfLine' },
   { base: 26000, nextBase: 29000, statName: 'Player Prop', tooltip: 'Player proposition.', encoding: 'halfLine' },
   { base: 29000, nextBase: 65536, statName: 'Fantasy Points', tooltip: 'Fantasy points.', encoding: 'halfLine' },
];

function team(name: string | undefined, fallback: string): string {
   const t = name?.trim();
   return t !== undefined && t !== '' ? t : fallback;
}

function fillSideTemplate(template: string, ctx: MarketDisplayCtx, extras?: { score?: string; line?: string }): string {
   return template
      .replaceAll('{home}', team(ctx.homeName, 'Home'))
      .replaceAll('{away}', team(ctx.awayName, 'Away'))
      .replaceAll('{player}', ctx.playerName?.trim() || 'Player')
      .replaceAll('{score}', extras?.score ?? '')
      .replaceAll('{line}', extras?.line ?? '');
}

function decodeBandLine(spec: LineSpec, mkt: number): number | null {
   if (spec.kind === 'total' || spec.kind === 'spread') {
      return (mkt - spec.base) / spec.mult;
   }
   if (spec.kind === 'correctScore') {
      return null;
   }
   if (spec.kind === 'prop') {
      if (spec.encoding === 'halfLine') {
         return (mkt - spec.base) / 2;
      }
      if (spec.encoding === 'topX') {
         return mkt - spec.base;
      }
      return mkt - spec.base;
   }
   return null;
}

function decodeCorrectScore(mkt: number): { home: number; away: number } | null {
   if (mkt < 10000 || mkt > 10909) {
      return null;
   }
   const n = mkt - 10000;
   return { home: Math.floor(n / 100), away: n % 100 };
}

function findPropBase(mkt: number): PropBase | null {
   if (mkt < 11000) {
      return null;
   }
   let found: PropBase | null = null;
   for (const row of PROP_BASES) {
      if (mkt >= row.base && mkt < row.nextBase) {
         found = row;
         break;
      }
      if (mkt >= row.base) {
         found = row;
      }
   }
   return found;
}

function propCatalog(mkt: number): CatalogRow | null {
   const prop = findPropBase(mkt);
   if (prop == null) {
      return null;
   }
   const yesNo = prop.encoding === 'topX' || prop.encoding === 'nthScorer';
   return {
      family: 'playerProp',
      layout: yesNo ? 'playerYesNo' : 'playerOverUnder',
      groupTitle: 'Player Props',
      groupTooltip: prop.tooltip,
      shortName: prop.statName,
      chainSides: yesNo ? ['Yes', 'No'] : ['Over', 'Under'],
      line: { kind: 'prop', base: prop.base, encoding: prop.encoding },
   };
}

function lookupRow(mkt: number): CatalogRow | null {
   const exact = EXACT[mkt];
   if (exact !== undefined) {
      return exact;
   }
   for (const band of BANDS) {
      if (mkt >= band.min && mkt <= band.max) {
         return band;
      }
   }
   return propCatalog(mkt);
}

function lineFromCtxOrWire(mkt: number, row: CatalogRow, ctx: MarketDisplayCtx): number | null {
   if (ctx.lineValue !== null && ctx.lineValue !== undefined && Number.isFinite(ctx.lineValue)) {
      return ctx.lineValue;
   }
   return decodeBandLine(row.line, mkt);
}

export function isPlayerProp(mkt: number): boolean {
   return mkt >= 11000;
}

export function isPromoMarketId(mkt: number): boolean {
   return mkt === PROMO_MKT_ID;
}

/** Soccer `mkt` 0 with API string `TQ` is to-qualify, not moneyline. */
export function isSoccerToQualify(mkt: number, mktString: string | undefined, sport?: number): boolean {
   return (sport === undefined || sport === 1) && mkt === 0 && (mktString ?? '').toUpperCase() === 'TQ';
}

export function decodeMarketLine(mkt: number): number | null {
   const row = lookupRow(mkt);
   if (row == null) {
      return null;
   }
   return decodeBandLine(row.line, mkt);
}

export function periodCaption(period: number): string {
   return PERIOD_CAPTION[period] ?? `Period ${period}`;
}

export function isMainPeriod(sport: number, period: number): boolean {
   return sport === 1 ? period === 1 : period === 0;
}

export function playerPropStatName(mkt: number): string {
   return findPropBase(mkt)?.statName ?? 'Player prop';
}

/** Catalog band start for a player-prop `mkt`, or null if not a prop. */
export function playerPropBase(mkt: number): number | null {
   return findPropBase(mkt)?.base ?? null;
}

export function resolveMarketDisplay(mkt: number, ctx: MarketDisplayCtx = {}): ResolvedMarketDisplay {
   if (isSoccerToQualify(mkt, ctx.mktString, ctx.sport)) {
      return {
         family: 'ml',
         layout: 'twoWayTeams',
         groupTitle: 'To Qualify',
         groupTooltip: 'Which team advances from this tie.',
         shortName: 'TQ',
         sideCount: 2,
         chainSides: ['{home}', '{away}'],
         line: null,
      };
   }
   const row = lookupRow(mkt);
   const sideCount = numSidesForMkt(mkt) ?? row?.chainSides.length ?? 2;
   if (row == null) {
      return {
         family: 'unknown',
         layout: 'multiWay',
         groupTitle: `Market ${mkt}`,
         groupTooltip: '',
         shortName: `#${mkt}`,
         sideCount,
         chainSides: Array.from({ length: sideCount }, (_, i) => `Side ${i}`),
         line: null,
      };
   }
   let groupTitle = row.groupTitle;
   if (row.family === 'playerProp') {
      groupTitle = playerPropStatName(mkt);
   }
   if (row.family === 'homeTotal') {
      groupTitle = `${team(ctx.homeName, 'Home')} Total`;
   }
   if (row.family === 'awayTotal') {
      groupTitle = `${team(ctx.awayName, 'Away')} Total`;
   }
   return {
      family: row.family,
      layout: row.layout,
      groupTitle,
      groupTooltip: row.groupTooltip,
      shortName: row.shortName,
      sideCount,
      chainSides: row.chainSides,
      line: lineFromCtxOrWire(mkt, row, ctx),
   };
}

export function groupTitle(mkt: number, ctx: MarketDisplayCtx = {}): string {
   return resolveMarketDisplay(mkt, ctx).groupTitle;
}

export function groupTooltip(mkt: number, ctx: MarketDisplayCtx = {}): string {
   return resolveMarketDisplay(mkt, ctx).groupTooltip;
}

export function shortMarketName(mkt: number, ctx: MarketDisplayCtx = {}): string {
   return resolveMarketDisplay(mkt, ctx).shortName;
}

function formatLine(n: number | null, kind: 'spread' | 'total'): string {
   if (n === null || !Number.isFinite(n)) {
      return '';
   }
   if (kind === 'spread') {
      if (n > 0) {
         return `+${n}`;
      }
      return String(n);
   }
   return String(n);
}

export function sideLabel(mkt: number, side: number, ctx: MarketDisplayCtx = {}): string {
   const resolved = resolveMarketDisplay(mkt, ctx);
   const score = decodeCorrectScore(mkt);
   const extras = {
      score: score != null ? `${score.home}-${score.away}` : '',
      line: formatLine(resolved.line, resolved.layout === 'handicapPair' ? 'spread' : 'total'),
   };
   const template = resolved.chainSides[side] ?? `Side ${side}`;
   let label = fillSideTemplate(template, ctx, extras);
   if (resolved.layout === 'handicapPair' && resolved.line !== null) {
      const line = side === 0 ? resolved.line : -resolved.line;
      const shown = formatLine(line, 'spread');
      if (shown !== '') {
         label = `${label} ${shown}`;
      }
   }
   if (resolved.layout === 'playerOverUnder' && resolved.line !== null && (side === 0 || side === 1)) {
      const shown = formatLine(resolved.line, 'total');
      if (shown !== '') {
         label = `${label} ${shown}`;
      }
   }
   if (resolved.layout === 'overUnder' && resolved.line !== null && (side === 0 || side === 1)) {
      const shown = formatLine(resolved.line, 'total');
      if (shown !== '') {
         label = `${label} ${shown}`;
      }
   }
   return label;
}

export function sideLabels(mkt: number, ctx: MarketDisplayCtx = {}): string[] {
   const resolved = resolveMarketDisplay(mkt, ctx);
   return Array.from({ length: resolved.sideCount }, (_, i) => sideLabel(mkt, i, ctx));
}

export function displayColumnToChainSide(mkt: number, displayIndex: number, ctx: MarketDisplayCtx = {}): number {
   if (resolveMarketDisplay(mkt, ctx).layout === 'threeWay1x2') {
      if (displayIndex >= 0 && displayIndex < ONE_X2_DISPLAY_COLUMN_TO_CHAIN_SIDE.length) {
         return ONE_X2_DISPLAY_COLUMN_TO_CHAIN_SIDE[displayIndex]!;
      }
   }
   return displayIndex;
}

/** Reorder chain odds [home, away, draw] to UI [home, draw, away]. */
export function orderOneX2WireToDisplay(values: readonly number[]): number[] {
   return [values[0] ?? 0, values[2] ?? 0, values[1] ?? 0];
}

export function fullMarketName(mkt: number, ctx: MarketDisplayCtx = {}): string {
   const resolved = resolveMarketDisplay(mkt, ctx);
   if (isSoccerToQualify(mkt, ctx.mktString, ctx.sport)) {
      return 'To Qualify';
   }
   if (resolved.family === 'playerProp') {
      const player = ctx.playerName?.trim() || 'Player';
      const stat = playerPropStatName(mkt);
      const line = resolved.line;
      if (resolved.layout === 'playerYesNo') {
         if (findPropBase(mkt)?.encoding === 'topX' && line != null) {
            return `${player} Top ${line}`;
         }
         if (findPropBase(mkt)?.encoding === 'nthScorer' && line != null) {
            return line === 99 ? `${player} Last scorer` : `${player} ${line}th scorer`;
         }
         return `${player} ${stat}`;
      }
      const shown = formatLine(line, 'total');
      return shown !== '' ? `${player} ${stat} ${shown}` : `${player} ${stat}`;
   }
   if (resolved.layout === 'correctScore') {
      const score = decodeCorrectScore(mkt);
      return score != null ? `Correct score ${score.home}-${score.away}` : 'Correct score';
   }
   if (resolved.layout === 'overUnder' || resolved.layout === 'handicapPair') {
      const shown = formatLine(resolved.line, resolved.layout === 'handicapPair' ? 'spread' : 'total');
      return shown !== '' ? `${resolved.groupTitle} ${shown}` : resolved.groupTitle;
   }
   return resolved.groupTitle;
}

export function betSlipLabel(mkt: number, side: number, ctx: MarketDisplayCtx = {}): string {
   const resolved = resolveMarketDisplay(mkt, ctx);
   const pick = sideLabel(mkt, side, ctx);
   if (resolved.family === 'playerProp') {
      return `${fullMarketName(mkt, ctx)} · ${pick}`;
   }
   if (resolved.layout === 'threeWay1x2') {
      return `${pick} (1X2)`;
   }
   if (resolved.shortName === 'TQ') {
      return `${pick} (To qualify)`;
   }
   if (resolved.layout === 'twoWayTeams' && resolved.family === 'ml') {
      return `${pick} (ML)`;
   }
   if (resolved.layout === 'promo') {
      return pick;
   }
   if (resolved.layout === 'handicapPair' || resolved.layout === 'overUnder' || resolved.layout === 'playerOverUnder') {
      return pick;
   }
   return `${resolved.shortName} · ${pick}`;
}

/** Stable grouping key for event-page sections (player props: one group per stat). */
export function eventGroupKey(mkt: number, ctx: MarketDisplayCtx = {}): string {
   const resolved = resolveMarketDisplay(mkt, ctx);
   if (resolved.family === 'playerProp') {
      return `playerProp:${playerPropStatName(mkt)}`;
   }
   if (isSoccerToQualify(mkt, ctx.mktString, ctx.sport)) {
      return 'tq';
   }
   return resolved.family;
}
