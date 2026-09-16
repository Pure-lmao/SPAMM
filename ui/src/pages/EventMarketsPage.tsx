import { useEffect, useState, Fragment, type ReactElement } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { fullMarketName, sideLabel, sideLabels } from "spamm-aggregator-sdk";
import { buildMarketLabel } from "../betting/marketLabel";
// Live RPC quote overlay is too slow on large events; restore with marketQuotesProxy.
// import { createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";
// import { useCluster } from "@solana/connector/react";
// import { refreshEventOddsFromProxy } from "../betting/marketQuotesProxy";
// import { resolveAppHttpRpcUrl } from "../betting/txPipeline";
import { pickBetSide } from "../betting/outcomeSide";
import type { MarketRow } from "../betting/types";
import { useBetSlip } from "../betting/BetSlipContext";
import { DEFAULT_MARKET_OPERATOR } from "../betting/chainIds";
import { displayEventTitle, formatStart } from "../markets/eventDisplay";
import { fetchOneEvent } from "../markets/fetchEvent";
import { fetchPromosForEvent } from "../markets/fetchPromos";
import { PromoMarketsSection } from "../markets/PromoMarketsSection";
import { PlayerOverUnderTable, PlayerYesNoTable } from "../markets/PlayerPropsTable";
import { marketDomKey, periodCaption, shouldShowPeriodBadge, uiMarketDisplayCtx } from "../markets/eventMarketsDisplay";
import { oddsTableLabels } from "../markets/oddsTableLabels";
import {
   decimalOddsFromDb,
   fmtOdd,
   formatMarketLineDisplay,
   orderOneX2WireToDisplay,
   parseOdds,
} from "../markets/oddsFormat";
import { lineRawForSpreadOrTotal, spreadLineDisplayForOutcome } from "../markets/lineFromMarket";
import { groupMarketsForEventPage, inferBetColumn } from "../markets/selectors";
import type { UiGroupedEvent, UiMarket, UiPromotionalMarket } from "../markets/types";

type EventPayload = UiGroupedEvent;

type NavState = {
   leagueName?: string;
};

