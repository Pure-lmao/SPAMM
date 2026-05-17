import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
   createSolanaRpc,
   createSolanaRpcSubscriptions,
   getSignatureFromTransaction,
   sendAndConfirmTransactionFactory,
   address,
   type Address,
   type Rpc,
   type SolanaRpcApi,
} from "@solana/kit";
import { useCluster, useConnectWallet, useKitTransactionSigner, useWallet, useWalletConnectors } from "@solana/connector/react";
import { ODDS_SCALE, type MarketId } from "spamm-aggregator-sdk";
import { apiSportToSdk, buildMarketId } from "./chainIds";
import { pickBetSide } from "./outcomeSide";
import { buildAndSignFillBetTx, runMmQuoteFlow } from "./quoteAndFill";
import type { BetModalOpenContext } from "./types";
import { httpToWsRpcUrl, resolveHttpRpcUrl } from "./txPipeline";
import { formatUsdcBaseUnitsForUi, parseUsdcAmountUiToBaseUnits } from "./usdc";

type BetModalProps = Readonly<{
   open: BetModalOpenContext | null;
   onClose: () => void;
}>;

type SendPhase = "idle" | "signing" | "confirming" | "done";

/**
 * Stand-in user passed into `getMmGetQuoteIx` when disconnected. Quote return data is still obtained
 * via `simulateInstructionReturnData` in `txPipeline.ts`, which builds the sim tx with a noop fee payer.
 */
const SIM_VIEWER_ADDRESS = address("BqQKZKbnYMpmQEtoCjvaDVTdhfpbaCQuBiSngNKu6YQW");

function parseMinOddsScaled(raw: string, fallback: bigint): bigint {
   const t = raw.trim();
   if (!t) {
      return fallback;
   }
   const n = Number(t);
   if (!Number.isFinite(n) || n <= 0) {
      return fallback;
   }
   return BigInt(Math.round(n * Number(ODDS_SCALE)));
}

function nextBetId(): bigint {
   return BigInt(Date.now());
}

