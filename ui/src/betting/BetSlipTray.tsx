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
import { getBetData, getParlayData, ODDS_SCALE, type BetAccountData } from "spamm-aggregator-sdk";
import {
   calcPotentialPayoutBase,
   oddsDecimalLabel,
   parlayLegFromSelection,
   parseMinOddsScaled,
   solscanTxUrl,
} from "./betSlipUtils";
import { useBetSlip } from "./BetSlipContext";
import { nextBetId } from "./nextBetId";
import { buildAndSignFillBetTx, buildAndSignFillParlayTx, runMmParlayQuoteFlow, runMmQuoteFlow } from "./quoteAndFill";
import { apiSportToSdk, buildMarketId } from "./chainIds";
import { pickBetSide } from "./outcomeSide";
import { httpToWsRpcUrl, resolveHttpRpcUrl } from "./txPipeline";
import { formatUsdcBaseUnitsForUi, parseUsdcAmountUiToBaseUnits } from "./usdc";

const SIM_VIEWER_ADDRESS = address("BqQKZKbnYMpmQEtoCjvaDVTdhfpbaCQuBiSngNKu6YQW");

type SendPhase = "idle" | "signing" | "confirming" | "done";

type PlacedBetSummary = Readonly<{
   signature: string;
   stakeLabel: string;
   oddsLabel: string;
   /** On-chain payout from filled bet account (potential return at settlement). */
   filledPayoutLabel: string | null;
   betId: string;
   isParlay: boolean;
   detailErr?: string;
}>;

function primaryFill(b: BetAccountData): BetAccountData["filler0"] | undefined {
   return [b.filler0, b.filler1, b.filler2, b.filler3, b.filler4].find((f) => f.amount > 0n);
}

