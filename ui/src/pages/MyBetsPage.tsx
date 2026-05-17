import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { createSolanaRpc, address, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { useCluster, useWallet } from "@solana/connector/react";
import { BetResult, getBetsData, ODDS_SCALE, type BetAccountData } from "spamm-aggregator-sdk";
import { resolveHttpRpcUrl } from "../betting/txPipeline";
import { formatUsdcBaseUnitsForUi } from "../betting/usdc";
import { fetchOneEvent } from "../markets/fetchEvent";
import { betMarketDisplayLines, eventLookupKey } from "../markets/myBetsMarketDisplay";
import type { UiGroupedEvent } from "../markets/types";

type LoadState = "idle" | "loading" | "ok" | "err";

type MyBetsTab = "open" | "closed";

function betResultLabel(r: BetResult): string {
   switch (r) {
      case BetResult.Pending:
         return "Pending";
      case BetResult.Won:
         return "Won";
      case BetResult.Lost:
         return "Lost";
      case BetResult.HalfWon:
         return "Half won";
      case BetResult.HalfLost:
         return "Half lost";
      case BetResult.Push:
         return "Push";
      case BetResult.Cancelled:
         return "Cancelled";
      case BetResult.RolledBack:
         return "Rolled back";
      default:
         return `Unknown (${r})`;
   }
}

function resultModifierClass(r: BetResult): string {
   switch (r) {
      case BetResult.Pending:
         return "pending";
      case BetResult.Won:
         return "won";
      case BetResult.Lost:
         return "lost";
      case BetResult.HalfWon:
         return "half-won";
      case BetResult.HalfLost:
         return "half-lost";
      case BetResult.Push:
         return "push";
      case BetResult.Cancelled:
         return "cancelled";
      case BetResult.RolledBack:
         return "rolled-back";
      default:
         return "unknown";
   }
}

function oddsFromScaled(scaled: bigint): string {
   const x = Number(scaled) / Number(ODDS_SCALE);
   if (!Number.isFinite(x)) {
      return "—";
   }
   return x >= 10 ? x.toFixed(2) : x.toFixed(3);
}

function truncateAddressMiddle(addr: string, head = 4, tail = 4): string {
   if (addr.length <= head + tail + 3) {
      return addr;
   }
   return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function solscanAddressUrl(address: string): string {
   return `https://solscan.io/account/${encodeURIComponent(address)}?cluster=devnet`;
}

export function MyBetsPage(): ReactElement {
   const { account, isConnected } = useWallet();
   const { cluster } = useCluster();

   const clusterRpcUrl = useMemo(() => {
      const env = typeof import.meta.env.VITE_SOLANA_RPC_URL === "string" ? import.meta.env.VITE_SOLANA_RPC_URL.trim() : "";
      const fromCluster = cluster?.url?.trim() ?? "";
      const raw = fromCluster !== "" ? fromCluster : env;
      return resolveHttpRpcUrl(raw !== "" ? raw : null);
   }, [cluster?.url]);

   const rpc = useMemo(() => createSolanaRpc(clusterRpcUrl) as Rpc<SolanaRpcApi>, [clusterRpcUrl]);

   const [state, setState] = useState<LoadState>("idle");
   const [err, setErr] = useState<string | null>(null);
   const [rows, setRows] = useState<readonly { address: string; data: BetAccountData }[]>([]);
   const [betTab, setBetTab] = useState<MyBetsTab>("open");
   const [eventsByKey, setEventsByKey] = useState<ReadonlyMap<string, UiGroupedEvent | null>>(() => new Map());

   const eventKeys = useMemo(() => {
      const keys = new Map<string, { sport: number; league: number; event: number }>();
      for (const { data } of rows) {
         const mid = data.marketId;
         const eid = mid.eventId;
         const k = eventLookupKey(mid);
         keys.set(k, { sport: eid.sport, league: eid.league, event: Number(eid.event) });
      }
      return keys;
   }, [rows]);

   useEffect(() => {
      if (eventKeys.size === 0) {
         setEventsByKey(new Map());
         return;
      }
      let cancelled = false;
      void (async () => {
         const entries = await Promise.all(
            [...eventKeys.entries()].map(async ([key, ids]) => {
               try {
                  const ev = await fetchOneEvent(ids.sport, ids.league, ids.event);
                  return [key, ev] as const;
               } catch {
                  return [key, null] as const;
               }
            }),
         );
         if (!cancelled) {
            setEventsByKey(new Map(entries));
         }
      })();
      return () => {
         cancelled = true;
      };
   }, [eventKeys]);

   const load = useCallback(async () => {
      if (!isConnected || !account) {
         setRows([]);
         setState("idle");
         setErr(null);
         return;
      }
      setState("loading");
      setErr(null);
      try {
         const user = address(account);
         const list = await getBetsData(rpc, { user });
         const sorted = [...list].sort((a, b) => (a.data.betId < b.data.betId ? 1 : a.data.betId > b.data.betId ? -1 : 0));
         setRows(sorted.map((r) => ({ address: String(r.address), data: r.data })));
         setState("ok");
      } catch (e) {
         setErr(e instanceof Error ? e.message : String(e));
         setState("err");
      }
   }, [account, isConnected, rpc]);

   useEffect(() => {
      void load();
   }, [load]);

   if (!isConnected || !account) {
      return (
         <main className="my-bets-page">
            <h2 className="my-bets-page__title">My Bets</h2>
            <p className="my-bets-page__hint">Connect your wallet to load bets from the chain.</p>
         </main>
      );
   }

   return (
      <main className="my-bets-page">
         <div className="my-bets-page__head">
            <h2 className="my-bets-page__title">My Bets</h2>
            <button type="button" className="my-bets-page__refresh" disabled={state === "loading"} onClick={() => void load()}>
               {state === "loading" ? "Refreshing…" : "Refresh"}
            </button>
         </div>

         {state === "err" && err != null && <p className="my-bets-page__err">{err}</p>}

         <div className="my-bets-page__tabs" role="tablist" aria-label="Bet groups">
            <button
               type="button"
               role="tab"
               aria-selected={betTab === "open"}
               className={`my-bets-page__tab${betTab === "open" ? " my-bets-page__tab--active" : ""}`}
               onClick={() => setBetTab("open")}
            >
               Open Bets
            </button>
            <button
               type="button"
               role="tab"
               aria-selected={betTab === "closed"}
               className={`my-bets-page__tab${betTab === "closed" ? " my-bets-page__tab--active" : ""}`}
               onClick={() => setBetTab("closed")}
            >
               Closed Bets
            </button>
         </div>

         <div className="my-bets-page__tab-panel" role="tabpanel">
            {betTab === "open" && (
               <>
                  {state === "loading" && rows.length === 0 && <p className="my-bets-page__loading">Loading bets…</p>}

                  {state === "ok" && rows.length === 0 && (
                     <p className="my-bets-page__empty">No bets found for this wallet.</p>
                  )}

                  {rows.length > 0 && (
                     <ul className="my-bets-list">
                        {rows.map(({ address: betPda, data: b }) => {
                           const primaryFill = [b.filler0, b.filler1, b.filler2, b.filler3, b.filler4].find(
                              (f) => f.amount > 0n,
                           );
                           const oddsUi =
                              primaryFill !== undefined && primaryFill.oddsScaled > 0n
                                 ? oddsFromScaled(primaryFill.oddsScaled)
                                 : "—";
                           const ek = eventLookupKey(b.marketId);
                           const lines = betMarketDisplayLines(eventsByKey.get(ek) ?? undefined, b.marketId, b.side);
                           return (
                              <li key={betPda} className="my-bets-card">
                                 <div className="my-bets-card__top">
                                    <span className={`my-bets-card__result my-bets-card__result--${resultModifierClass(b.result)}`}>
                                       {betResultLabel(b.result)}
                                    </span>
                                    <div className="my-bets-card__top-right">
                                       <span className="my-bets-card__bet-id" title={`Bet ID ${b.betId.toString()}`}>
                                          {b.betId.toString()}
                                       </span>
                                       <a
                                          href={solscanAddressUrl(betPda)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="my-bets-card__account-link"
                                          title={betPda}
                                       >
                                          {truncateAddressMiddle(betPda)}
                                       </a>
                                    </div>
                                 </div>
                                 <p className="my-bets-card__event-line">
                                    <span className="my-bets-card__event-title">{lines.eventTitle}</span>
                                    {lines.liveSuffix !== "" && (
                                       <span className="my-bets-card__live-mark">{lines.liveSuffix}</span>
                                    )}
                                 </p>
                                 <p className="my-bets-card__market-detail">{lines.detailLine}</p>
                                 <dl className="my-bets-card__grid">
                                    <div>
                                       <dt>Stake</dt>
                                       <dd>
                                          <strong>{formatUsdcBaseUnitsForUi(b.amount)}</strong> USDC
                                       </dd>
                                    </div>
                                    <div>
                                       <dt>Filled odds</dt>
                                       <dd>{oddsUi === "—" ? "—" : `${oddsUi}`}</dd>
                                    </div>
                                    <div>
                                       <dt>Potential payout</dt>
                                       <dd>{formatUsdcBaseUnitsForUi(b.payout)} USDC</dd>
                                    </div>
                                 </dl>
                              </li>
                           );
                        })}
                     </ul>
                  )}
               </>
            )}

            {betTab === "closed" && (
               <p className="my-bets-page__tab-placeholder">Closed bets will be listed here. This view is not wired up yet.</p>
            )}
         </div>
      </main>
   );
}
