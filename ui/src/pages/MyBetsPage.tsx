import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
   createSolanaRpc,
   createSolanaRpcSubscriptions,
   sendAndConfirmTransactionFactory,
   address,
   type Rpc,
   type SolanaRpcApi,
} from "@solana/kit";
import { useCluster, useKitTransactionSigner, useWallet } from "@solana/connector/react";
import { BetResult, getSettleBetIx, getSettleParlayIx, ODDS_SCALE, type BetAccountData } from "spamm-aggregator-sdk";
import { buildSignV0Transaction, httpToWsRpcUrl, resolveHttpRpcUrl } from "../betting/txPipeline";
import { formatUsdcBaseUnitsForUi } from "../betting/usdc";
import {
   fetchClosedBetHistory,
   fetchOpenWalletBets,
   walletBetRowResult,
   type WalletBetRow,
   type WalletParlayLeg,
} from "../markets/fetchBetHistory";
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

/** Effective filled odds from on-chain `payout` / `amount` (unchanged after grading). */
function filledOddsScaledFromStake(amount: bigint, payout: bigint): bigint | null {
   if (amount <= 0n || payout <= 0n) {
      return null;
   }
   return (payout * ODDS_SCALE) / amount;
}

function filledOddsUiFromStake(amount: bigint, payout: bigint): string {
   const scaled = filledOddsScaledFromStake(amount, payout);
   return scaled !== null ? oddsFromScaled(scaled) : "—";
}

/**
 * Settled bet return in USDC base units from stake, filled decimal odds, and grade.
 * Open (pending) bets use on-chain `payout` as max potential instead.
 */
