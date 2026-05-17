import { useEffect, useState, Fragment, type ReactElement } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { buildMarketLabel } from "../betting/marketLabel";
import type { MarketRow } from "../betting/types";
import { useBetModal } from "../betting/BetModalContext";
import { displayEventTitle, formatStart } from "../markets/eventDisplay";
import { fetchOneEvent } from "../markets/fetchEvent";
import { marketPrimaryLabel, periodCaption, shouldShowPeriodBadge } from "../markets/eventMarketsDisplay";
import { oddsTableLabels } from "../markets/oddsTableLabels";
import { decimalOddsFromDb, fmtOdd, formatMarketLineDisplay, parseOdds } from "../markets/oddsFormat";
import { lineRawForSpreadOrTotal, spreadLineDisplayForOutcome } from "../markets/lineFromMarket";
import { groupMarketsForEventPage, inferBetColumn } from "../markets/selectors";
import type { UiGroupedEvent, UiMarket } from "../markets/types";

type EventPayload = UiGroupedEvent;

type NavState = {
   leagueName?: string;
};

function toMarketRow(m: UiMarket): MarketRow {
   return { id: m.id, mkt_string: m.mkt_string, period_id: m.period_id, line_value: m.line_value };
}

function PeriodMeta({ sportId, m }: { sportId: number; m: UiMarket }): ReactElement | null {
   if (!shouldShowPeriodBadge(sportId, m)) {
      return null;
   }
   return <span className="event-market-period">{periodCaption(m.period_id)}</span>;
}

