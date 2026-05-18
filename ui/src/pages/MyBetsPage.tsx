import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
   assertIsTransactionWithBlockhashLifetime,
   createSolanaRpc,
   createSolanaRpcSubscriptions,
   sendAndConfirmTransactionFactory,
   address,
   type Rpc,
   type SolanaRpcApi,
} from "@solana/kit";
import { useCluster, useKitTransactionSigner, useWallet } from "@solana/connector/react";
import { BetResult, getBetsData, getSettleBetIx, ODDS_SCALE, type BetAccountData } from "spamm-aggregator-sdk";
import { compileUnsignedV0TransactionChunks, httpToWsRpcUrl, resolveHttpRpcUrl } from "../betting/txPipeline";
import { formatUsdcBaseUnitsForUi } from "../betting/usdc";
import { fetchOneEvent } from "../markets/fetchEvent";
import { betMarketDisplayLines, eventLookupKey } from "../markets/myBetsMarketDisplay";
import type { UiGroupedEvent } from "../markets/types";

type LoadState = "idle" | "loading" | "ok" | "err";

type MyBetsTab = "open" | "closed";

const MAX_SETTLE_IX_PER_TX = 9;

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

function primaryFill(b: BetAccountData): BetAccountData["filler0"] | undefined {
   return [b.filler0, b.filler1, b.filler2, b.filler3, b.filler4].find((f) => f.amount > 0n);
}

/**
 * Settled bet return in USDC base units from stake, filled decimal odds, and grade.
 * Open (pending) bets use on-chain `payout` as max potential instead.
 */
