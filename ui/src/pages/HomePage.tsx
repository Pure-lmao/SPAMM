import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { buildMarketLabel } from "../betting/marketLabel";
import type { BetColumn, MarketRow } from "../betting/types";
import { useBetModal } from "../betting/BetModalContext";
import { displayEventTitle, formatStart } from "../markets/eventDisplay";
import { LineWithOddsCell, MainOddsCell, EmptyTotalOddsPlaceholder } from "../markets/MarketOddsCells";
import {
   extraMarketsCount,
   filterGroupedSportsForHome,
   getMainOddsDetail,
   getSpreadOdds,
   getTotalOdds,
} from "../markets/selectors";
import { oddsTableLabels } from "../markets/oddsTableLabels";
import type { UiGroupedSport } from "../markets/types";

async function fetchGroupedTree(): Promise<UiGroupedSport[]> {
   const res = await fetch("/api/events?all=true");
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const data = (await res.json()) as unknown;
   if (!Array.isArray(data)) {
      throw new Error("Expected array from /api/events?all=true");
   }
   return data as UiGroupedSport[];
}

function leagueCollapseKey(sportId: number, leagueId: number): string {
   return `${sportId}-${leagueId}`;
}

function toMarketRow(m: {
   id: number;
   mkt_string: string;
   period_id: number;
   line_value: number | null;
}): MarketRow {
   return { id: m.id, mkt_string: m.mkt_string, period_id: m.period_id, line_value: m.line_value };
}

/** Padding beyond widest single-line team label (cell + link inset, rounded). */
const HOME_MATCH_COL_PAD_PX = 28;

function maxTeamLabelWidthPx(tree: UiGroupedSport[], font: string): number {
   const ctx = document.createElement("canvas").getContext("2d");
   if (!ctx) {
      return 0;
   }
   ctx.font = font;
   let maxW = 0;
   for (const sport of tree) {
      for (const league of sport.leagues) {
         for (const ev of league.events) {
            maxW = Math.max(maxW, ctx.measureText(ev.home_name).width, ctx.measureText(ev.away_name).width);
         }
      }
   }
   return Math.ceil(maxW);
}

function computeMatchColPx(tree: UiGroupedSport[], font: string): number {
   const label = maxTeamLabelWidthPx(tree, font);
   return Math.max(96, label + HOME_MATCH_COL_PAD_PX);
}