function toMarketRow(m: UiMarket): MarketRow {
   return {
      id: m.id,
      mkt_string: m.mkt_string,
      period_id: m.period_id,
      line_value: m.line_value,
      player_id: m.player_id,
      player_name: m.player_name,
      operator: m.operator,
      sport_id: m.sport_id,
   };
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
   const { toggleSelection, isSelected } = useBetSlip();
   // const { cluster } = useCluster();
   const [ev, setEv] = useState<EventPayload | null>(null);
   const [promos, setPromos] = useState<UiPromotionalMarket[]>([]);
   const [err, setErr] = useState<string | null>(null);

   // const clusterRpcUrl = useMemo(() => resolveAppHttpRpcUrl(cluster?.url), [cluster?.url]);
   // const rpc = useMemo(() => createSolanaRpc(clusterRpcUrl) as Rpc<SolanaRpcApi>, [clusterRpcUrl]);

   useEffect(() => {
      const s = Number(sportId);
      const l = Number(leagueId);
      const e = Number(eventId);
      if (!Number.isFinite(s) || !Number.isFinite(l) || !Number.isFinite(e)) {
         setErr("Invalid route.");
         return;
      }
      let cancelled = false;
      (async () => {
         try {
            const row = await fetchOneEvent(s, l, e);
            if (!cancelled) {
               setEv(row);
               setErr(null);
            }
            const eventPromos = await fetchPromosForEvent(s, l, e).catch(() => [] as UiPromotionalMarket[]);
            if (!cancelled) {
               setPromos(eventPromos);
            }
            // try {
            //    const withLiveOdds = await refreshEventOddsFromProxy(rpc, row, (partial) => {
            //       if (!cancelled) {
            //          setEv(partial);
            //       }
            //    });
            //    if (!cancelled) {
            //       setEv(withLiveOdds);
            //    }
            // } catch (quoteErr: unknown) {
            //    console.warn("Live odds refresh failed", quoteErr);
            // }
         } catch (x: unknown) {
            if (!cancelled) {
               setErr(x instanceof Error ? x.message : String(x));
               setEv(null);
            }
         }
      })();
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
   const teams = { homeName: ev.home_name, awayName: ev.away_name };
   const groups = groupMarketsForEventPage(mkts, teams).filter((g) => g.kind !== "promo");
   const sid = ev.sport_id;
   const homeHead = ev.home_name.trim() !== "" ? ev.home_name.trim() : oddsTableLabels.home;
   const awayHead = ev.away_name.trim() !== "" ? ev.away_name.trim() : oddsTableLabels.away;

   const toggleSheet = (m: UiMarket, column: ReturnType<typeof inferBetColumn>, outcomeIndex: number, dbOdds: number) => {
      const dec = decimalOddsFromDb(dbOdds);
      const chainSide = pickBetSide(column, m.mkt_string, outcomeIndex, m.id);
      toggleSelection({
         eventTitle: displayEventTitle(ev),
         marketLabel: buildMarketLabel(column, toMarketRow(m), chainSide, teams),
         displayedDecimalOdds: dec > 0 ? dec : null,
         eventId: ev.id,
         leagueId: ev.league_id,
         sportApiId: ev.sport_id,
         marketWireId: m.id,
         periodId: m.period_id,
         playerId: m.player_id ?? 0,
         playerName: m.player_name ?? "",
         operator: m.operator || DEFAULT_MARKET_OPERATOR,
         column,
         outcomeIndex,
         mktString: m.mkt_string,
      });
   };

   const oddBtnClass = (
      m: UiMarket,
      column: ReturnType<typeof inferBetColumn>,
      outcomeIndex: number,
      extra?: string,
   ) => {
      const picked = isSelected({
         eventId: ev.id,
         marketWireId: m.id,
         periodId: m.period_id,
         playerId: m.player_id ?? 0,
         column,
         outcomeIndex,
      });
      return ["odd-btn", picked ? "odd-btn--selected" : "", extra].filter(Boolean).join(" ");
   };

   const oddCell = (m: UiMarket, column: ReturnType<typeof inferBetColumn>, i: number, v: number) => (
      <td key={i} className="event-markets-td-odds">
         {v === 0 ? (
            <button type="button" className="odd-btn odd-btn--empty" disabled>
               —
            </button>
         ) : (
            <button type="button" className={oddBtnClass(m, column, i)} onClick={() => toggleSheet(m, column, i, v)}>
               <span className="odds-value">{fmtOdd(v)}</span>
            </button>
         )}
      </td>
   );

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

            <PromoMarketsSection
               promos={promos}
               eventFilter={{ sportId: sid, leagueId: ev.league_id, eventId: ev.id }}
            />

            <div className="event-page-sections">
               {groups.map((g, gi) => (
                  <section key={`${g.kind}-${g.title}-${gi}`} className="event-market-section">
                     {(g.layout === "threeWay1x2" || g.layout === "twoWayTeams") && (
                        <div className="event-money-blocks">
                           {g.rows.map((m, mi) => {
                              const raw = parseOdds(m.last_odds);
                              const is1x2 = g.layout === "threeWay1x2";
                              const values = is1x2 ? orderOneX2WireToDisplay(raw) : raw;
                              const column = inferBetColumn(m.mkt_string, m.id);
                              const n = is1x2 ? 3 : 2;
                              return (
                                 <table key={marketDomKey(m)} className="event-markets-table event-markets-table--money">
                                    {mi === 0 ? (
                                       <caption className="event-market-section-caption" title={g.tooltip}>
                                          {g.title}
                                       </caption>
                                    ) : null}
                                    <thead>
                                       <tr>
                                          {is1x2 ? (
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
                                          {values.length > 0
                                             ? values.map((v, i) => oddCell(m, column, i, v))
                                             : Array.from({ length: n }, (_, i) => (
                                                  <td key={i} className="event-markets-td-odds">
                                                     <button type="button" className="odd-btn odd-btn--empty" disabled>
                                                        —
                                                     </button>
                                                  </td>
                                               ))}
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

                     {(g.layout === "handicapPair") && (
                        <table className="event-markets-table event-markets-table--handicap-pair">
                           <caption className="event-market-section-caption" title={g.tooltip}>
                              {g.title}
                           </caption>
                           <thead>
                              <tr>
                                 <th>{homeHead}</th>
                                 <th>{awayHead}</th>
                              </tr>
                           </thead>
                           <tbody>
                              {g.rows.map((m) => {
                                 const values = parseOdds(m.last_odds);
                                 if (values.length < 2) {
                                    return null;
                                 }
                                 const home = values[0]!;
                                 const away = values[1]!;
                                 const homeLine = spreadLineDisplayForOutcome({ ...m, id: m.id }, 0);
                                 const awayLine = spreadLineDisplayForOutcome({ ...m, id: m.id }, 1);
                                 const homeDead = home === 0 || homeLine === "—";
                                 const awayDead = away === 0 || awayLine === "—";
                                 const column = inferBetColumn(m.mkt_string, m.id);
                                 const showPeriod = shouldShowPeriodBadge(sid, m);
                                 return (
                                    <Fragment key={marketDomKey(m)}>
                                       <tr>
                                          <td className="event-markets-td-odds">
                                             <button
                                                type="button"
                                                className={oddBtnClass(m, column, 0)}
                                                disabled={homeDead}
                                                onClick={() => toggleSheet(m, column, 0, home)}
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
                                                className={oddBtnClass(m, column, 1)}
                                                disabled={awayDead}
                                                onClick={() => toggleSheet(m, column, 1, away)}
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

                     {(g.layout === "overUnder") && (
                        <table className="event-markets-table">
                           <caption className="event-market-section-caption" title={g.tooltip}>
                              {g.title}
                           </caption>
                           <thead>
                              <tr>
                                 <th className="event-markets-th-line">{oddsTableLabels.line}</th>
                                 <th>{oddsTableLabels.over}</th>
                                 <th>{oddsTableLabels.under}</th>
                              </tr>
                           </thead>
                           <tbody>
                              {g.rows.map((m) => {
                                 const values = parseOdds(m.last_odds);
                                 if (values.length < 2) {
                                    return null;
                                 }
                                 const lineRaw = lineRawForSpreadOrTotal({ ...m, id: m.id }, "total");
                                 const lineShown = formatMarketLineDisplay(lineRaw, "total");
                                 const lineMuted = lineShown.trim() === "—" || lineShown.trim() === "";
                                 const o0 = values[0]!;
                                 const o1 = values[1]!;
                                 const column = inferBetColumn(m.mkt_string, m.id);
                                 return (
                                    <tr key={marketDomKey(m)}>
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
                                       {oddCell(m, column, 0, o0)}
                                       {oddCell(m, column, 1, o1)}
                                    </tr>
                                 );
                              })}
                           </tbody>
                        </table>
                     )}

                     {g.layout === "playerOverUnder" && (
                        <PlayerOverUnderTable
                           title={g.title}
                           tooltip={g.tooltip}
                           rows={g.rows}
                           handlers={{
                              sportId: sid,
                              teams,
                              oddCell,
                           }}
                        />
                     )}

                     {g.layout === "playerYesNo" && (
                        <PlayerYesNoTable
                           title={g.title}
                           tooltip={g.tooltip}
                           rows={g.rows}
                           handlers={{
                              sportId: sid,
                              teams,
                              oddCell,
                           }}
                        />
                     )}

                     {(g.layout === "yesNo") && (
                        <table className="event-markets-table">
                           <caption className="event-market-section-caption" title={g.tooltip}>
                              {g.title}
                           </caption>
                           <thead>
                              <tr>
                                 <th>{oddsTableLabels.yes}</th>
                                 <th>{oddsTableLabels.no}</th>
                              </tr>
                           </thead>
                           <tbody>
                              {g.rows.map((m) => {
                                 const values = parseOdds(m.last_odds);
                                 const column = inferBetColumn(m.mkt_string, m.id);
                                 return (
                                    <tr key={marketDomKey(m)}>
                                       {[0, 1].map((i) => oddCell(m, column, i, values[i] ?? 0))}
                                    </tr>
                                 );
                              })}
                           </tbody>
                        </table>
                     )}

                     {(g.layout === "multiWay" || g.layout === "moneyOdds" || g.layout === "correctScore") && (
                        <div className="event-money-blocks">
                           {g.rows.map((m, mi) => {
                              const values = parseOdds(m.last_odds);
                              const column = inferBetColumn(m.mkt_string, m.id);
                              const ctx = uiMarketDisplayCtx(m, teams);
                              const headers =
                                 g.layout === "correctScore"
                                    ? [sideLabel(m.id, 0, ctx)]
                                    : sideLabels(m.id, ctx);
                              const n = Math.max(headers.length, values.length, 1);
                              return (
                                 <table key={marketDomKey(m)} className="event-markets-table event-markets-table--money">
                                    {mi === 0 ? (
                                       <caption className="event-market-section-caption" title={g.tooltip}>
                                          {g.title}
                                       </caption>
                                    ) : null}
                                    <thead>
                                       <tr>
                                          <th className="event-markets-th-meta" />
                                          {headers.slice(0, n).map((h, i) => (
                                             <th key={i}>{h}</th>
                                          ))}
                                       </tr>
                                    </thead>
                                    <tbody>
                                       <tr>
                                          <td className="event-markets-td-meta">
                                             <div className="event-market-type">{fullMarketName(m.id, ctx)}</div>
                                             <PeriodMeta sportId={sid} m={m} />
                                          </td>
                                          {Array.from({ length: n }, (_, i) => oddCell(m, column, i, values[i] ?? 0))}
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
