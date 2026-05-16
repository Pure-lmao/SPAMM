import { useEffect, useState, type ReactElement } from "react";
import { BetModal } from "./betting/BetModal";
import { buildMarketLabel } from "./betting/marketLabel";
import type { BetColumn, BetModalOpenContext, MarketRow } from "./betting/types";
import { WalletBar } from "./wallet/WalletBar";

type Market = {
   id: number;
   event_id: number;
   league_id: number;
   sport_id: number;
   last_odds: string;
   last_update: number;
   mkt_string: string;
};

type GroupedEvent = {
   id: number;
   league_id: number;
   sport_id: number;
   home_name: string;
   away_name: string;
   event_name: string;
   start_time: number;
   api_id: string;
   home_score: number | null;
   away_score: number | null;
   markets?: Market[];
};

type GroupedLeague = {
   id: number;
   sport_id: number;
   name: string;
   abbr: string;
   country: string;
   country_code: string;
   country_rank: number;
   api_id: string;
   events: GroupedEvent[];
};

type GroupedSport = {
   id: number;
   sport: string;
   name: string;
   api_id: string;
   leagues: GroupedLeague[];
};

const INT_EPS = 1e-9;

/** Strip trailing zeros after decimal; do not pad to 2 dp. */
function formatDecimalMinimal(abs: number): string {
   let s = abs.toFixed(4);
   if (s.includes(".")) {
      s = s.replace(/0+$/, "");
      s = s.replace(/\.$/, "");
   }
   return s;
}

/**
 * Spread / total line for display: whole numbers show one decimal (e.g. 2 → 2.0, +1 → +1.0).
 * Otherwise minimal decimals (e.g. 2.5, 0.25). Totals omit a leading + on positives.
 */
function formatMarketLineDisplay(raw: string, kind: "spread" | "total"): string {
   const t = raw.trim();
   const hasPlus = t.startsWith("+");
   const hasMinus = t.startsWith("-");
   const unsignedStr = t.replace(/^[+-]/, "");
   const n = Number(unsignedStr);
   if (!Number.isFinite(n)) {
      return raw;
   }

   const abs = Math.abs(n);
   const isInt = Math.abs(abs - Math.round(abs)) < INT_EPS;
   const body = isInt ? `${Math.round(abs)}.0` : formatDecimalMinimal(abs);

   if (hasMinus || n < 0) {
      return `-${body}`;
   }
   if (kind === "spread" && (hasPlus || n > 0)) {
      return `+${body}`;
   }
   return body;
}

function parseOdds(json: string): number[] {
   try {
      const v = JSON.parse(json) as unknown;
      if (!Array.isArray(v)) {
         return [];
      }
      return v.map((x) => (typeof x === "number" ? x : Number(x))).filter((n) => !Number.isNaN(n));
   } catch {
      return [];
   }
}

function fmtOdd(n: number): string {
   if (n === 0) {
      return "—";
   }
   return Number.isInteger(n) ? String(n) : String(n);
}

function pickMarket(markets: Market[] | undefined, pred: (m: Market) => boolean): Market | undefined {
   if (!markets?.length) {
      return undefined;
   }
   const hits = markets.filter(pred);
   if (!hits.length) {
      return undefined;
   }
   return [...hits].sort((a, b) => a.id - b.id)[0];
}

function displayEventTitle(ev: GroupedEvent): string {
   const n = ev.event_name?.trim();
   if (n) {
      return n;
   }
   return `${ev.home_name} vs ${ev.away_name}`;
}

function marketRow(m: Market): MarketRow {
   return { id: m.id, mkt_string: m.mkt_string };
}

/** Values left→right match header: Home, Draw, Away or Home, Away (ML: stored [away, home] → display home, away). */
function getMainOddsDetail(markets: Market[] | undefined): { market: Market; values: number[] } | null {
   const x2 = pickMarket(markets, (mk) => mk.mkt_string === "1X2");
   if (x2) {
      const [h, d, a] = parseOdds(x2.last_odds);
      return { market: x2, values: [h, d, a] };
   }
   const ml = pickMarket(markets, (mk) => mk.mkt_string === "ML");
   if (ml) {
      const [away, home] = parseOdds(ml.last_odds);
      return { market: ml, values: [home, away] };
   }
   return null;
}