export function HomePage(): ReactElement {
   const { openBet } = useBetModal();
   const [tree, setTree] = useState<UiGroupedSport[] | null>(null);
   const [err, setErr] = useState<string | null>(null);
   const [collapsedSports, setCollapsedSports] = useState<Set<number>>(() => new Set());
   const [collapsedLeagues, setCollapsedLeagues] = useState<Set<string>>(() => new Set());
   const [matchColPx, setMatchColPx] = useState<number | null>(null);
   const fontProbeRef = useRef<HTMLSpanElement>(null);

   const displayTree = useMemo(() => (tree == null ? null : filterGroupedSportsForHome(tree)), [tree]);

   useLayoutEffect(() => {
      if (displayTree == null || fontProbeRef.current == null) {
         return;
      }
      const measure = () => {
         if (fontProbeRef.current == null) {
            return;
         }
         const font = getComputedStyle(fontProbeRef.current).font;
         setMatchColPx(computeMatchColPx(displayTree, font));
      };
      measure();
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
   }, [displayTree]);

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

   const homeScopeStyle: CSSProperties | undefined =
      matchColPx != null ? ({ ["--events-match-col-px"]: `${matchColPx}px` } as CSSProperties) : undefined;

   return (
      <>
         {err != null && <div className="banner-error">{err}</div>}
         {tree === null && err == null && <p className="loading">Loading…</p>}
         {tree != null && displayTree != null && (
            <div className="home-events-scope" style={homeScopeStyle}>
               <div className="events-table-font-probe-host" aria-hidden>
                  <table className="events-table">
                     <tbody>
                        <tr>
                           <td className="match-main">
                              <span className="teams">
                                 <span ref={fontProbeRef} className="teams__home">
                                    M
                                 </span>
                              </span>
                           </td>
                        </tr>
                     </tbody>
                  </table>
               </div>
               {displayTree.length === 0 ? (
                  <p className="loading">No events with published odds.</p>
               ) : (
                  displayTree.map((sport) => {
               const sportCollapsed = collapsedSports.has(sport.id);
               return (
                  <section key={sport.id} className="sport-section" data-sport={sport.id}>
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
                                    <div className="league-table-scroll">
                                    <table className="events-table">
                                       <colgroup>
                                          <col className="events-table__col--match" />
                                          <col className="events-table__col--main" />
                                          <col className="events-table__col--spread" />
                                          <col className="events-table__col--total" />
                                          <col className="events-table__col--more" />
                                       </colgroup>
                                       <thead>
                                          <tr className="thead-row-primary">
                                             <th rowSpan={2} className="th-match" aria-label="Teams and start time" />
                                             <th>{sport.id === 1 ? oddsTableLabels.main1x2 : oddsTableLabels.mainMl}</th>
                                             <th>{oddsTableLabels.spread}</th>
                                             <th>{oddsTableLabels.total}</th>
                                             <th rowSpan={2} className="th-more-markets th-more-markets--edge" aria-hidden />
                                          </tr>
                                          <tr className="thead-row-sub">
                                             <th>
                                                <div
                                                   className={`th-sub-inner th-sub-inner--grid-${sport.id === 1 ? "3" : "2"}`}
                                                >
                                                   {sport.id === 1 ? (
                                                      <>
                                                         <span>{oddsTableLabels.home}</span>
                                                         <span>{oddsTableLabels.draw}</span>
                                                         <span>{oddsTableLabels.away}</span>
                                                      </>
                                                   ) : (
                                                      <>
                                                         <span>{oddsTableLabels.home}</span>
                                                         <span>{oddsTableLabels.away}</span>
                                                      </>
                                                   )}
                                                </div>
                                             </th>
                                             <th>
                                                <div className="th-sub-inner th-sub-inner--grid-2">
                                                   <span>{oddsTableLabels.home}</span>
                                                   <span>{oddsTableLabels.away}</span>
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
                                                      <span>{oddsTableLabels.over}</span>
                                                      <span>{oddsTableLabels.under}</span>
                                                   </div>
                                                </div>
                                             </th>
                                          </tr>
                                       </thead>
                                       <tbody>
                                          {league.events.map((ev) => {
                                             const mkts = ev.markets;
                                             const sp = getSpreadOdds(mkts, sport.id);
                                             const tot = getTotalOdds(mkts, sport.id);
                                             const mainDetail = getMainOddsDetail(mkts, sport.id);
                                             const moreN = extraMarketsCount(mkts);

                                             const openSheet = (
                                                column: BetColumn,
                                                row: MarketRow,
                                                outcomeIndex: number,
                                                decimalOdds: number,
                                             ) => {
                                                openBet({
                                                   eventTitle: displayEventTitle(ev),
                                                   marketLabel: buildMarketLabel(column, row, outcomeIndex, {
                                                      homeName: ev.home_name,
                                                      awayName: ev.away_name,
                                                   }),
                                                   displayedDecimalOdds: decimalOdds > 0 ? decimalOdds : null,
                                                   eventId: ev.id,
                                                   leagueId: league.id,
                                                   sportApiId: sport.id,
                                                   marketWireId: row.id,
                                                   periodId: row.period_id,
                                                   column,
                                                   outcomeIndex,
                                                   mktString: row.mkt_string,
                                                });
                                             };

                                             return (
                                                <tr key={ev.id} data-sport={sport.id}>
                                                   <td className="match-main">
                                                      <Link
                                                         className="match-main-link"
                                                         to={`/events/${sport.id}/${league.id}/${ev.id}`}
                                                         state={{ leagueName: league.name }}
                                                      >
                                                         <span className="teams">
                                                            <span className="teams__home">{ev.home_name}</span>
                                                            <span className="teams__away">{ev.away_name}</span>
                                                         </span>
                                                         <time dateTime={new Date(ev.start_time).toISOString()}>
                                                            {formatStart(ev.start_time)}
                                                         </time>
                                                      </Link>
                                                   </td>
                                                   <td className="odds-cell">
                                                      <MainOddsCell
                                                         detail={mainDetail}
                                                         sportId={sport.id}
                                                         onPick={(outcomeIndex, decimalOdds) => {
                                                            if (mainDetail == null) {
                                                               return;
                                                            }
                                                            openSheet(
                                                               "main",
                                                               toMarketRow(mainDetail.market),
                                                               outcomeIndex,
                                                               decimalOdds,
                                                            );
                                                         }}
                                                      />
                                                   </td>
                                                   <td className="odds-cell">
                                                      {sp ? (
                                                         <LineWithOddsCell
                                                            line={sp.line}
                                                            values={sp.values}
                                                            sportId={sport.id}
                                                            lineKind="spread"
                                                            market={sp.market}
                                                            onPick={(outcomeIndex, decimalOdds) =>
                                                               openSheet(
                                                                  "spread",
                                                                  toMarketRow(sp.market),
                                                                  outcomeIndex,
                                                                  decimalOdds,
                                                               )
                                                            }
                                                         />
                                                      ) : (
                                                         <div
                                                            className={`odds-line-with-buttons odds-line-with-buttons--spread odds-line-with-buttons--spread-paired${sport.id === 1 ? " odds-line-with-buttons--soccer" : ""}`}
                                                         >
                                                            <button type="button" className="odd-btn odd-btn--empty" disabled>
                                                               —
                                                            </button>
                                                            <button type="button" className="odd-btn odd-btn--empty" disabled>
                                                               —
                                                            </button>
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
                                                               openSheet(
                                                                  "total",
                                                                  toMarketRow(tot.market),
                                                                  outcomeIndex,
                                                                  decimalOdds,
                                                               )
                                                            }
                                                         />
                                                      ) : (
                                                         <EmptyTotalOddsPlaceholder sportId={sport.id} />
                                                      )}
                                                   </td>
                                                   <td className="td-more-markets">
                                                      {moreN > 0 ? (
                                                         <Link
                                                            className="inline-nav-link event-more-markets-link"
                                                            to={`/events/${sport.id}/${league.id}/${ev.id}`}
                                                            state={{ leagueName: league.name }}
                                                         >
                                                            <span className="event-more-markets__line1">+{moreN} more</span>
                                                            <span className="event-more-markets__line2">markets</span>
                                                         </Link>
                                                      ) : (
                                                         <span className="event-more-placeholder"> </span>
                                                      )}
                                                   </td>
                                                </tr>
                                             );
                                          })}
                                       </tbody>
                                    </table>
                                    </div>
                                 )}
                              </div>
                           );
                        })}
                  </section>
               );
                  })
               )}
            </div>
         )}
      </>
   );
}