export function BetSlipTray(): ReactElement | null {
   const { selections, expanded, setExpanded, clearSlip, removeSelection, setSlipLocked, slipLocked } = useBetSlip();
   const isParlay = selections.length >= 2;
   const isCollapsed = isParlay && !expanded;

   const [amount, setAmount] = useState("");
   const [minOdds, setMinOdds] = useState("");
   const [quoteStatus, setQuoteStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
   const [quoteErr, setQuoteErr] = useState<string | null>(null);
   const [conservativeMin, setConservativeMin] = useState<bigint>(ODDS_SCALE + 100n);
   const [quoteRows, setQuoteRows] = useState<readonly { mmProgramAddress: Address; maxAmount: bigint; oddsScaled: bigint }[]>(
      [],
   );
   const [quoteMmErrors, setQuoteMmErrors] = useState<readonly string[]>([]);
   const [bestParlayMm, setBestParlayMm] = useState<Address | null>(null);
   const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
   const [sendErr, setSendErr] = useState<string | null>(null);
   const [placedBetSummary, setPlacedBetSummary] = useState<PlacedBetSummary | null>(null);
   const sendLockRef = useRef(false);
   const prevCountRef = useRef(0);
   const legsAtPlaceRef = useRef<string | null>(null);

   const { account, isConnected } = useWallet();
   const { signer, ready: signerReady } = useKitTransactionSigner();
   const { cluster } = useCluster();
   const { connect, isConnecting: connectBusy, resetError } = useConnectWallet();
   const connectors = useWalletConnectors();

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

   useEffect(() => {
      const n = selections.length;
      if (n === 0) {
         setAmount("");
         setMinOdds("");
         setQuoteErr(null);
         setQuoteRows([]);
         setQuoteMmErrors([]);
         setBestParlayMm(null);
         setSendErr(null);
         setPlacedBetSummary(null);
         setSendPhase("idle");
         setQuoteStatus("idle");
         prevCountRef.current = 0;
         return;
      }
      if (prevCountRef.current === 0) {
         setAmount("10");
      }
      prevCountRef.current = n;
      setQuoteErr(null);
      setQuoteRows([]);
      setQuoteMmErrors([]);
      setBestParlayMm(null);
      setSendErr(null);
      setPlacedBetSummary(null);
      setSendPhase("idle");
   }, [selections.length, selections.map((s) => s.id).join("|")]);

   const runQuotes = useCallback(async () => {
      if (selections.length === 0) {
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
      setQuoteMmErrors([]);
      const userAddress = isConnected && account != null ? address(account) : SIM_VIEWER_ADDRESS;

      try {
         if (selections.length === 1) {
            const sel = selections[0]!;
            const sport = apiSportToSdk(sel.sportApiId);
            const marketId = buildMarketId(sel.eventId, sel.leagueId, sport, sel.marketWireId, sel.periodId);
            const side = pickBetSide(sel.column, sel.mktString, sel.outcomeIndex);
            const q = await runMmQuoteFlow({ rpc, userAddress, marketId, side, amount: amt });
            if (q.topMms.length === 0) {
               setQuoteStatus("err");
               const hint =
                  q.errors.length > 0
                     ? q.errors.slice(0, 3).join(" · ")
                     : "No MM returned a quote (wrong cluster, missing market, or amount too large).";
               setQuoteErr(hint);
               setQuoteRows([]);
               setQuoteMmErrors(q.errors);
               setMinOdds("");
               return;
            }
            setConservativeMin(q.conservativeMinOddsScaled);
            setMinOdds((Number(q.conservativeMinOddsScaled) / Number(ODDS_SCALE)).toFixed(4).replace(/\.?0+$/, ""));
            setQuoteRows(q.topMms);
            setQuoteMmErrors(q.errors);
            setBestParlayMm(null);
            setQuoteStatus("ok");
         } else {
            const legs = selections.map(parlayLegFromSelection);
            const q = await runMmParlayQuoteFlow({ rpc, userAddress, legs, amount: amt });
            if (q.bestMm === null) {
               setQuoteStatus("err");
               const hint =
                  q.errors.length > 0
                     ? q.errors.slice(0, 3).join(" · ")
                     : "No MM returned a parlay quote for these legs.";
               setQuoteErr(hint);
               setQuoteRows([]);
               setQuoteMmErrors(q.errors);
               setBestParlayMm(null);
               setMinOdds("");
               return;
            }
            setConservativeMin(q.conservativeMinOddsScaled);
            setMinOdds((Number(q.conservativeMinOddsScaled) / Number(ODDS_SCALE)).toFixed(4).replace(/\.?0+$/, ""));
            setQuoteRows(q.topMms);
            setQuoteMmErrors(q.errors);
            setBestParlayMm(q.bestMm.mmProgramAddress);
            setQuoteStatus("ok");
         }
      } catch (e) {
         setQuoteStatus("err");
         setQuoteErr(e instanceof Error ? e.message : String(e));
         setQuoteRows([]);
         setQuoteMmErrors([]);
         setBestParlayMm(null);
      }
   }, [selections, isConnected, account, amount, rpc]);

   useEffect(() => {
      if (selections.length === 0 || isCollapsed) {
         return;
      }
      const t = window.setTimeout(() => {
         void runQuotes();
      }, 450);
      return () => window.clearTimeout(t);
   }, [selections, amount, runQuotes, isCollapsed]);

   const minOddsScaled = useMemo(
      () => parseMinOddsScaled(minOdds, conservativeMin),
      [minOdds, conservativeMin],
   );

   const potentialReturnLabel = useMemo(() => {
      if (placedBetSummary?.filledPayoutLabel != null) {
         return placedBetSummary.filledPayoutLabel;
      }
      const amt = parseUsdcAmountUiToBaseUnits(amount);
      if (amt === null || amt <= 0n || minOddsScaled <= ODDS_SCALE) {
         return "—";
      }
      const payout = calcPotentialPayoutBase(amt, minOddsScaled);
      if (payout === null) {
         return "—";
      }
      return `${formatUsdcBaseUnitsForUi(payout)} USDC`;
   }, [amount, minOddsScaled, placedBetSummary?.filledPayoutLabel]);

   const onConnectClick = useCallback(() => {
      resetError();
      const ready = connectors.find((c) => c.ready);
      const c = ready ?? connectors[0];
      if (c == null) {
         return;
      }
      void connect(c.id);
   }, [connect, connectors, resetError]);

   const reuseSelections = useCallback(() => {
      setPlacedBetSummary(null);
      setSendPhase("idle");
      setSendErr(null);
   }, []);

   useEffect(() => {
      setSlipLocked(sendPhase === "signing" || sendPhase === "confirming");
   }, [sendPhase, setSlipLocked]);

   useEffect(() => {
      if (sendPhase !== "done") {
         if (sendPhase === "idle") {
            legsAtPlaceRef.current = null;
         }
         return;
      }
      const sig = selections.map((s) => s.id).join("|");
      if (legsAtPlaceRef.current === null) {
         legsAtPlaceRef.current = sig;
         return;
      }
      if (sig !== legsAtPlaceRef.current) {
         setPlacedBetSummary(null);
         setSendPhase("idle");
         legsAtPlaceRef.current = null;
      }
   }, [selections, sendPhase]);

   const dismissSlip = useCallback(() => {
      setPlacedBetSummary(null);
      setSendErr(null);
      setSendPhase("idle");
      clearSlip();
   }, [clearSlip]);

   const runSendPipeline = async () => {
      if (sendLockRef.current || selections.length === 0) {
         return;
      }
      sendLockRef.current = true;
      try {
         setSendErr(null);

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
         const minScaled = parseMinOddsScaled(minOdds, conservativeMin);
         if (minScaled <= ODDS_SCALE) {
            setSendErr("Min. odds must be above 1.00 (scaled > ODDS_SCALE).");
            return;
         }

         if (isParlay) {
            if (bestParlayMm === null) {
               setSendErr("No parlay quote available. Wait for quotes or adjust stake.");
               return;
            }
         } else if (quoteRows.length === 0) {
            setSendErr("No MM routes from quotes. Wait for quotes or reduce amount.");
            return;
         }

         setPlacedBetSummary(null);
         setSendPhase("signing");
         try {
            const userAddress = address(account);
            const betId = nextBetId();

            const signed = isParlay
               ? await buildAndSignFillParlayTx({
                    rpc,
                    walletSigner: signer,
                    userAddress,
                    mmProgram: bestParlayMm!,
                    fill: {
                       betId,
                       amount: amt,
                       minOddsScaled: minScaled,
                       numLegs: selections.length,
                       legs: selections.map(parlayLegFromSelection),
                    },
                 })
               : await (async () => {
                    const sel = selections[0]!;
                    const sport = apiSportToSdk(sel.sportApiId);
                    const marketId = buildMarketId(
                       sel.eventId,
                       sel.leagueId,
                       sport,
                       sel.marketWireId,
                       sel.periodId,
                    );
                    const side = pickBetSide(sel.column, sel.mktString, sel.outcomeIndex);
                    return buildAndSignFillBetTx({
                       rpc,
                       walletSigner: signer,
                       userAddress,
                       fill: {
                          betId,
                          marketId,
                          side,
                          amount: amt,
                          minOddsScaled: minScaled,
                       },
                       mmPrograms: quoteRows.map((r) => r.mmProgramAddress),
                    });
                 })();

            setSendPhase("confirming");
            const sendAndConfirm = sendAndConfirmTransactionFactory({
               rpc,
               rpcSubscriptions,
            } as never);
            await sendAndConfirm(signed as never, { commitment: "confirmed" });
            const signature = getSignatureFromTransaction(signed);

            let stakeLabel = formatUsdcBaseUnitsForUi(amt);
            let oddsLabel = "—";
            let filledPayoutLabel: string | null = null;
            let detailErr: string | undefined;
            try {
               if (isParlay) {
                  const bet = await getParlayData(rpc, { user: userAddress, betId });
                  stakeLabel = formatUsdcBaseUnitsForUi(bet.amount);
                  if (bet.payout > 0n) {
                     filledPayoutLabel = `${formatUsdcBaseUnitsForUi(bet.payout)} USDC`;
                  }
                  if (bet.amount > 0n && bet.payout > 0n) {
                     const scaled = (bet.payout * ODDS_SCALE) / bet.amount;
                     oddsLabel = oddsDecimalLabel(scaled);
                  }
               } else {
                  const bet = await getBetData(rpc, { user: userAddress, betId });
                  stakeLabel = formatUsdcBaseUnitsForUi(bet.amount);
                  if (bet.payout > 0n) {
                     filledPayoutLabel = `${formatUsdcBaseUnitsForUi(bet.payout)} USDC`;
                  }
                  const fill = primaryFill(bet);
                  if (fill !== undefined && fill.oddsScaled > 0n) {
                     oddsLabel = oddsDecimalLabel(fill.oddsScaled);
                     if (filledPayoutLabel === null && bet.amount > 0n) {
                        const est = calcPotentialPayoutBase(bet.amount, fill.oddsScaled);
                        if (est !== null) {
                           filledPayoutLabel = `${formatUsdcBaseUnitsForUi(est)} USDC`;
                        }
                     }
                  } else if (bet.amount > 0n && bet.payout > 0n) {
                     const scaled = (bet.payout * ODDS_SCALE) / bet.amount;
                     oddsLabel = oddsDecimalLabel(scaled);
                  }
               }
            } catch (e) {
               detailErr = e instanceof Error ? e.message : String(e);
            }

            setPlacedBetSummary({
               signature,
               stakeLabel,
               oddsLabel,
               filledPayoutLabel,
               betId: betId.toString(),
               isParlay,
               detailErr,
            });
            setSendPhase("done");
         } catch (e) {
            setSendErr(e instanceof Error ? e.message : String(e));
            setSendPhase("idle");
            setPlacedBetSummary(null);
         }
      } finally {
         sendLockRef.current = false;
      }
   };

   if (selections.length === 0) {
      return null;
   }

   const needsWallet = !isConnected || account == null || signer == null;
   const canConnect = !connectBusy && connectors.length > 0;
   const quotesReady = isParlay ? bestParlayMm !== null : quoteRows.length > 0;
   const canPlaceBet =
      quoteStatus === "ok" &&
      quotesReady &&
      (sendPhase === "idle" || sendPhase === "done") &&
      signerReady &&
      signer != null;
   const primaryDisabled = needsWallet ? !canConnect : !canPlaceBet;

   const headerTitle =
      selections.length === 1 ? "Single Bet" : `${selections.length} Selections`;

   const primaryLabel = needsWallet
      ? connectBusy
         ? "Connecting…"
         : "Connect wallet"
      : sendPhase === "signing"
        ? "Sign in wallet…"
        : sendPhase === "confirming"
          ? "Sending…"
          : sendPhase === "done"
            ? `Reuse selection${selections.length > 1 ? "s" : ""}`
            : "Place bet";

   const onHeaderClick = () => {
      if (isParlay) {
         setExpanded(!expanded);
      }
   };

   const selectionBlock = (sel: (typeof selections)[number]) => (
      <div className="bet-slip-tray__selection-text">
         <span className="bet-slip-tray__selection-market">{sel.marketLabel}</span>
         <span className="bet-slip-tray__selection-event">{sel.eventTitle}</span>
      </div>
   );

   return (
      <div className="bet-slip-tray-dock">
         <div
            className={`bet-slip-tray${isCollapsed ? " bet-slip-tray--collapsed" : " bet-slip-tray--expanded"}`}
            role="region"
            aria-label="Bet slip"
         >
         <header
            className={`bet-slip-tray__header${isParlay ? " bet-slip-tray__header--toggle" : ""}`}
            onClick={onHeaderClick}
            onKeyDown={(e) => {
               if (isParlay && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setExpanded(!expanded);
               }
            }}
            {...(isParlay ? { role: "button", tabIndex: 0, "aria-expanded": expanded } : {})}
         >
            <h2 className="bet-slip-tray__title">{headerTitle}</h2>
            {sendPhase === "done" && (
               <button
                  type="button"
                  className="bet-slip-tray__dismiss"
                  aria-label="Dismiss bet slip"
                  onClick={(e) => {
                     e.stopPropagation();
                     dismissSlip();
                  }}
               >
                  ×
               </button>
            )}
         </header>

         {!isCollapsed && (
            <div className="bet-slip-tray__body">
               <div className="bet-slip-tray__top">
                  {selections.length === 1 ? (
                     <div className="bet-slip-tray__leg">
                        {selectionBlock(selections[0]!)}
                        {!slipLocked && (
                           <button
                              type="button"
                              className="bet-slip-tray__leg-remove"
                              aria-label={`Remove ${selections[0]!.marketLabel}`}
                              onClick={() => removeSelection(selections[0]!.id)}
                           >
                              ×
                           </button>
                        )}
                     </div>
                  ) : (
                     <ul className="bet-slip-tray__legs">
                        {selections.map((sel) => (
                           <li key={sel.id} className="bet-slip-tray__leg">
                              {selectionBlock(sel)}
                              {!slipLocked && (
                                 <button
                                    type="button"
                                    className="bet-slip-tray__leg-remove"
                                    aria-label={`Remove ${sel.marketLabel}`}
                                    onClick={() => removeSelection(sel.id)}
                                 >
                                    ×
                                 </button>
                              )}
                           </li>
                        ))}
                     </ul>
                  )}

                  {!slipLocked && (
                     <button
                        type="button"
                        className="bet-slip-tray__clear-all"
                        onClick={() => {
                           if (sendPhase === "done") {
                              dismissSlip();
                              return;
                           }
                           clearSlip();
                        }}
                     >
                        {sendPhase === "done" ? "Dismiss" : "Clear all"}
                     </button>
                  )}

                  <div className="bet-slip-tray__fields">
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
                        placeholder="Fetching quotes…"
                     />
                  </label>
                  </div>
               </div>

               {sendErr != null && <p className="bet-modal-err">{sendErr}</p>}
               {placedBetSummary != null && (
                  <div className="bet-modal-placed" role="status">
                     <div className="bet-modal-placed-title">Bet placed</div>
                     <dl className="bet-modal-meta bet-modal-placed-meta">
                        <div className="bet-modal-meta-row">
                           <dt>Stake filled</dt>
                           <dd>
                              <strong>{placedBetSummary.stakeLabel}</strong> USDC
                           </dd>
                        </div>
                        <div className="bet-modal-meta-row">
                           <dt>Total odds</dt>
                           <dd className="odds-value">
                              <strong>{placedBetSummary.oddsLabel}</strong>
                           </dd>
                        </div>
                        <div className="bet-modal-meta-row">
                           <dt>Bet ID</dt>
                           <dd className="bet-modal-mono">{placedBetSummary.betId}</dd>
                        </div>
                     </dl>
                     {placedBetSummary.detailErr != null && (
                        <p className="bet-modal-muted bet-modal-placed-warn">
                           Could not load on-chain details: {placedBetSummary.detailErr}
                        </p>
                     )}
                     <p className="bet-modal-muted bet-modal-placed-tx">
                        <a
                           href={solscanTxUrl(placedBetSummary.signature)}
                           target="_blank"
                           rel="noopener noreferrer"
                           className="inline-nav-link"
                        >
                           View transaction
                        </a>
                     </p>
                  </div>
               )}

               <div className="bet-slip-tray__footer-row">
               <div className="bet-modal-quote">
                  <div className="bet-modal-quote-head">Market offers</div>
                  {quoteStatus === "loading" && (
                     <p className="bet-modal-muted" role="status">
                        Fetching best odds
                     </p>
                  )}
                  {quoteStatus === "err" && quoteErr != null && <p className="bet-modal-err">{quoteErr}</p>}
                  {quoteStatus === "ok" && quoteRows.length > 0 && (
                     <ul className="bet-modal-mm-list">
                        {quoteRows.map((row, i) => {
                           const dec = Number(row.oddsScaled) / Number(ODDS_SCALE);
                           const isBest = isParlay
                              ? bestParlayMm !== null && row.mmProgramAddress === bestParlayMm
                              : i === 0;
                           return (
                              <li
                                 key={`${row.mmProgramAddress}-${i}`}
                                 className={`bet-modal-mono${isBest ? " bet-slip-tray__mm-row--best" : ""}`}
                              >
                                 {i + 1}. {String(row.mmProgramAddress).slice(0, 8)}…{" "}
                                 {formatUsdcBaseUnitsForUi(row.maxAmount)} USDC @{" "}
                                 <span className="odds-value">{dec.toFixed(3)}</span>
                                 {isBest ? " (best)" : ""}
                              </li>
                           );
                        })}
                     </ul>
                  )}
                  {quoteStatus === "ok" && quoteMmErrors.length > 0 && (
                     <p className="bet-modal-muted bet-slip-tray__mm-errors">
                        Some MMs did not quote: {quoteMmErrors.slice(0, 2).join(" · ")}
                        {quoteMmErrors.length > 2 ? " …" : ""}
                     </p>
                  )}
               </div>

               <div className="bet-slip-tray__actions">
                  <div className="bet-slip-tray__return">
                     <span className="bet-slip-tray__return-label">Potential return</span>
                     <span className="bet-slip-tray__return-value">{potentialReturnLabel}</span>
                  </div>
                  <div className="bet-slip-tray__action-btns">
                     {sendPhase === "done" && (
                        <button
                           type="button"
                           className="bet-modal-btn bet-modal-btn--ghost"
                           onClick={() => dismissSlip()}
                        >
                           Dismiss
                        </button>
                     )}
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
                           if (sendPhase === "done") {
                              reuseSelections();
                              return;
                           }
                           void runSendPipeline();
                        }}
                     >
                        {primaryLabel}
                     </button>
                  </div>
               </div>
               </div>
            </div>
         )}
         </div>
      </div>
   );
}