function getSpreadOdds(markets: Market[] | undefined): { market: Market; line: string; values: number[] } | null {
   const m = pickMarket(markets, (mk) => mk.mkt_string.startsWith("AH "));
   if (!m) {
      return null;
   }
   const line = m.mkt_string.replace(/^AH\s+/, "");
   const [away, home] = parseOdds(m.last_odds);
   return { market: m, line, values: [home, away] };
}

function getTotalOdds(markets: Market[] | undefined): { market: Market; line: string; values: number[] } | null {
   const m = pickMarket(markets, (mk) => mk.mkt_string.startsWith("OU "));
   if (!m) {
      return null;
   }
   const line = m.mkt_string.replace(/^OU\s+/, "");
   const [o0, o1] = parseOdds(m.last_odds);
   return { market: m, line, values: [o0, o1] };
}

function OddButtons({
   values,
   className,
   onPickIndex,
}: {
   values: number[];
   className?: string;
   onPickIndex?: (index: number) => void;
}): ReactElement {
   const cols = Math.max(values.length, 1);
   const gridStyle = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } as const;
   const cls = ["odds-buttons", className].filter(Boolean).join(" ");

   return (
      <div className={cls} style={gridStyle}>
         {values.length > 0 ? (
            values.map((v, i) => (
               <button
                  key={i}
                  type="button"
                  className="odd-btn"
                  onClick={() => onPickIndex?.(i)}
               >
                  {fmtOdd(v)}
               </button>
            ))
         ) : (
            <button type="button" className="odd-btn odd-btn--empty" disabled>
               —
            </button>
         )}
      </div>
   );
}

/** Spread / total: line + odds on one row. */
function LineWithOddsCell({
   line,
   values,
   sportId,
   lineKind,
   onPick,
}: {
   line: string;
   values: number[];
   sportId: number;
   lineKind: "spread" | "total";
   onPick: (outcomeIndex: number, decimalOdds: number) => void;
}): ReactElement {
   const displayLine = formatMarketLineDisplay(line, lineKind);
   const lineClass =
      sportId === 1
         ? "odds-line-value odds-line-value--soccer-asian"
         : "odds-line-value";
   const rowMod = sportId === 1 ? " odds-line-with-buttons--soccer" : "";

   return (
      <div className={`odds-line-with-buttons odds-line-with-buttons--${lineKind}${rowMod}`}>
         <span className={lineClass}>{displayLine}</span>
         <OddButtons
            values={values}
            className="odds-buttons--inline"
            onPickIndex={(i) => onPick(i, values[i] ?? 0)}
         />
      </div>
   );
}

function MainOddsCell({
   markets,
   onPick,
}: {
   markets: Market[] | undefined;
   onPick: (outcomeIndex: number, decimalOdds: number) => void;
}): ReactElement {
   const main = getMainOddsDetail(markets);
   if (!main) {
      return (
         <div className="odds-stack">
            <OddButtons values={[]} />
         </div>
      );
   }
   return (
      <div className="odds-stack">
         <OddButtons
            values={main.values}
            onPickIndex={(i) => onPick(i, main.values[i] ?? 0)}
         />
      </div>
   );
}

function formatStart(ts: number): string {
   const d = new Date(ts);
   return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
   });
}

async function fetchGroupedTree(): Promise<GroupedSport[]> {
   const res = await fetch("/api/events?all=true");
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const data = (await res.json()) as unknown;
   if (!Array.isArray(data)) {
      throw new Error("Expected array from /api/events?all=true");
   }
   return data as GroupedSport[];
}

function leagueCollapseKey(sportId: number, leagueId: number): string {
   return `${sportId}-${leagueId}`;
}