export function EventMarketsPage(): ReactElement {
   const { sportId, leagueId, eventId } = useParams();
   const { state } = useLocation();
   const leagueName = (state as NavState | null)?.leagueName?.trim() ?? "";
   const { openBet } = useBetModal();
   const [ev, setEv] = useState<EventPayload | null>(null);
   const [err, setErr] = useState<string | null>(null);

   useEffect(() => {
      const s = Number(sportId);
      const l = Number(leagueId);
      const e = Number(eventId);
      if (!Number.isFinite(s) || !Number.isFinite(l) || !Number.isFinite(e)) {
         setErr("Invalid route.");
         return;
      }
      let cancelled = false;
      fetchOneEvent(s, l, e)
         .then((row) => {
            if (!cancelled) {
               setEv(row);
               setErr(null);
            }
         })
         .catch((x: unknown) => {
            if (!cancelled) {
               setErr(x instanceof Error ? x.message : String(x));
               setEv(null);
            }
         });
      return () => {
         cancelled = true;
      };
   }, [sportId, leagueId, eventId]);

   if (err != null) {
      return (
         <div className="event-page">
            <p className="banner-error">{err}</p>
            <Link to="/" className="inline-nav-link">
               ← Back to events
            </Link>
         </div>
      );
   }

   if (ev === null) {
      return (
         <div className="event-page">
            <p className="loading">Loading event…</p>
         </div>
      );
   }

   const mkts = ev.markets ?? [];
   const groups = groupMarketsForEventPage(mkts);
   const sid = ev.sport_id;
   const homeHead = ev.home_name.trim() !== "" ? ev.home_name.trim() : oddsTableLabels.home;
   const awayHead = ev.away_name.trim() !== "" ? ev.away_name.trim() : oddsTableLabels.away;

   const openSheet = (m: UiMarket, column: ReturnType<typeof inferBetColumn>, outcomeIndex: number, dbOdds: number) => {
      const dec = decimalOddsFromDb(dbOdds);
      openBet({
         eventTitle: displayEventTitle(ev),
         marketLabel: buildMarketLabel(column, toMarketRow(m), outcomeIndex, {
            homeName: ev.home_name,
            awayName: ev.away_name,
         }),
         displayedDecimalOdds: dec > 0 ? dec : null,
         eventId: ev.id,
         leagueId: ev.league_id,
         sportApiId: ev.sport_id,
         marketWireId: m.id,
         periodId: m.period_id,
         column,
         outcomeIndex,
         mktString: m.mkt_string,
      });
   };

   return (
      <div className="event-page">
         <div className="event-page-shell">
            <header className="event-page-header" data-sport={sid}>
               <h1 className="event-page-title">{displayEventTitle(ev)}</h1>
               <p className="event-page-sub">
                  {leagueName !== "" && <span className="event-page-league">{leagueName}</span>}
                  {leagueName !== "" && <span className="event-page-sub-sep"> · </span>}
                  <time dateTime={new Date(ev.start_time).toISOString()}>{formatStart(ev.start_time)}</time>
               </p>
            </header>

            <div className="event-page-sections">
               {groups.map((g, gi) => (
                  <section key={`${g.kind}-${g.title}-${gi}`} className="event-market-section">
                     {(g.kind === "money" || g.kind === "tq") && (
                     <div className="event-money-blocks">
                        {g.rows.map((m, mi) => {
                           const values = parseOdds(m.last_odds);
                           const column = inferBetColumn(m.mkt_string);
                           const n = m.mkt_string === "1X2" ? 3 : 2;
                           return (
                              <table key={`${m.id}-${m.mkt_string}`} className="event-markets-table event-markets-table--money">
                                 {mi === 0 ? (
                                    <caption className="event-market-section-caption">{g.title}</caption>
                                 ) : null}
                                 <thead>
                                    <tr>
                                       {m.mkt_string === "1X2" ? (
                                          <>
                                             <th>{homeHead}</th>
                                             <th>{oddsTableLabels.draw}</th>
                                             <th>{awayHead}</th>
                                          </>
                                       ) : (
                                          <>
                                             <th>{homeHead}</th>
                                             <th>{awayHead}</th>
                                          </>
                                       )}
                                    </tr>
                                 </thead>
                                 <tbody>
                                    <tr>
                                       {values.length > 0 ? (
                                          values.map((v, i) => (
                                             <td key={i} className="event-markets-td-odds">
                                                {v === 0 ? (
                                                   <button type="button" className="odd-btn odd-btn--empty" disabled>
                                                      —
                                                   </button>
                                                ) : (
                                                   <button
                                                      type="button"
                                                      className="odd-btn"
                                                      onClick={() => openSheet(m, column, i, v)}
                                                   >
                                                      <span className="odds-value">{fmtOdd(v)}</span>
                                                   </button>
                                                )}
                                             </td>
                                          ))
                                       ) : (
                                          Array.from({ length: n }, (_, i) => (
                                             <td key={i} className="event-markets-td-odds">
                                                <button type="button" className="odd-btn odd-btn--empty" disabled>
                                                   —
                                                </button>
                                             </td>
                                          ))
                                       )}
                                    </tr>
                                    {shouldShowPeriodBadge(sid, m) && g.kind !== "tq" && (
                                       <tr className="event-markets-handicap-period">
                                          <td colSpan={n}>
                                             <PeriodMeta sportId={sid} m={m} />
                                          </td>
                                       </tr>
                                    )}
                                 </tbody>
                              </table>
                           );
                        })}
                     </div>
                     )}

                     {(g.kind === "spread" || g.kind === "asian") && (
                        <table className="event-markets-table event-markets-table--handicap-pair">
                        <caption className="event-market-section-caption">{g.title}</caption>
                        <thead>
                           <tr>
                              <th>{homeHead}</th>
                              <th>{awayHead}</th>
                           </tr>
                        </thead>
                        <tbody>
                           {g.rows
                              .map((m) => {
                                 const values = parseOdds(m.last_odds);
                                 if (values.length < 2) {
                                    return null;
                                 }
                              const home = values[0]!;
                              const away = values[1]!;
                              const homeLine = spreadLineDisplayForOutcome(m, 0);
                              const awayLine = spreadLineDisplayForOutcome(m, 1);
                              const homeDead = home === 0 || homeLine === "—";
                              const awayDead = away === 0 || awayLine === "—";
                              const column = inferBetColumn(m.mkt_string);
                              const showPeriod = shouldShowPeriodBadge(sid, m);
                              return (
                                 <Fragment key={`${m.id}-${m.mkt_string}`}>
                                    <tr>
                                       <td className="event-markets-td-odds">
                                          <button
                                             type="button"
                                             className="odd-btn"
                                             disabled={homeDead}
                                             onClick={() => openSheet(m, column, 0, home)}
                                          >
                                             <span className={homeLine === "—" ? "odd-btn__line odd-btn__line--na" : "odd-btn__line"}>
                                                {homeLine}
                                             </span>
                                             <span className={`odd-btn__odds odds-value${home === 0 ? " odds-value--na" : ""}`}>
                                                {fmtOdd(home)}
                                             </span>
                                          </button>
                                       </td>
                                       <td className="event-markets-td-odds">
                                          <button
                                             type="button"
                                             className="odd-btn"
                                             disabled={awayDead}
                                             onClick={() => openSheet(m, column, 1, away)}
                                          >
                                             <span className={awayLine === "—" ? "odd-btn__line odd-btn__line--na" : "odd-btn__line"}>
                                                {awayLine}
                                             </span>
                                             <span className={`odd-btn__odds odds-value${away === 0 ? " odds-value--na" : ""}`}>
                                                {fmtOdd(away)}
                                             </span>
                                          </button>
                                       </td>
                                    </tr>
                                    {showPeriod && (
                                       <tr className="event-markets-handicap-period">
                                          <td colSpan={2}>
                                             <PeriodMeta sportId={sid} m={m} />
                                          </td>
                                       </tr>
                                    )}
                                 </Fragment>
                              );
                           })}
                        </tbody>
                        </table>
                     )}

                     {g.kind === "total" && (
                        <table className="event-markets-table">
                        <caption className="event-market-section-caption">{g.title}</caption>
                        <thead>
                           <tr>
                              <th className="event-markets-th-line">{oddsTableLabels.line}</th>
                              <th>{oddsTableLabels.over}</th>
                              <th>{oddsTableLabels.under}</th>
                           </tr>
                        </thead>
                        <tbody>
                           {g.rows
                              .map((m) => {
                                 const values = parseOdds(m.last_odds);
                                 if (values.length < 2) {
                                    return null;
                                 }
                              const lineRaw = lineRawForSpreadOrTotal(m, "total");
                              const lineShown = formatMarketLineDisplay(lineRaw, "total");
                              const lineMuted = lineShown.trim() === "—" || lineShown.trim() === "";
                              const o0 = values[0]!;
                              const o1 = values[1]!;
                              const column = inferBetColumn(m.mkt_string);
                              return (
                                 <tr key={`${m.id}-${m.mkt_string}`}>
                                    <td className="event-markets-td-line">
                                       <div className="event-markets-line-cell">
                                          <span
                                             className={`event-markets-line-value${lineMuted ? " event-markets-line-value--na" : ""}`}
                                          >
                                             {lineShown}
                                          </span>
                                          <PeriodMeta sportId={sid} m={m} />
                                       </div>
                                    </td>
                                    <td className="event-markets-td-odds">
                                       {o0 === 0 ? (
                                          <button type="button" className="odd-btn odd-btn--empty" disabled>
                                             —
                                          </button>
                                       ) : (
                                          <button
                                             type="button"
                                             className="odd-btn"
                                             onClick={() => openSheet(m, column, 0, o0)}
                                          >
                                             <span className="odds-value">{fmtOdd(o0)}</span>
                                          </button>
                                       )}
                                    </td>
                                    <td className="event-markets-td-odds">
                                       {o1 === 0 ? (
                                          <button type="button" className="odd-btn odd-btn--empty" disabled>
                                             —
                                          </button>
                                       ) : (
                                          <button
                                             type="button"
                                             className="odd-btn"
                                             onClick={() => openSheet(m, column, 1, o1)}
                                          >
                                             <span className="odds-value">{fmtOdd(o1)}</span>
                                          </button>
                                       )}
                                    </td>
                                 </tr>
                              );
                           })}
                        </tbody>
                        </table>
                     )}

                     {g.kind === "extra" && (
                        <div className="event-money-blocks">
                           {g.rows.map((m, mi) => {
                              const values = parseOdds(m.last_odds);
                              const column = inferBetColumn(m.mkt_string);
                              return (
                                 <table key={`${m.id}-${m.mkt_string}`} className="event-markets-table event-markets-table--money">
                                    {mi === 0 ? (
                                       <caption className="event-market-section-caption">{g.title}</caption>
                                    ) : null}
                                    <thead>
                                       <tr>
                                          <th className="event-markets-th-meta" />
                                          {values.length <= 1 ? (
                                             <th>—</th>
                                          ) : values.length === 2 ? (
                                             <>
                                                <th>{oddsTableLabels.side1}</th>
                                                <th>{oddsTableLabels.side2}</th>
                                             </>
                                          ) : (
                                             values.map((_, i) => (
                                                <th key={i}>{i + 1}</th>
                                             ))
                                          )}
                                       </tr>
                                    </thead>
                                    <tbody>
                                       <tr>
                                          <td className="event-markets-td-meta">
                                             <div className="event-market-type">{marketPrimaryLabel(sid, m)}</div>
                                             <PeriodMeta sportId={sid} m={m} />
                                          </td>
                                          {values.length > 0 ? (
                                             values.map((v, i) => (
                                                <td key={i} className="event-markets-td-odds">
                                                   {v === 0 ? (
                                                      <button type="button" className="odd-btn odd-btn--empty" disabled>
                                                         —
                                                      </button>
                                                   ) : (
                                                      <button
                                                         type="button"
                                                         className="odd-btn"
                                                         onClick={() => openSheet(m, column, i, v)}
                                                      >
                                                         <span className="odds-value">{fmtOdd(v)}</span>
                                                      </button>
                                                   )}
                                                </td>
                                             ))
                                          ) : (
                                             <td className="event-markets-td-odds">
                                                <button type="button" className="odd-btn odd-btn--empty" disabled>
                                                   —
                                                </button>
                                             </td>
                                          )}
                                       </tr>
                                    </tbody>
                                 </table>
                              );
                           })}
                        </div>
                     )}
                  </section>
               ))}
            </div>
         </div>
      </div>
   );
}