function settledReturnBaseUnits(b: BetAccountData, oddsScaled: bigint | null): bigint {
   const amount = b.amount;
   const hasOdds = oddsScaled !== null && oddsScaled > 0n;

   switch (b.result) {
      case BetResult.Won:
         if (hasOdds) {
            return (amount * oddsScaled) / ODDS_SCALE;
         }
         return b.payout;
      case BetResult.HalfWon: {
         if (hasOdds) {
            const half = amount / 2n;
            return half + (half * oddsScaled) / ODDS_SCALE;
         }
         return b.payout;
      }
      case BetResult.Lost:
         return 0n;
      case BetResult.HalfLost:
         return amount / 2n;
      case BetResult.Push:
      case BetResult.Cancelled:
      case BetResult.RolledBack:
         return amount;
      default:
         return b.payout;
   }
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

function BetCard({
   betPda,
   b,
   eventsByKey,
}: {
   betPda: string;
   b: BetAccountData;
   eventsByKey: ReadonlyMap<string, UiGroupedEvent | null>;
}): ReactElement {
   const fill = primaryFill(b);
   const oddsScaled = fill !== undefined && fill.oddsScaled > 0n ? fill.oddsScaled : null;
   const oddsUi = oddsScaled !== null ? oddsFromScaled(oddsScaled) : "—";
   const settled = b.result !== BetResult.Pending;
   const payoutLabel = settled ? "Return" : "Potential payout";
   const payoutBase = settled ? settledReturnBaseUnits(b, oddsScaled) : b.payout;
   const ek = eventLookupKey(b.marketId);
   const lines = betMarketDisplayLines(eventsByKey.get(ek) ?? undefined, b.marketId, b.side);

   return (
      <li className="my-bets-card">
         <div className={`my-bets-card__banner my-bets-card__banner--${resultModifierClass(b.result)}`}>
            <span className="my-bets-card__banner-result">{betResultLabel(b.result)}</span>
            <div className="my-bets-card__banner-meta">
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
         <div className="my-bets-card__body">
            <p className="my-bets-card__event-line">
               <span className="my-bets-card__event-title">{lines.eventTitle}</span>
               {lines.liveSuffix !== "" && <span className="my-bets-card__live-mark">{lines.liveSuffix}</span>}
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
                  <dt>{payoutLabel}</dt>
                  <dd>
                     <strong>{formatUsdcBaseUnitsForUi(payoutBase)}</strong> USDC
                  </dd>
               </div>
            </dl>
         </div>
      </li>
   );
}

export function MyBetsPage(): ReactElement {
   const { account, isConnected } = useWallet();
   const { signer: walletSigner, ready: signerReady } = useKitTransactionSigner();
   const { cluster } = useCluster();

   const clusterRpcUrl = useMemo(() => {
      const env = typeof import.meta.env.VITE_SOLANA_RPC_URL === "string" ? import.meta.env.VITE_SOLANA_RPC_URL.trim() : "";
      const fromCluster = cluster?.url?.trim() ?? "";
      const raw = fromCluster !== "" ? fromCluster : env;
      return resolveHttpRpcUrl(raw !== "" ? raw : null);
   }, [cluster?.url]);

   const rpc = useMemo(() => createSolanaRpc(clusterRpcUrl) as Rpc<SolanaRpcApi>, [clusterRpcUrl]);
   const rpcSubscriptions = useMemo(
      () => createSolanaRpcSubscriptions(httpToWsRpcUrl(clusterRpcUrl)),
      [clusterRpcUrl],
   );

   const [state, setState] = useState<LoadState>("idle");
   const [err, setErr] = useState<string | null>(null);
   const [rows, setRows] = useState<readonly { address: string; data: BetAccountData }[]>([]);
   const [betTab, setBetTab] = useState<MyBetsTab>("open");
   const [eventsByKey, setEventsByKey] = useState<ReadonlyMap<string, UiGroupedEvent | null>>(() => new Map());
   const [claimBusy, setClaimBusy] = useState(false);
   const [claimErr, setClaimErr] = useState<string | null>(null);
   const claimLockRef = useRef(false);

   const settledRows = useMemo(
      () => rows.filter(({ data }) => data.result !== BetResult.Pending),
      [rows],
   );

   const claimTxCount = useMemo(
      () => (settledRows.length === 0 ? 0 : Math.ceil(settledRows.length / MAX_SETTLE_IX_PER_TX)),
      [settledRows.length],
   );

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

   const runClaim = useCallback(async () => {
      if (!isConnected || !account || !walletSigner || !signerReady) {
         return;
      }
      if (claimLockRef.current) {
         return;
      }
      claimLockRef.current = true;
      setClaimBusy(true);
      setClaimErr(null);
      try {
         const userAddr = address(account);
         const fetchGraded = async () => {
            const list = await getBetsData(rpc, { user: userAddr });
            return list.filter((r) => r.data.result !== BetResult.Pending);
         };
         let bets = await fetchGraded();
         if (bets.length === 0) {
            return;
         }
         const sendAndConfirm = sendAndConfirmTransactionFactory({
            rpc,
            rpcSubscriptions,
         } as never);
         const instructionList = await Promise.all(
            bets.map(({ address, data }) => getSettleBetIx(userAddr, address, data)),
         );
         const instructionChunks: (typeof instructionList)[] = [];
         for (let i = 0; i < instructionList.length; i += MAX_SETTLE_IX_PER_TX) {
            instructionChunks.push(instructionList.slice(i, i + MAX_SETTLE_IX_PER_TX));
         }
         const unsigned = await compileUnsignedV0TransactionChunks(rpc, {
            feePayer: walletSigner,
            instructionChunks,
            useALT: true,
         });
         if (unsigned.length === 0) {
            return;
         }
         const signedBatch = await walletSigner.modifyAndSignTransactions(unsigned);
         for (let chunkIdx = 0; chunkIdx < signedBatch.length; chunkIdx++) {
            const signed = signedBatch[chunkIdx]!;
            assertIsTransactionWithBlockhashLifetime(signed);
            await sendAndConfirm(signed as never, { commitment: "confirmed" });
            const from = chunkIdx * MAX_SETTLE_IX_PER_TX;
            const settledAddresses = new Set(
               bets.slice(from, from + MAX_SETTLE_IX_PER_TX).map((r) => String(r.address)),
            );
            setRows((prev) => prev.filter((row) => !settledAddresses.has(row.address)));
         }
         await load();
      } catch (e) {
         setClaimErr(e instanceof Error ? e.message : String(e));
      } finally {
         setClaimBusy(false);
         claimLockRef.current = false;
      }
   }, [account, isConnected, load, rpc, rpcSubscriptions, signerReady, walletSigner]);

   if (!isConnected || !account) {
      return (
         <main className="my-bets-page">
            <h2 className="my-bets-page__title">My Bets</h2>
            <p className="my-bets-page__hint">Connect your wallet to load bets.</p>
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
         {claimErr != null && betTab === "open" && <p className="my-bets-page__err">{claimErr}</p>}

         <div className="my-bets-page__tabs-row">
            <div className="my-bets-page__tabs" role="tablist" aria-label="Bet groups">
               <button
                  type="button"
                  role="tab"
                  aria-selected={betTab === "open"}
                  className={`my-bets-page__tab${betTab === "open" ? " my-bets-page__tab--active" : ""}`}
                  onClick={() => setBetTab("open")}
               >
                  Open Bets ({rows.length})
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
            {betTab === "open" && settledRows.length > 0 && (
               <button
                  type="button"
                  className="my-bets-page__claim"
                  disabled={claimBusy || state === "loading" || !signerReady || walletSigner == null}
                  title={
                     walletSigner == null
                        ? "Connect a wallet"
                        : !signerReady
                          ? "Wallet signer not ready"
                          : undefined
                  }
                  onClick={() => void runClaim()}
               >
                  {claimBusy
                     ? "Claiming…"
                     : `Claim (${claimTxCount} ${claimTxCount === 1 ? "tx" : "txs"})`}
               </button>
            )}
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
                        {rows.map(({ address: betPda, data: b }) => (
                           <BetCard key={betPda} betPda={betPda} b={b} eventsByKey={eventsByKey} />
                        ))}
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