export function App() {
   const [tree, setTree] = useState<GroupedSport[] | null>(null);
   const [err, setErr] = useState<string | null>(null);
   const [betModal, setBetModal] = useState<BetModalOpenContext | null>(null);
   const [collapsedSports, setCollapsedSports] = useState<Set<number>>(() => new Set());
   const [collapsedLeagues, setCollapsedLeagues] = useState<Set<string>>(() => new Set());

   useEffect(() => {
      let cancelled = false;
      fetchGroupedTree()
         .then((t) => {
            if (!cancelled) {
               setTree(t);
            }
         })
         .catch((e: unknown) => {
            if (!cancelled) {
               setErr(e instanceof Error ? e.message : String(e));
            }
         });
      return () => {
         cancelled = true;
      };
   }, []);

   return (
      <>
         <header className="app-header">
            <h1 className="app-title">Automatic Sports Markets</h1>
            <WalletBar />
         </header>
         {err != null && <div className="banner-error">{err}</div>}
         {tree === null && err == null && <p className="loading">Loading…</p>}
         {tree != null &&
            tree.map((sport) => {
               const sportCollapsed = collapsedSports.has(sport.id);
               return (
                  <section key={sport.id} className="sport-section">
                     <button
                        type="button"
                        className="sport-title sport-title--toggle"
                        aria-expanded={!sportCollapsed}
                        onClick={() => {
                           setCollapsedSports((prev) => {
                              const next = new Set(prev);
                              if (next.has(sport.id)) {
                                 next.delete(sport.id);
                              } else {
                                 next.add(sport.id);
                              }
                              return next;
                           });
                        }}
                     >
                        <span className="collapse-chevron" aria-hidden>
                           {sportCollapsed ? "▸" : "▾"}
                        </span>
                        {sport.sport}
                     </button>
                     {!sportCollapsed &&
                        sport.leagues.map((league) => {
                           const lk = leagueCollapseKey(sport.id, league.id);
                           const leagueCollapsed = collapsedLeagues.has(lk);
                           return (
                              <div key={lk} className="league-block">
                                 <button
                                    type="button"
                                    className="league-row league-row--toggle"
                                    aria-expanded={!leagueCollapsed}
                                    onClick={() => {
                                       setCollapsedLeagues((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(lk)) {
                                             next.delete(lk);
                                          } else {
                                             next.add(lk);
                                          }
                                          return next;
                                       });
                                    }}
                                 >
                                    <span className="collapse-chevron" aria-hidden>
                                       {leagueCollapsed ? "▸" : "▾"}
                                    </span>
                                    {league.name}
                                 </button>
                                 {!leagueCollapsed && (
                                    <table className="events-table">
                           <thead>
                              <tr className="thead-row-primary">
                                 <th rowSpan={2} className="th-match">
                                    Match
                                 </th>
                                 <th>{sport.id === 1 ? "1X2" : "ML"}</th>
                                 <th>Spread</th>
                                 <th>Total</th>
                              </tr>
                              <tr className="thead-row-sub">
                                 <th>
                                    <div
                                       className={`th-sub-inner th-sub-inner--grid-${sport.id === 1 ? "3" : "2"}`}
                                    >
                                       {sport.id === 1 ? (
                                          <>
                                             <span>Home</span>
                                             <span>Draw</span>
                                             <span>Away</span>
                                          </>
                                       ) : (
                                          <>
                                             <span>Home</span>
                                             <span>Away</span>
                                          </>
                                       )}
                                    </div>
                                 </th>
                                 <th>
                                    <div
                                       className={`th-market-sub-header th-market-sub-header--spread${sport.id === 1 ? " th-market-sub-header--soccer" : ""}`}
                                    >
                                       <span className="th-market-sub-header__line-slot" aria-hidden>
                                          +0.0
                                       </span>
                                       <div className="th-sub-inner th-sub-inner--grid-2">
                                          <span>Home</span>
                                          <span>Away</span>
                                       </div>
                                    </div>
                                 </th>
                                 <th>
                                    <div
                                       className={`th-market-sub-header th-market-sub-header--total${sport.id === 1 ? " th-market-sub-header--soccer" : ""}`}
                                    >
                                       <span className="th-market-sub-header__line-slot" aria-hidden>
                                          00.0
                                       </span>
                                       <div className="th-sub-inner th-sub-inner--grid-2">
                                          <span>Over</span>
                                          <span>Under</span>
                                       </div>
                                    </div>
                                 </th>
                              </tr>
                           </thead>
                           <tbody>
                              {league.events.map((ev) => {
                                 const mkts = ev.markets;
                                 const sp = getSpreadOdds(mkts);
                                 const tot = getTotalOdds(mkts);
                                 const mainDetail = getMainOddsDetail(mkts);

                                 const openSheet = (
                                    column: BetColumn,
                                    row: MarketRow,
                                    outcomeIndex: number,
                                    decimalOdds: number,
                                 ) => {
                                    setBetModal({
                                       eventTitle: displayEventTitle(ev),
                                       marketLabel: buildMarketLabel(column, row, outcomeIndex),
                                       displayedDecimalOdds: decimalOdds > 0 ? decimalOdds : null,
                                       eventId: ev.id,
                                       leagueId: league.id,
                                       sportApiId: sport.id,
                                       marketWireId: row.id,
                                       column,
                                       outcomeIndex,
                                       mktString: row.mkt_string,
                                    });
                                 };

                                 return (
                                    <tr key={ev.id}>
                                       <td className="match-main">
                                          <span className="teams">
                                             {ev.home_name}
                                             <span className="vs">vs</span>
                                             {ev.away_name}
                                          </span>
                                          <time dateTime={new Date(ev.start_time).toISOString()}>
                                             {formatStart(ev.start_time)}
                                          </time>
                                       </td>
                                       <td className="odds-cell">
                                          {mainDetail ? (
                                             <MainOddsCell
                                                markets={mkts}
                                                onPick={(outcomeIndex, decimalOdds) =>
                                                   openSheet("main", marketRow(mainDetail.market), outcomeIndex, decimalOdds)
                                                }
                                             />
                                          ) : (
                                             <div className="odds-stack">
                                                <OddButtons values={[]} />
                                             </div>
                                          )}
                                       </td>
                                       <td className="odds-cell">
                                          {sp ? (
                                             <LineWithOddsCell
                                                line={sp.line}
                                                values={sp.values}
                                                sportId={sport.id}
                                                lineKind="spread"
                                                onPick={(outcomeIndex, decimalOdds) =>
                                                   openSheet("spread", marketRow(sp.market), outcomeIndex, decimalOdds)
                                                }
                                             />
                                          ) : (
                                             <div
                                                className={`odds-line-with-buttons odds-line-with-buttons--spread${sport.id === 1 ? " odds-line-with-buttons--soccer" : ""}`}
                                             >
                                                <span className="odds-line-value odds-line-value--empty">—</span>
                                                <OddButtons values={[]} />
                                             </div>
                                          )}
                                       </td>
                                       <td className="odds-cell">
                                          {tot ? (
                                             <LineWithOddsCell
                                                line={tot.line}
                                                values={tot.values}
                                                sportId={sport.id}
                                                lineKind="total"
                                                onPick={(outcomeIndex, decimalOdds) =>
                                                   openSheet("total", marketRow(tot.market), outcomeIndex, decimalOdds)
                                                }
                                             />
                                          ) : (
                                             <div
                                                className={`odds-line-with-buttons odds-line-with-buttons--total${sport.id === 1 ? " odds-line-with-buttons--soccer" : ""}`}
                                             >
                                                <span className="odds-line-value odds-line-value--empty">—</span>
                                                <OddButtons values={[]} />
                                             </div>
                                          )}
                                       </td>
                                    </tr>
                                 );
                              })}
                           </tbody>
                                    </table>
                                 )}
                              </div>
                           );
                        })}
                  </section>
               );
            })}
         <BetModal open={betModal} onClose={() => setBetModal(null)} />
      </>
   );
}