function settledReturnBaseUnits(
   amount: bigint,
   payout: bigint,
   result: BetResult,
   oddsScaled: bigint | null,
): bigint {
   const hasOdds = oddsScaled !== null && oddsScaled > 0n;

   switch (result) {
      case BetResult.Won:
         if (hasOdds) {
            return (amount * oddsScaled) / ODDS_SCALE;
         }
         return payout;
      case BetResult.HalfWon: {
         if (hasOdds) {
            const half = amount / 2n;
            return half + (half * oddsScaled) / ODDS_SCALE;
         }
         return payout;
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
         return payout;
   }
}

function truncateAddressMiddle(addr: string, head = 4, tail = 4): string {
   if (addr.length <= head + tail + 3) {
      return addr;
   }
   return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function solscanAddressUrl(address: string): string {
   return `https://solscan.io/account/${encodeURIComponent(address)}`;
}

function BetBanner({
   betPda,
   betId,
   result,
}: {
   betPda: string;
   betId: bigint;
   result: BetResult;
}): ReactElement {
   return (
      <div className={`my-bets-card__banner my-bets-card__banner--${resultModifierClass(result)}`}>
         <span className="my-bets-card__banner-result">{betResultLabel(result)}</span>
         <div className="my-bets-card__banner-meta">
            <span className="my-bets-card__bet-id" title={`Bet ID ${betId.toString()}`}>
               {betId.toString()}
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
   );
}

function BetStakeGrid({
   amount,
   payout,
   result,
}: {
   amount: bigint;
   payout: bigint;
   result: BetResult;
}): ReactElement {
   const oddsScaled = filledOddsScaledFromStake(amount, payout);
   const oddsUi = filledOddsUiFromStake(amount, payout);
   const settled = result !== BetResult.Pending;
   const payoutLabel = settled ? "Return" : "Potential payout";
   const payoutBase = settled ? settledReturnBaseUnits(amount, payout, result, oddsScaled) : payout;

   return (
      <dl className="my-bets-card__grid">
         <div>
            <dt>Stake</dt>
            <dd>
               <strong>{formatUsdcBaseUnitsForUi(amount)}</strong> USDC
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
   );
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
   const ek = eventLookupKey(b.marketId);
   const lines = betMarketDisplayLines(eventsByKey.get(ek) ?? undefined, b.marketId, b.side);

   return (
      <li className="my-bets-card">
         <BetBanner betPda={betPda} betId={b.betId} result={b.result} />
         <div className="my-bets-card__body">
            <p className="my-bets-card__event-line">
               <span className="my-bets-card__event-title">{lines.eventTitle}</span>
               {lines.liveSuffix !== "" && <span className="my-bets-card__live-mark">{lines.liveSuffix}</span>}
            </p>
            <p className="my-bets-card__market-detail">{lines.detailLine}</p>
            <BetStakeGrid amount={b.amount} payout={b.payout} result={b.result} />
         </div>
      </li>
   );
}

function ParlayLegRow({
   leg,
   legIndex,
   eventsByKey,
}: {
   leg: WalletParlayLeg;
   legIndex: number;
   eventsByKey: ReadonlyMap<string, UiGroupedEvent | null>;
}): ReactElement {
   const ek = eventLookupKey(leg.marketId);
   const lines = betMarketDisplayLines(eventsByKey.get(ek) ?? undefined, leg.marketId, leg.side);
   return (
      <li className="my-bets-card__parlay-leg">
         <span className="my-bets-card__parlay-leg-num" aria-hidden>
            {legIndex + 1}
         </span>
         <div className="my-bets-card__parlay-leg-text">
            <p className="my-bets-card__event-line">
               <span className="my-bets-card__event-title">{lines.eventTitle}</span>
               {lines.liveSuffix !== "" && <span className="my-bets-card__live-mark">{lines.liveSuffix}</span>}
            </p>
            <p className="my-bets-card__market-detail">{lines.detailLine}</p>
         </div>
      </li>
   );
}

function ParlayBetCard({
   betPda,
   row,
   eventsByKey,
}: {
   betPda: string;
   row: Extract<WalletBetRow, { kind: "parlay" }>;
   eventsByKey: ReadonlyMap<string, UiGroupedEvent | null>;
}): ReactElement {
   const legCount = row.legs.length;
   return (
      <li className="my-bets-card my-bets-card--parlay">
         <BetBanner betPda={betPda} betId={row.betId} result={row.result} />
         <div className="my-bets-card__body">
            <p className="my-bets-card__parlay-heading">
               Parlay · {legCount} {legCount === 1 ? "leg" : "legs"}
            </p>
            <ol className="my-bets-card__parlay-legs">
               {row.legs.map((leg, i) => (
                  <ParlayLegRow key={`${betPda}-${i}`} leg={leg} legIndex={i} eventsByKey={eventsByKey} />
               ))}
            </ol>
            <BetStakeGrid amount={row.amount} payout={row.payout} result={row.result} />
         </div>
      </li>
   );
}

function WalletBetCard({
   row,
   eventsByKey,
}: {
   row: WalletBetRow;
   eventsByKey: ReadonlyMap<string, UiGroupedEvent | null>;
}): ReactElement {
   if (row.kind === "parlay") {
      return <ParlayBetCard betPda={row.address} row={row} eventsByKey={eventsByKey} />;
   }
   return <BetCard betPda={row.address} b={row.data} eventsByKey={eventsByKey} />;
}

export function MyBetsPage(): ReactElement {
   const { account, isConnected } = useWallet();
   const { signer: walletSigner, ready: signerReady } = useKitTransactionSigner();
   const { cluster } = useCluster();

   const clusterRpcUrl = useMemo(() => {
      // MAINNET: VITE_SOLANA_RPC_URL — see ui/.env.production
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
   const [rows, setRows] = useState<readonly WalletBetRow[]>([]);
   const [closedState, setClosedState] = useState<LoadState>("idle");
   const [closedErr, setClosedErr] = useState<string | null>(null);
   const [closedRows, setClosedRows] = useState<readonly WalletBetRow[]>([]);
   const [betTab, setBetTab] = useState<MyBetsTab>("open");
   const [eventsByKey, setEventsByKey] = useState<ReadonlyMap<string, UiGroupedEvent | null>>(() => new Map());
   const [claimBusy, setClaimBusy] = useState(false);
   const [claimErr, setClaimErr] = useState<string | null>(null);
   const claimLockRef = useRef(false);

   const settledRows = useMemo(
      () => rows.filter((row) => walletBetRowResult(row) !== BetResult.Pending),
      [rows],
   );

   const claimTxCount = useMemo(
      () => (settledRows.length === 0 ? 0 : Math.ceil(settledRows.length / MAX_SETTLE_IX_PER_TX)),
      [settledRows.length],
   );

   const activeState = betTab === "open" ? state : closedState;
   const activeErr = betTab === "open" ? err : closedErr;
   const openCount = rows.length;
   const closedCount = closedRows.length;
   const activeEmpty = betTab === "open" ? openCount === 0 : closedCount === 0;
   const activeLoading = activeState === "loading" && activeEmpty;

   const eventKeys = useMemo(() => {
      const keys = new Map<string, { sport: number; league: number; event: number }>();
      const tabRows = betTab === "open" ? rows : closedRows;
      for (const row of tabRows) {
         const markets =
            row.kind === "single"
               ? [{ marketId: row.data.marketId }]
               : row.legs.map((leg) => ({ marketId: leg.marketId }));
         for (const { marketId: mid } of markets) {
            const eid = mid.eventId;
            const k = eventLookupKey(mid);
            keys.set(k, { sport: eid.sport, league: eid.league, event: Number(eid.event) });
         }
      }
      return keys;
   }, [betTab, closedRows, rows]);

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

   const loadOpen = useCallback(async () => {
      if (!isConnected || !account) {
         setRows([]);
         setState("idle");
         setErr(null);
         return;
      }
      setState("loading");
      setErr(null);
      try {
         const list = await fetchOpenWalletBets(rpc, account);
         setRows(list);
         setState("ok");
      } catch (e) {
         setErr(e instanceof Error ? e.message : String(e));
         setState("err");
      }
   }, [account, isConnected, rpc]);

   const loadClosed = useCallback(async () => {
      if (!isConnected || !account) {
         setClosedRows([]);
         setClosedState("idle");
         setClosedErr(null);
         return;
      }
      setClosedState("loading");
      setClosedErr(null);
      try {
         const list = await fetchClosedBetHistory(account);
         setClosedRows(list);
         setClosedState("ok");
      } catch (e) {
         setClosedErr(e instanceof Error ? e.message : String(e));
         setClosedState("err");
      }
   }, [account, isConnected]);

   useEffect(() => {
      void loadOpen();
      void loadClosed();
   }, [loadOpen, loadClosed]);

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
         const graded = settledRows.filter((row) => {
            if (row.kind === "parlay" && row.account === undefined) {
               return false;
            }
            return true;
         });
         if (graded.length === 0) {
            return;
         }
         const sendAndConfirm = sendAndConfirmTransactionFactory({
            rpc,
            rpcSubscriptions,
         } as never);
         const instructionList = await Promise.all(
            graded.map((row) => {
               const betPda = address(row.address);
               if (row.kind === "single") {
                  return getSettleBetIx(userAddr, betPda, row.data);
               }
               return getSettleParlayIx(userAddr, betPda, row.account!);
            }),
         );
         const instructionChunks: (typeof instructionList)[] = [];
         for (let i = 0; i < instructionList.length; i += MAX_SETTLE_IX_PER_TX) {
            instructionChunks.push(instructionList.slice(i, i + MAX_SETTLE_IX_PER_TX));
         }
         for (let chunkIdx = 0; chunkIdx < instructionChunks.length; chunkIdx++) {
            const chunk = instructionChunks[chunkIdx]!;
            const signed = await buildSignV0Transaction(rpc, {
               feePayer: walletSigner,
               instructions: chunk,
               signers: [walletSigner],
               useALT: true,
            });
            await sendAndConfirm(signed as never, { commitment: "confirmed" });
            const from = chunkIdx * MAX_SETTLE_IX_PER_TX;
            const settledAddresses = new Set(
               graded.slice(from, from + MAX_SETTLE_IX_PER_TX).map((r) => r.address),
            );
            setRows((prev) => prev.filter((row) => !settledAddresses.has(row.address)));
         }
         await loadOpen();
         void loadClosed();
      } catch (e) {
         setClaimErr(e instanceof Error ? e.message : String(e));
      } finally {
         setClaimBusy(false);
         claimLockRef.current = false;
      }
   }, [account, isConnected, loadClosed, loadOpen, rpc, rpcSubscriptions, settledRows, signerReady, walletSigner]);

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
            <button
               type="button"
               className="my-bets-page__refresh"
               disabled={activeState === "loading"}
               onClick={() => void (betTab === "open" ? loadOpen() : loadClosed())}
            >
               {activeState === "loading" ? "Refreshing…" : "Refresh"}
            </button>
         </div>

         {activeState === "err" && activeErr != null && <p className="my-bets-page__err">{activeErr}</p>}
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
                  Closed Bets ({closedRows.length})
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
            {activeLoading && <p className="my-bets-page__loading">Loading bets…</p>}

            {activeState === "ok" && activeEmpty && (
               <p className="my-bets-page__empty">
                  {betTab === "open" ? "No bets found for this wallet." : "No closed bets found for this wallet."}
               </p>
            )}

            {betTab === "open" && openCount > 0 && (
               <ul className="my-bets-list">
                  {rows.map((row) => (
                     <WalletBetCard key={row.address} row={row} eventsByKey={eventsByKey} />
                  ))}
               </ul>
            )}

            {betTab === "closed" && closedCount > 0 && (
               <ul className="my-bets-list">
                  {closedRows.map((row) => (
                     <WalletBetCard key={row.address} row={row} eventsByKey={eventsByKey} />
                  ))}
               </ul>
            )}
         </div>
      </main>
   );
}