export function BetModal({ open, onClose }: BetModalProps): ReactElement | null {
   const [amount, setAmount] = useState("");
   const [minOdds, setMinOdds] = useState("");
   const [quoteStatus, setQuoteStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
   const [quoteErr, setQuoteErr] = useState<string | null>(null);
   const [conservativeMin, setConservativeMin] = useState<bigint>(ODDS_SCALE + 100n);
   const [quoteRows, setQuoteRows] = useState<readonly { mmProgramAddress: Address; maxAmount: bigint; oddsScaled: bigint }[]>(
      [],
   );
   const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
   const [sendErr, setSendErr] = useState<string | null>(null);
   const [lastSig, setLastSig] = useState<string | null>(null);
   const sendLockRef = useRef(false);

   const { account, isConnected } = useWallet();
   const { signer, ready: signerReady } = useKitTransactionSigner();
   const { cluster } = useCluster();
   const { connect, isConnecting: connectBusy, resetError } = useConnectWallet();
   const connectors = useWalletConnectors();

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

   useEffect(() => {
      if (open) {
         setAmount("10");
         setMinOdds("");
         setQuoteErr(null);
         setConservativeMin(ODDS_SCALE + 100n);
         setQuoteRows([]);
         setSendErr(null);
         setLastSig(null);
         setSendPhase("idle");
      } else {
         setQuoteStatus("idle");
      }
   }, [open]);

   useEffect(() => {
      if (open === null) {
         return;
      }
      const onKey = (e: KeyboardEvent) => {
         if (e.key === "Escape") {
            onClose();
         }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
   }, [open, onClose]);

   const runQuotes = useCallback(async () => {
      if (!open) {
         return;
      }
      const amt = parseUsdcAmountUiToBaseUnits(amount);
      if (amt === null || amt <= 0n) {
         setQuoteStatus("err");
         setQuoteErr("Enter a valid stake amount.");
         return;
      }

      setQuoteStatus("loading");
      setQuoteErr(null);

      const sport = apiSportToSdk(open.sportApiId);
      const marketId: MarketId = buildMarketId(
         open.eventId,
         open.leagueId,
         sport,
         open.marketWireId,
         open.periodId,
      );
      const side = pickBetSide(open.column, open.mktString, open.outcomeIndex);
      const userAddress = isConnected && account != null ? address(account) : SIM_VIEWER_ADDRESS;

      try {
         const q = await runMmQuoteFlow({
            rpc,
            userAddress,
            marketId,
            side,
            amount: amt,
         });
         if (q.topMms.length === 0) {
            setQuoteStatus("err");
            const hint =
               q.errors.length > 0
                  ? q.errors.slice(0, 3).join(" · ")
                  : "No MM returned a quote for this market (wrong cluster, missing on-chain market, or amount too large).";
            setQuoteErr(hint);
            setQuoteRows([]);
            setMinOdds("");
            return;
         }
         setConservativeMin(q.conservativeMinOddsScaled);
         setMinOdds((Number(q.conservativeMinOddsScaled) / Number(ODDS_SCALE)).toFixed(4).replace(/\.?0+$/, ""));
         setQuoteRows(q.topMms);
         setQuoteStatus("ok");
      } catch (e) {
         setQuoteStatus("err");
         setQuoteErr(e instanceof Error ? e.message : String(e));
         setQuoteRows([]);
      }
   }, [open, isConnected, account, amount, rpc]);

   useEffect(() => {
      if (!open) {
         return;
      }
      const t = window.setTimeout(() => {
         void runQuotes();
      }, 450);
      return () => window.clearTimeout(t);
   }, [open, amount, runQuotes]);

   const onConnectClick = useCallback(() => {
      resetError();
      const ready = connectors.find((c) => c.ready);
      const c = ready ?? connectors[0];
      if (c == null) {
         return;
      }
      void connect(c.id);
   }, [connect, connectors, resetError]);

   const runSendPipeline = async (isReplay: boolean) => {
      if (sendLockRef.current) {
         return;
      }
      sendLockRef.current = true;
      try {
         setSendErr(null);

         if (!open) {
            return;
         }
         if (!isConnected || account == null || signer == null) {
            setSendErr("Connect a wallet to place a bet.");
            return;
         }
         if (!signerReady) {
            setSendErr("Wallet signer not ready.");
            return;
         }
         const amt = parseUsdcAmountUiToBaseUnits(amount);
         if (amt === null || amt <= 0n) {
            setSendErr("Invalid amount.");
            return;
         }
         if (quoteRows.length === 0) {
            setSendErr("No MM routes from quotes. Wait for quotes or reduce amount.");
            return;
         }
         const minScaled = parseMinOddsScaled(minOdds, conservativeMin);
         if (minScaled <= ODDS_SCALE) {
            setSendErr("Min. odds must be above 1.00 (scaled > ODDS_SCALE).");
            return;
         }

         if (isReplay) {
            setLastSig(null);
            setSendPhase("idle");
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
         } else {
            setLastSig(null);
         }

         setSendPhase("signing");
         try {
            const sport = apiSportToSdk(open.sportApiId);
            const marketId = buildMarketId(
               open.eventId,
               open.leagueId,
               sport,
               open.marketWireId,
               open.periodId,
            );
            const side = pickBetSide(open.column, open.mktString, open.outcomeIndex);
            const userAddress = address(account);

            const signed = await buildAndSignFillBetTx({
               rpc,
               walletSigner: signer,
               userAddress,
               fill: {
                  betId: nextBetId(),
                  marketId,
                  side,
                  amount: amt,
                  minOddsScaled: minScaled,
               },
               mmPrograms: quoteRows.map((r) => r.mmProgramAddress),
            });

            setSendPhase("confirming");
            const sendAndConfirm = sendAndConfirmTransactionFactory({
               rpc,
               rpcSubscriptions,
            } as never);
            await sendAndConfirm(signed as never, { commitment: "confirmed" });
            setLastSig(getSignatureFromTransaction(signed));
            setSendPhase("done");
         } catch (e) {
            setSendErr(e instanceof Error ? e.message : String(e));
            setSendPhase("idle");
            setLastSig(null);
         }
      } finally {
         sendLockRef.current = false;
      }
   };

   if (open === null) {
      return null;
   }

   const needsWallet = !isConnected || account == null || signer == null;

   const canConnect = !connectBusy && connectors.length > 0;
   const canPlaceBet =
      quoteStatus === "ok" &&
      quoteRows.length > 0 &&
      (sendPhase === "idle" || sendPhase === "done") &&
      signerReady &&
      signer != null;

   const primaryDisabled = needsWallet ? !canConnect : !canPlaceBet;

   const primaryLabel = needsWallet
      ? connectBusy
         ? "Connecting…"
         : "Connect wallet"
      : sendPhase === "signing"
        ? "Awaiting wallet confirmation…"
        : sendPhase === "confirming"
          ? "Sending transaction"
          : sendPhase === "done"
            ? "Place Again?"
            : "Place bet";

   return (
      <div
         className="bet-modal-overlay"
         role="presentation"
         onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
               onClose();
            }
         }}
      >
         <div
            className="bet-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bet-modal-title"
            onMouseDown={(e) => e.stopPropagation()}
         >
            <header className="bet-modal-header">
               <h2 id="bet-modal-title" className="bet-modal-title">
                  Place bet
               </h2>
               <button type="button" className="bet-modal-close" onClick={onClose} aria-label="Close">
                  ×
               </button>
            </header>

            <div className="bet-modal-body">
               <dl className="bet-modal-meta">
                  <div className="bet-modal-meta-row">
                     <dt>Event</dt>
                     <dd>{open.eventTitle}</dd>
                  </div>
                  <div className="bet-modal-meta-row">
                     <dt>Market</dt>
                     <dd className="bet-modal-market-name">{open.marketLabel}</dd>
                  </div>
                  {open.displayedDecimalOdds != null && open.displayedDecimalOdds !== 0 && (
                     <div className="bet-modal-meta-row">
                        <dt>Est. Odds</dt>
                        <dd className="odds-value">{open.displayedDecimalOdds.toFixed(2)}</dd>
                     </div>
                  )}
               </dl>

               <div className="bet-modal-fields">
                  <label className="bet-modal-field">
                     <span className="bet-modal-field-label">Amount (USDC)</span>
                     <input
                        className="bet-modal-input"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="e.g. 10"
                     />
                  </label>
                  <label className="bet-modal-field">
                     <span className="bet-modal-field-label">Min. odds (decimal)</span>
                     <input
                        className="bet-modal-input"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={minOdds}
                        onChange={(e) => setMinOdds(e.target.value)}
                        placeholder="Fetching quotes..."
                     />
                  </label>
               </div>

               <div className="bet-modal-quote">
                  <div className="bet-modal-quote-head">Market offers</div>
                  {quoteStatus === "loading" && (
                     <p className="bet-modal-muted" role="status">
                        Fetching best odds
                     </p>
                  )}
                  {quoteStatus === "err" && quoteErr != null && <p className="bet-modal-err">{quoteErr}</p>}
                  {quoteStatus === "ok" && (
                     <ul className="bet-modal-mm-list">
                        {quoteRows.map((row, i) => {
                           const dec = Number(row.oddsScaled) / Number(ODDS_SCALE);
                           return (
                              <li key={`${row.mmProgramAddress}-${i}`} className="bet-modal-mono">
                                 {i + 1}. {String(row.mmProgramAddress).slice(0, 8)}… {formatUsdcBaseUnitsForUi(row.maxAmount)} USDC @{" "}
                                 <span className="odds-value">{dec.toFixed(3)}</span>
                              </li>
                           );
                        })}
                     </ul>
                  )}
               </div>

               {sendErr != null && <p className="bet-modal-err">{sendErr}</p>}
               {lastSig != null && (
                  <p className="bet-modal-ok">
                     Sent: <span className="bet-modal-mono">{lastSig}</span>
                  </p>
               )}
            </div>

            <footer className="bet-modal-footer">
               <button type="button" className="bet-modal-btn bet-modal-btn--ghost" onClick={onClose}>
                  Cancel
               </button>
               <button
                  type="button"
                  className={
                     !needsWallet && sendPhase === "confirming"
                        ? "bet-modal-btn bet-modal-btn--primary bet-modal-btn--tx-confirming"
                        : "bet-modal-btn bet-modal-btn--primary"
                  }
                  disabled={primaryDisabled}
                  onClick={() => {
                     if (needsWallet) {
                        onConnectClick();
                        return;
                     }
                     void runSendPipeline(sendPhase === "done");
                  }}
               >
                  {primaryLabel}
               </button>
            </footer>
         </div>
      </div>
   );
}
