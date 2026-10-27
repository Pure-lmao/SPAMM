import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
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
import { useCluster, useConnectWallet, useWallet, useWalletConnectors } from "@solana/connector/react";
import { useAppTransactionSigner } from "../wallet/useAppTransactionSigner";
import { signErrorMessageForUi } from "../wallet/walletStandardV1Signer";
import { requestWalletBalanceRefresh } from "../wallet/walletBalanceRefresh";
import {
   getBetData,
   getParlayData,
   MAX_PARLAY_LEGS,
   MAX_RFQ_PARLAY_LEGS,
   ODDS_SCALE,
   type BetAccountData,
   type RfqHttpRequestJson,
   type RfqQuoteJson,
} from "spamm-aggregator-sdk";
import {
   calcPotentialPayoutBase,
   calcPotentialProfitBase,
   userWinCreditBase,
   buildMarketIdForSelection,
   parlayLegFromSelection,
   parseMinOddsScaled,
   quoteErrorMessageForUi,
   quoteErrorsSummaryForUi,
   solscanTxUrl,
} from "./betSlipUtils";
import { useBetSlip } from "./BetSlipContext";
import { nextBetId } from "./nextBetId";
import {
   buildAndSignFillBetTx,
   buildAndSignFillParlayTx,
   buildAndSignFillRfqTx,
   runMmParlayQuoteFlow,
   runMmQuoteFlow,
   type BoostFillRef,
   type FreebetFillRef,
} from "./quoteAndFill";
import {
   boostKey,
   boostPickerLabel,
   boostedPayoutBase,
   explainFreebetOdds,
   explainFreebetOddsForQuotes,
   fetchAvailableBoosts,
   fetchAvailableFreebets,
   filterQuoteRowsForFreebet,
   freebetKey,
   freebetPickerLabel,
   withBoostEligibility,
   withSlipEligibility,
   type SlipBoost,
   type SlipFreebet,
} from "./freebets";
import { subscribeFreebetRefresh } from "./freebetRefresh";
import { requestRfqQuotes, rfqRequestBody, rfqFillFromResponse, rfqQuoteRejectReason, sortRfqQuotes } from "./rfqPlace";
import { SIM_FEE_PAYER_ADDRESS } from "./chainIds";
import { pickBetSide } from "./outcomeSide";
import { httpToWsRpcUrl, resolveAppHttpRpcUrl } from "./txPipeline";
import { formatUsdcBaseUnitsForUi, parseUsdcAmountUiToBaseUnits } from "./usdc";
import { AppBrand } from "../layout/AppBrand";
import {
   formatOddsInputFromDecimal,
   formatSlipOdds,
} from "../settings/convertOdds";
import { OddsInputWithDecimal } from "../settings/OddsInputWithDecimal";
import { useSettings } from "../settings/SettingsContext";
import { useI18n } from "../i18n/useI18n";

type SendPhase = "idle" | "signing" | "confirming" | "done";

type PlacedBetSummary = Readonly<{
   signature: string;
   stakeLabel: string;
   /** Filled decimal odds × ODDS_SCALE. Null when the fill price could not be read. */
   oddsScaled: bigint | null;
   /** On-chain payout from filled bet account (potential return at settlement). */
   filledPayoutLabel: string | null;
   betId: string;
   isParlay: boolean;
   detailErr?: string;
}>;

function primaryFill(b: BetAccountData): BetAccountData["fillers"][number] | undefined {
   return b.fillers.find((f) => f.amount > 0n);
}

function rfqExpiryLabel(offerExpiry: number, nowSec: number): string {
   const left = offerExpiry - nowSec;
   if (left <= 0) {
      return "Expired";
   }
   return `Expires in ${left}s`;
}

export function BetSlipTray(): ReactElement | null {
   const { selections, expanded, setExpanded, clearSlip, removeSelection, setSlipLocked, slipLocked, slipCapNotice } =
      useBetSlip();
   const isParlay = selections.length >= 2;
   const rfqOnly = selections.length > MAX_PARLAY_LEGS;
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
   const [freebets, setFreebets] = useState<readonly SlipFreebet[]>([]);
   const [selectedFreebetKey, setSelectedFreebetKey] = useState<string>("");
   const [boosts, setBoosts] = useState<readonly SlipBoost[]>([]);
   const [selectedBoostKey, setSelectedBoostKey] = useState<string>("");
   const [quoteScopeKey, setQuoteScopeKey] = useState<string | null>(null);
   const [rfqOpen, setRfqOpen] = useState(false);
   const [rfqStatus, setRfqStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
   const [rfqErr, setRfqErr] = useState<string | null>(null);
   const [rfqQuotes, setRfqQuotes] = useState<readonly RfqQuoteJson[]>([]);
   const [rfqRequest, setRfqRequest] = useState<RfqHttpRequestJson | null>(null);
   const [rfqMmCount, setRfqMmCount] = useState(0);
   const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
   const sendLockRef = useRef(false);
   const prevCountRef = useRef(0);
   const legsAtPlaceRef = useRef<string | null>(null);

   const { account, isConnected } = useWallet();
   const { signer, ready: signerReady, walletName } = useAppTransactionSigner();
   const { cluster } = useCluster();
   const { oddsFormat } = useSettings();
   const { t, slipReason } = useI18n();
   const minOddsLabel = t("slip.minOdds", {
      format:
         oddsFormat === "american"
            ? t("odds.american")
            : oddsFormat === "percent"
              ? t("odds.percentShort")
              : t("odds.decimal"),
   });
   const oddsFormatRef = useRef(oddsFormat);
   oddsFormatRef.current = oddsFormat;
   const appliedOddsFormatRef = useRef(oddsFormat);
   const { connect, isConnecting: connectBusy, resetError } = useConnectWallet();
   const connectors = useWalletConnectors();

   const clusterRpcUrl = useMemo(() => resolveAppHttpRpcUrl(cluster?.url), [cluster?.url]);

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
         setRfqOpen(false);
         setRfqStatus("idle");
         setRfqErr(null);
         setRfqQuotes([]);
         setRfqRequest(null);
         setRfqMmCount(0);
         prevCountRef.current = 0;
         setSelectedFreebetKey("");
         setSelectedBoostKey("");
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
      setRfqStatus("idle");
      setRfqErr(null);
      setRfqQuotes([]);
      setRfqRequest(null);
      setRfqMmCount(0);
   }, [selections.length, selections.map((s) => s.id).join("|")]);

   const promoQuoteKey = selectedBoostKey || selectedFreebetKey;
   const quotesAttempted =
      (quoteStatus === "ok" || quoteStatus === "err") && quoteScopeKey === promoQuoteKey;
   const assessedFreebets = useMemo(
      () =>
         withSlipEligibility(freebets, selections, {
            quoteRows,
            quotesAttempted,
            selectedKey: selectedFreebetKey,
            oddsFormat,
         }),
      [freebets, selections, quoteRows, quotesAttempted, selectedFreebetKey, oddsFormat],
   );
   const selectedFreebet = useMemo(() => {
      if (selectedFreebetKey === "") {
         return null;
      }
      return assessedFreebets.find((v) => freebetKey(v) === selectedFreebetKey) ?? null;
   }, [assessedFreebets, selectedFreebetKey]);
   const selectedVoucher = useMemo(() => {
      if (selectedFreebetKey === "") {
         return null;
      }
      return freebets.find((v) => freebetKey(v) === selectedFreebetKey)?.data ?? null;
   }, [freebets, selectedFreebetKey]);
   const usingFreebet = selectedFreebetKey !== "";
   const anyEligibleFreebet = assessedFreebets.some((v) => v.eligible);
   const boostQuotesAttempted =
      (quoteStatus === "ok" || quoteStatus === "err") && quoteScopeKey === selectedBoostKey;
   const assessedBoosts = useMemo(
      () =>
         withBoostEligibility(boosts, selections, {
            quoteRows,
            quotesAttempted: boostQuotesAttempted,
            selectedKey: selectedBoostKey,
            oddsFormat,
         }),
      [boosts, selections, quoteRows, boostQuotesAttempted, selectedBoostKey, oddsFormat],
   );
   const selectedBoost = useMemo(() => {
      if (selectedBoostKey === "") {
         return null;
      }
      return assessedBoosts.find((v) => boostKey(v) === selectedBoostKey) ?? null;
   }, [assessedBoosts, selectedBoostKey]);
   const selectedBoostVoucher = useMemo(() => {
      if (selectedBoostKey === "") {
         return null;
      }
      return boosts.find((v) => boostKey(v) === selectedBoostKey)?.data ?? null;
   }, [boosts, selectedBoostKey]);
   const usingBoost = selectedBoostKey !== "";
   const anyEligibleBoost = assessedBoosts.some((v) => v.eligible);

   const refreshFreebets = useCallback(async () => {
      if (!isConnected || account == null) {
         setFreebets([]);
         setSelectedFreebetKey("");
         setBoosts([]);
         setSelectedBoostKey("");
         return;
      }
      try {
         const [freebetList, boostList] = await Promise.all([
            fetchAvailableFreebets(rpc, address(account)),
            fetchAvailableBoosts(rpc, address(account)),
         ]);
         setFreebets(freebetList);
         setBoosts(boostList);
      } catch {
         setFreebets([]);
         setBoosts([]);
      }
   }, [account, isConnected, rpc]);

   useEffect(() => {
      void refreshFreebets();
      const unsubscribe = subscribeFreebetRefresh(() => {
         void refreshFreebets();
      });
      return unsubscribe;
   }, [refreshFreebets]);

   useEffect(() => {
      if (selectedVoucher == null) {
         return;
      }
      const next = formatUsdcBaseUnitsForUi(selectedVoucher.amount);
      setAmount((prev) => (prev === next ? prev : next));
   }, [selectedVoucher]);

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
      setQuoteScopeKey(null);
      const userAddress = isConnected && account != null ? address(account) : SIM_FEE_PAYER_ADDRESS;

      const voucher = selectedBoostVoucher ?? selectedVoucher;
      const quoteKey = selectedBoostKey || selectedFreebetKey;
      const allowedMms =
         voucher != null && voucher.allowedMms.length > 0 ? voucher.allowedMms : undefined;
      const fallbackNoQuote =
         "No MM returned a quote (wrong cluster, missing market, or amount too large).";

      const quoteFailHint = (rawRows: readonly { mmProgramAddress: Address; oddsScaled: bigint }[]): string => {
         if (voucher == null) {
            return fallbackNoQuote;
         }
         if (rawRows.length === 0) {
            return voucher.allowedMms.length > 0
               ? "No allowed MM quoted"
               : fallbackNoQuote;
         }
         return explainFreebetOddsForQuotes(rawRows, voucher, oddsFormatRef.current) ?? "No allowed MM quoted";
      };

      try {
         if (selections.length === 1) {
            const sel = selections[0]!;
            const marketId = buildMarketIdForSelection(sel);
            const side = pickBetSide(sel.column, sel.mktString, sel.outcomeIndex, sel.marketWireId);
            const q = await runMmQuoteFlow({ rpc, userAddress, marketId, side, amount: amt, allowedMms });
            const top = filterQuoteRowsForFreebet(q.topMms, voucher);
            if (top.length === 0) {
               setQuoteStatus("err");
               setQuoteErr(quoteErrorsSummaryForUi(q.errors, quoteFailHint(q.topMms)));
               setQuoteRows([]);
               setQuoteMmErrors(q.errors);
               setMinOdds("");
               setQuoteScopeKey(quoteKey);
               return;
            }
            const conservative = top.reduce(
               (m, x) => (x.oddsScaled < m ? x.oddsScaled : m),
               top[0]!.oddsScaled,
            );
            setConservativeMin(conservative);
            setMinOdds(
               formatOddsInputFromDecimal(Number(conservative) / Number(ODDS_SCALE), oddsFormatRef.current),
            );
            setQuoteRows(top);
            setQuoteMmErrors(q.errors);
            setBestParlayMm(null);
            setQuoteStatus("ok");
            setQuoteScopeKey(quoteKey);
         } else {
            const legs = selections.map(parlayLegFromSelection);
            const q = await runMmParlayQuoteFlow({ rpc, userAddress, legs, amount: amt, allowedMms });
            const top = filterQuoteRowsForFreebet(q.topMms, voucher);
            if (top.length === 0) {
               setQuoteStatus("err");
               setQuoteErr(
                  quoteErrorsSummaryForUi(
                     q.errors,
                     voucher != null
                        ? quoteFailHint(q.topMms)
                        : "No MM returned a parlay quote for these legs.",
                  ),
               );
               setQuoteRows([]);
               setQuoteMmErrors(q.errors);
               setBestParlayMm(null);
               setMinOdds("");
               setQuoteScopeKey(quoteKey);
               return;
            }
            const conservative = top.reduce(
               (m, x) => (x.oddsScaled < m ? x.oddsScaled : m),
               top[0]!.oddsScaled,
            );
            setConservativeMin(conservative);
            setMinOdds(
               formatOddsInputFromDecimal(Number(conservative) / Number(ODDS_SCALE), oddsFormatRef.current),
            );
            setQuoteRows(top);
            setQuoteMmErrors(q.errors);
            setBestParlayMm(top[0]!.mmProgramAddress);
            setQuoteStatus("ok");
            setQuoteScopeKey(quoteKey);
         }
      } catch (e) {
         setQuoteStatus("err");
         setQuoteErr(quoteErrorMessageForUi(e instanceof Error ? e.message : String(e)));
         setQuoteRows([]);
         setQuoteMmErrors([]);
         setBestParlayMm(null);
         setQuoteScopeKey(quoteKey);
      }
   }, [selections, isConnected, account, amount, rpc, selectedVoucher, selectedFreebetKey, selectedBoostVoucher, selectedBoostKey]);

   const fetchRfqQuotes = useCallback(async () => {
      const amt = parseUsdcAmountUiToBaseUnits(amount);
      if (amt === null || amt <= 0n) {
         setRfqStatus("err");
         setRfqErr("Enter a valid stake amount.");
         setRfqQuotes([]);
         setRfqRequest(null);
         return;
      }
      if (!isConnected || account == null) {
         setRfqStatus("err");
         setRfqErr("Connect a wallet to request offchain quotes.");
         setRfqQuotes([]);
         setRfqRequest(null);
         return;
      }
      setRfqStatus("loading");
      setRfqErr(null);
      try {
         const userAddress = address(account);
         const betId = nextBetId();
         const request = rfqRequestBody({ user: userAddress, betId, amount: amt, selections });
         const res = await requestRfqQuotes({ user: userAddress, betId, amount: amt, selections });
         setRfqRequest(request);
         setRfqQuotes(sortRfqQuotes(res.quotes));
         setRfqMmCount(res.mmCount);
         setRfqStatus("ok");
         if (res.quotes.length === 0) {
            setRfqErr(res.mmCount === 0 ? "No RFQ market makers connected" : "No RFQ quote for this stake");
         }
      } catch (e) {
         setRfqStatus("err");
         setRfqErr(quoteErrorMessageForUi(e instanceof Error ? e.message : String(e)));
         setRfqQuotes([]);
         setRfqRequest(null);
         setRfqMmCount(0);
      }
   }, [account, amount, isConnected, selections]);

   useEffect(() => {
      if (!rfqOpen) {
         return;
      }
      const t = window.setTimeout(() => {
         void fetchRfqQuotes();
      }, 350);
      return () => window.clearTimeout(t);
   }, [rfqOpen, amount, selections, fetchRfqQuotes, selectedFreebetKey, selectedBoostKey]);

   useEffect(() => {
      if (!rfqOpen) {
         return;
      }
      const onKey = (e: KeyboardEvent) => {
         if (e.key === "Escape" && sendPhase !== "signing" && sendPhase !== "confirming") {
            setRfqOpen(false);
         }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
   }, [rfqOpen, sendPhase]);

   useEffect(() => {
      if (!rfqOpen) {
         return;
      }
      const t = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
      return () => window.clearInterval(t);
   }, [rfqOpen]);

   useEffect(() => {
      if (selections.length === 0 || isCollapsed || rfqOnly) {
         return;
      }
      const t = window.setTimeout(() => {
         void runQuotes();
      }, 450);
      return () => window.clearTimeout(t);
   }, [selections, amount, runQuotes, isCollapsed, rfqOnly]);

   const minOddsScaled = useMemo(
      () => parseMinOddsScaled(minOdds, conservativeMin, oddsFormat),
      [minOdds, conservativeMin, oddsFormat],
   );

   useEffect(() => {
      const prev = appliedOddsFormatRef.current;
      if (prev === oddsFormat) {
         return;
      }
      appliedOddsFormatRef.current = oddsFormat;
      setMinOdds((cur) => {
         const dec = Number(parseMinOddsScaled(cur, 0n, prev)) / Number(ODDS_SCALE);
         if (!(dec > 0)) {
            return cur;
         }
         return formatOddsInputFromDecimal(dec, oddsFormat);
      });
   }, [oddsFormat]);

   const potentialReturnLabel = useMemo(() => {
      if (placedBetSummary?.filledPayoutLabel != null) {
         return placedBetSummary.filledPayoutLabel;
      }
      const amt = parseUsdcAmountUiToBaseUnits(amount);
      if (amt === null || amt <= 0n || minOddsScaled <= ODDS_SCALE) {
         return "—";
      }
      const basePayout = usingFreebet
         ? calcPotentialProfitBase(amt, minOddsScaled)
         : calcPotentialPayoutBase(amt, minOddsScaled);
      const payout =
         usingBoost && selectedBoost != null && basePayout != null
            ? boostedPayoutBase(basePayout, amt, selectedBoost.data.boostBps)
            : basePayout;
      if (payout === null) {
         return "—";
      }
      return `${formatUsdcBaseUnitsForUi(payout)} USDC`;
   }, [amount, minOddsScaled, placedBetSummary?.filledPayoutLabel, usingFreebet, usingBoost, selectedBoost]);

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

   const closeRfqModal = useCallback(() => {
      if (sendPhase === "signing" || sendPhase === "confirming") {
         return;
      }
      setRfqOpen(false);
   }, [sendPhase]);

   const runSendPipeline = async (mode: "auction" | "rfq", selectedRfqQuote?: RfqQuoteJson) => {
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

         const freebet: FreebetFillRef | undefined =
            selectedFreebet != null && selectedFreebet.eligible
               ? { issuerAuth: selectedFreebet.data.issuerAuth, freebetId: selectedFreebet.data.freebetId }
               : undefined;
         const boost: BoostFillRef | undefined =
            selectedBoost != null && selectedBoost.eligible
               ? { issuerAuth: selectedBoost.data.issuerAuth, boostId: selectedBoost.data.boostId }
               : undefined;
         if (selectedFreebet != null && !selectedFreebet.eligible) {
            setSendErr(selectedFreebet.reason ?? "Freebet cannot be used on this slip.");
            return;
         }
         if (selectedBoost != null && !selectedBoost.eligible) {
            setSendErr(selectedBoost.reason ?? "Boost cannot be used on this slip.");
            return;
         }
         if (freebet != null && amt !== selectedFreebet!.data.amount) {
            setSendErr("Freebet stake must match the voucher amount.");
            return;
         }
         if (boost != null && amt > selectedBoost!.data.maxStake) {
            setSendErr("Stake is above the boost maximum.");
            return;
         }

         let minScaled = parseMinOddsScaled(minOdds, conservativeMin, oddsFormatRef.current);
         const promoLimits = selectedFreebet?.data ?? selectedBoost?.data;
         if (promoLimits != null) {
            const oddsReason = explainFreebetOdds(minScaled, promoLimits, oddsFormatRef.current);
            if (oddsReason != null) {
               setSendErr(oddsReason);
               return;
            }
         }

         if (mode === "auction") {
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
         }

         setPlacedBetSummary(null);
         setSendPhase("signing");
         try {
            const userAddress = address(account);
            const betId =
               mode === "rfq" && rfqRequest != null ? BigInt(rfqRequest.betId) : nextBetId();
            let signed;

            if (mode === "rfq") {
               const request = rfqRequest;
               const quote = selectedRfqQuote;
               if (request == null || quote == null) {
                  throw new Error("Select an offchain quote to accept.");
               }
               if (BigInt(request.amount) !== amt) {
                  throw new Error("Stake changed — request offchain quotes again.");
               }
               const reject = rfqQuoteRejectReason(quote, amt, selectedFreebet?.data ?? selectedBoost?.data);
               if (reject != null) {
                  throw new Error(reject);
               }
               const fill = rfqFillFromResponse(request, quote);
               signed = await buildAndSignFillRfqTx({
                  rpc,
                  walletSigner: signer,
                  userAddress,
                  fill,
                  freebet,
                  boost,
               });
            } else if (isParlay) {
               signed = await buildAndSignFillParlayTx({
                  rpc,
                  walletSigner: signer,
                  userAddress,
                  mmProgram: bestParlayMm!,
                  freebet,
                  boost,
                  fill: {
                     betId,
                     amount: amt,
                     minOddsScaled: minScaled,
                     numLegs: selections.length,
                     legs: selections.map(parlayLegFromSelection),
                  },
               });
            } else {
               const sel = selections[0]!;
               const marketId = buildMarketIdForSelection(sel);
               const side = pickBetSide(sel.column, sel.mktString, sel.outcomeIndex, sel.marketWireId);
               signed = await buildAndSignFillBetTx({
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
                  freebet,
                  boost,
               });
            }

            setSendPhase("confirming");
            const sendAndConfirm = sendAndConfirmTransactionFactory({
               rpc,
               rpcSubscriptions,
            } as never);
            await sendAndConfirm(signed as never, { commitment: "confirmed" });
            requestWalletBalanceRefresh();
            const signature = getSignatureFromTransaction(signed);

            let stakeLabel = formatUsdcBaseUnitsForUi(amt);
            let filledOddsScaled: bigint | null = null;
            let filledPayoutLabel: string | null = null;
            let detailErr: string | undefined;
            const isFreebetFill = freebet != null;
            try {
               if (isParlay) {
                  const bet = await getParlayData(rpc, { user: userAddress, betId });
                  stakeLabel = formatUsdcBaseUnitsForUi(bet.amount);
                  if (bet.payout > 0n) {
                     const odds = bet.amount > 0n ? (bet.payout * ODDS_SCALE) / bet.amount : null;
                     const credit = userWinCreditBase(bet.amount, bet.payout, odds, isFreebetFill);
                     const shown = boost != null ? boostedPayoutBase(bet.payout, bet.amount, selectedBoost!.data.boostBps) : credit;
                     filledPayoutLabel = `${formatUsdcBaseUnitsForUi(shown)} USDC`;
                  }
                  if (bet.amount > 0n && bet.payout > 0n) {
                     filledOddsScaled = (bet.payout * ODDS_SCALE) / bet.amount;
                  }
               } else {
                  const bet = await getBetData(rpc, { user: userAddress, betId });
                  stakeLabel = formatUsdcBaseUnitsForUi(bet.amount);
                  const fill = primaryFill(bet);
                  const fillOdds = fill !== undefined && fill.oddsScaled > 0n ? fill.oddsScaled : null;
                  if (bet.payout > 0n) {
                     const credit = userWinCreditBase(bet.amount, bet.payout, fillOdds, isFreebetFill);
                     const shown = boost != null ? boostedPayoutBase(bet.payout, bet.amount, selectedBoost!.data.boostBps) : credit;
                     filledPayoutLabel = `${formatUsdcBaseUnitsForUi(shown)} USDC`;
                  }
                  if (fill !== undefined && fill.oddsScaled > 0n) {
                     filledOddsScaled = fill.oddsScaled;
                     if (filledPayoutLabel === null && bet.amount > 0n) {
                        const est = isFreebetFill
                           ? calcPotentialProfitBase(bet.amount, fill.oddsScaled)
                           : calcPotentialPayoutBase(bet.amount, fill.oddsScaled);
                        if (est !== null) {
                           filledPayoutLabel = `${formatUsdcBaseUnitsForUi(est)} USDC`;
                        }
                     }
                  } else if (bet.amount > 0n && bet.payout > 0n) {
                     filledOddsScaled = (bet.payout * ODDS_SCALE) / bet.amount;
                  }
               }
            } catch (e) {
               detailErr = e instanceof Error ? e.message : String(e);
            }

            setPlacedBetSummary({
               signature,
               stakeLabel,
               oddsScaled: filledOddsScaled,
               filledPayoutLabel,
               betId: betId.toString(),
               isParlay,
               detailErr,
            });
            setSendPhase("done");
            setRfqOpen(false);
            setSelectedFreebetKey("");
            setSelectedBoostKey("");
            if (isConnected && account != null) {
               void refreshFreebets();
            }
         } catch (e) {
            setSendErr(signErrorMessageForUi(e, { walletName }));
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

   const needsWallet = !isConnected || account == null;
   const canConnect = !connectBusy && connectors.length > 0;
   const quotesReady = isParlay ? bestParlayMm !== null : quoteRows.length > 0;
   const noOnchainQuote =
      rfqOnly || quoteStatus === "err" || (quoteStatus === "ok" && !quotesReady);
   const showTryRfq = !needsWallet && sendPhase !== "done" && noOnchainQuote;
   const canAuction =
      !rfqOnly &&
      quoteStatus === "ok" &&
      quotesReady &&
      (sendPhase === "idle" || sendPhase === "done") &&
      signerReady &&
      signer != null;
   const sending = sendPhase === "signing" || sendPhase === "confirming";
   const canAcceptRfq = (sendPhase === "idle" || sendPhase === "done") && signerReady && signer != null;
   const primaryDisabled = needsWallet ? !canConnect : showTryRfq ? sending : !canAuction;

   const headerTitle =
      selections.length === 1 ? t("slip.single") : t("slip.selections", { count: selections.length });

   const primaryLabel = needsWallet
      ? connectBusy
         ? t("buttons.connecting")
         : t("buttons.connectWallet")
      : sendPhase === "signing"
        ? t("slip.signInWallet")
        : sendPhase === "confirming"
          ? t("buttons.sending")
          : sendPhase === "done"
            ? selections.length > 1
               ? t("slip.reuseMany")
               : t("slip.reuseOne")
            : showTryRfq
              ? t("slip.tryRfq")
              : t("slip.placeBet");

   const onHeaderClick = () => {
      if (isParlay) {
         setExpanded(!expanded);
      }
   };

   const selectionBlock = (sel: (typeof selections)[number]) => (
      <>
         <div className="bet-slip-tray__selection-text">
            <span className="bet-slip-tray__selection-market">{sel.marketLabel}</span>
            <span className="bet-slip-tray__selection-event">{sel.eventTitle}</span>
         </div>
         {sel.displayedDecimalOdds != null && sel.displayedDecimalOdds > 0 && (
            <span className="bet-slip-tray__selection-odds odds-value">
               {formatSlipOdds(sel.displayedDecimalOdds, oddsFormat)}
            </span>
         )}
      </>
   );

   return (
      <>
      <div className="bet-slip-tray-dock">
         <div
            className={`bet-slip-tray${isCollapsed ? " bet-slip-tray--collapsed" : " bet-slip-tray--expanded"}`}
            role="region"
            aria-label={t("slip.betSlip")}
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
                  aria-label={t("slip.dismissSlip")}
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
                              aria-label={t("slip.remove", { label: selections[0]!.marketLabel })}
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
                                    aria-label={t("slip.remove", { label: sel.marketLabel })}
                                    onClick={() => removeSelection(sel.id)}
                                 >
                                    ×
                                 </button>
                              )}
                           </li>
                        ))}
                     </ul>
                  )}

                  <div className="bet-slip-tray__toolbar">
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
                           {sendPhase === "done" ? t("buttons.dismiss") : t("slip.clearAll")}
                        </button>
                     )}
                     {sendPhase !== "done" && (
                        <button
                           type="button"
                           className="bet-slip-tray__rfq-link"
                           title={t("slip.rfqTooltip")}
                           disabled={sending}
                           onClick={() => setRfqOpen(true)}
                        >
                           {t("slip.requestOffchain")}
                        </button>
                     )}
                  </div>

                  {sendPhase === "done" ? (
                     <AppBrand asLink={false} className="bet-slip-tray__brand" />
                  ) : (
                     <div className="bet-slip-tray__fields">
                        {assessedFreebets.length > 0 && (
                           <label className="bet-slip-tray__freebet bet-slip-tray__freebet-check">
                              <input
                                 type="checkbox"
                                 checked={usingFreebet}
                                 disabled={!anyEligibleFreebet && !usingFreebet}
                                 onChange={(e) => {
                                    if (!e.target.checked) {
                                       setSelectedFreebetKey("");
                                       return;
                                    }
                                    const pick =
                                       assessedFreebets.find((v) => v.eligible) ?? assessedFreebets[0]!;
                                    setSelectedBoostKey("");
                                    setSelectedFreebetKey(freebetKey(pick));
                                 }}
                              />
                              <span>
                                 {t("slip.useFreebet")}
                                 {assessedFreebets.length === 1
                                    ? assessedFreebets[0]!.eligible
                                       ? ` · ${freebetPickerLabel(assessedFreebets[0]!)}`
                                       : ` (${slipReason(assessedFreebets[0]!.reason ?? t("slip.unavailable"))})`
                                    : null}
                              </span>
                           </label>
                        )}
                        {usingFreebet && assessedFreebets.length > 1 && (
                           <label className="bet-modal-field bet-slip-tray__freebet">
                              <span className="bet-modal-field-label">{t("slip.freebet")}</span>
                              <select
                                 className="bet-modal-input"
                                 value={selectedFreebetKey}
                                 onChange={(e) => setSelectedFreebetKey(e.target.value)}
                              >
                                 {assessedFreebets.map((v) => (
                                    <option
                                       key={freebetKey(v)}
                                       value={freebetKey(v)}
                                       disabled={!v.eligible}
                                    >
                                       {freebetPickerLabel(v)}
                                       {v.eligible ? "" : ` (${slipReason(v.reason ?? t("slip.unavailable"))})`}
                                    </option>
                                 ))}
                              </select>
                           </label>
                        )}
                        {assessedBoosts.length > 0 && (
                           <label className="bet-slip-tray__freebet bet-slip-tray__freebet-check">
                              <input
                                 type="checkbox"
                                 checked={usingBoost}
                                 disabled={!anyEligibleBoost && !usingBoost}
                                 onChange={(e) => {
                                    if (!e.target.checked) {
                                       setSelectedBoostKey("");
                                       return;
                                    }
                                    const pick = assessedBoosts.find((v) => v.eligible) ?? assessedBoosts[0]!;
                                    setSelectedFreebetKey("");
                                    setSelectedBoostKey(boostKey(pick));
                                 }}
                              />
                              <span>
                                 {t("slip.useBoost")}
                                 {assessedBoosts.length === 1
                                    ? assessedBoosts[0]!.eligible
                                       ? ` · ${boostPickerLabel(assessedBoosts[0]!)}`
                                       : ` (${slipReason(assessedBoosts[0]!.reason ?? t("slip.unavailable"))})`
                                    : null}
                              </span>
                           </label>
                        )}
                        {usingBoost && assessedBoosts.length > 1 && (
                           <label className="bet-modal-field bet-slip-tray__freebet">
                              <span className="bet-modal-field-label">{t("slip.boost")}</span>
                              <select
                                 className="bet-modal-input"
                                 value={selectedBoostKey}
                                 onChange={(e) => setSelectedBoostKey(e.target.value)}
                              >
                                 {assessedBoosts.map((v) => (
                                    <option key={boostKey(v)} value={boostKey(v)} disabled={!v.eligible}>
                                       {boostPickerLabel(v)}
                                       {v.eligible ? "" : ` (${slipReason(v.reason ?? t("slip.unavailable"))})`}
                                    </option>
                                 ))}
                              </select>
                           </label>
                        )}
                        <label className="bet-modal-field">
                           <span className="bet-modal-field-label">{t("slip.amount")}</span>
                           <input
                              className="bet-modal-input"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={amount}
                              disabled={selectedFreebet != null && selectedFreebet.eligible}
                              onChange={(e) => setAmount(e.target.value)}
                              placeholder={t("slip.amountPlaceholder")}
                           />
                        </label>
                        {!rfqOnly && (
                           <label className="bet-modal-field">
                              <span className="bet-modal-field-label">{minOddsLabel}</span>
                              <OddsInputWithDecimal value={minOdds} onChange={setMinOdds} />
                           </label>
                        )}
                        {rfqOnly && (
                           <p className="bet-modal-muted">{t("slip.rfqOnly", { count: MAX_PARLAY_LEGS })}</p>
                        )}
                     </div>
                  )}
               </div>

               {slipCapNotice != null && (
                  <p className="bet-modal-err">{t("slip.maxSelections", { count: MAX_RFQ_PARLAY_LEGS })}</p>
               )}
               {sendErr != null && <p className="bet-modal-err">{slipReason(sendErr)}</p>}
               {placedBetSummary != null && (
                  <div className="bet-modal-placed" role="status">
                     <div className="bet-modal-placed-title">{t("slip.betPlaced")}</div>
                     <dl className="bet-modal-meta bet-modal-placed-meta">
                        <div className="bet-modal-meta-row">
                           <dt>{t("slip.stakeFilled")}</dt>
                           <dd>
                              <strong>{placedBetSummary.stakeLabel}</strong> USDC
                           </dd>
                        </div>
                        <div className="bet-modal-meta-row">
                           <dt>{t("slip.totalOdds")}</dt>
                           <dd className="odds-value">
                              <strong>
                                 {placedBetSummary.oddsScaled != null && placedBetSummary.oddsScaled > 0n
                                    ? formatSlipOdds(Number(placedBetSummary.oddsScaled) / Number(ODDS_SCALE), oddsFormat)
                                    : "—"}
                              </strong>
                           </dd>
                        </div>
                        <div className="bet-modal-meta-row">
                           <dt>{t("slip.betId")}</dt>
                           <dd className="bet-modal-mono">{placedBetSummary.betId}</dd>
                        </div>
                     </dl>
                     {placedBetSummary.detailErr != null && (
                        <p className="bet-modal-muted bet-modal-placed-warn">
                           {t("slip.detailsFailed", { error: placedBetSummary.detailErr })}
                        </p>
                     )}
                     <p className="bet-modal-muted bet-modal-placed-tx">
                        <a
                           href={solscanTxUrl(placedBetSummary.signature)}
                           target="_blank"
                           rel="noopener noreferrer"
                           className="inline-nav-link"
                        >
                           {t("slip.viewTx")}
                        </a>
                     </p>
                  </div>
               )}

               <div className="bet-slip-tray__footer-row">
               <div className="bet-modal-quote">
                  <div className="bet-modal-quote-head">{t("slip.marketOffers")}</div>
                  {rfqOnly && (
                     <p className="bet-modal-muted">
                        {t("slip.onchainUnavailable", { count: MAX_PARLAY_LEGS })}
                     </p>
                  )}
                  {!rfqOnly && quoteStatus === "loading" && (
                     <p className="bet-modal-muted" role="status">
                        {t("slip.fetchingOdds")}
                     </p>
                  )}
                  {!rfqOnly && quoteStatus === "err" && quoteErr != null && <p className="bet-modal-err">{slipReason(quoteErr)}</p>}
                  {!rfqOnly && quoteStatus === "ok" && quoteRows.length > 0 && (
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
                                 <span className="odds-value">{formatSlipOdds(dec, oddsFormat)}</span>
                                 {isBest ? ` ${t("slip.best")}` : ""}
                              </li>
                           );
                        })}
                     </ul>
                  )}
                  {!rfqOnly && quoteStatus === "ok" && quoteMmErrors.length > 0 && (
                     <p className="bet-modal-muted bet-slip-tray__mm-errors">
                        {t("slip.someMms")}{" "}
                        {quoteMmErrors.map(quoteErrorMessageForUi).slice(0, 2).join(" · ")}
                        {quoteMmErrors.length > 2 ? " …" : ""}
                     </p>
                  )}
               </div>

               <div className="bet-slip-tray__actions">
                  <div className="bet-slip-tray__return">
                     <span className="bet-slip-tray__return-label">{t("slip.potentialReturn")}</span>
                     <span className="bet-slip-tray__return-value">{potentialReturnLabel}</span>
                  </div>
                  <div className="bet-slip-tray__action-btns">
                     {sendPhase === "done" && (
                        <button
                           type="button"
                           className="bet-modal-btn bet-modal-btn--ghost"
                           onClick={() => dismissSlip()}
                        >
                           {t("buttons.dismiss")}
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
                           if (showTryRfq) {
                              setRfqOpen(true);
                              return;
                           }
                           void runSendPipeline("auction");
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
      {rfqOpen
         ? createPortal(
              <div
                 className="bet-modal-overlay"
                 role="presentation"
                 onMouseDown={(e) => {
                    if (e.target === e.currentTarget && !sending) {
                       closeRfqModal();
                    }
                 }}
              >
                 <div
                    className="bet-modal-dialog bet-modal-dialog--rfq"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="rfq-quotes-title"
                    onMouseDown={(e) => e.stopPropagation()}
                 >
                    <header className="bet-modal-header">
                       <h2 id="rfq-quotes-title" className="bet-modal-title">
                          {t("slip.offchainQuotes")}
                       </h2>
                       <button
                          type="button"
                          className="bet-modal-close"
                          onClick={closeRfqModal}
                          aria-label={t("buttons.close")}
                          disabled={sending}
                       >
                          ×
                       </button>
                    </header>
                    <div className="bet-modal-body">
                       <ul className="rfq-modal-legs">
                          {selections.map((sel) => (
                             <li key={sel.id} className="bet-slip-tray__leg">
                                {selectionBlock(sel)}
                             </li>
                          ))}
                       </ul>
                       <div className="bet-slip-tray__fields rfq-modal-section">
                          <label className="bet-modal-field">
                             <span className="bet-modal-field-label">{t("slip.amount")}</span>
                             <input
                                className="bet-modal-input"
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                value={amount}
                                disabled={sending || (selectedFreebet != null && selectedFreebet.eligible)}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder={t("slip.amountPlaceholder")}
                             />
                          </label>
                          {!rfqOnly && (
                             <label className="bet-modal-field">
                                <span className="bet-modal-field-label">{minOddsLabel}</span>
                                <OddsInputWithDecimal value={minOdds} onChange={setMinOdds} disabled={sending} />
                             </label>
                          )}
                       </div>
                       {sendErr != null && <p className="bet-modal-err">{sendErr}</p>}
                       <section className="rfq-modal-section">
                          <div className="bet-modal-quote-head">{t("slip.offchainQuotes")}</div>
                          {rfqStatus === "loading" && (
                             <p className="bet-modal-muted" role="status">
                                {t("slip.requestingOffchain")}
                             </p>
                          )}
                          {rfqErr != null && <p className="bet-modal-err">{slipReason(rfqErr)}</p>}
                          {rfqStatus === "ok" && rfqQuotes.length > 0 && (
                             <ul className="rfq-modal-quote-list">
                                {rfqQuotes.map((quote, i) => {
                                   const amt = parseUsdcAmountUiToBaseUnits(amount);
                                   const reject =
                                      amt == null || amt <= 0n
                                         ? "Enter a valid stake amount."
                                         : rfqQuoteRejectReason(quote, amt, selectedFreebet?.data ?? selectedBoost?.data, nowSec);
                                   let oddsLabel = "—";
                                   try {
                                      const scaled = BigInt(quote.oddsScaled);
                                      oddsLabel =
                                         scaled > 0n
                                            ? formatSlipOdds(Number(scaled) / Number(ODDS_SCALE), oddsFormat)
                                            : "—";
                                   } catch {
                                      oddsLabel = "—";
                                   }
                                   return (
                                      <li key={`${quote.mmProgramId}-${quote.signature}-${i}`} className="rfq-modal-quote-row">
                                         <div className="rfq-modal-quote-row__meta">
                                            <div className="rfq-modal-quote-row__line bet-modal-mono">
                                               {String(quote.mmProgramId).slice(0, 8)}…{" "}
                                               {formatUsdcBaseUnitsForUi(BigInt(quote.maxStake))} USDC @{" "}
                                               <span className="odds-value">{oddsLabel}</span>
                                            </div>
                                            <div className="rfq-modal-quote-row__expiry">
                                               {slipReason(rfqExpiryLabel(quote.offerExpiry, nowSec))}
                                               {reject != null ? ` · ${slipReason(reject)}` : ""}
                                            </div>
                                         </div>
                                         <button
                                            type="button"
                                            className="bet-modal-btn bet-modal-btn--primary"
                                            disabled={sending || !canAcceptRfq || reject != null || rfqStatus !== "ok"}
                                            onClick={() => void runSendPipeline("rfq", quote)}
                                         >
                                            {sending ? "…" : t("slip.accept")}
                                         </button>
                                      </li>
                                   );
                                })}
                             </ul>
                          )}
                          {rfqStatus === "ok" && rfqQuotes.length === 0 && rfqMmCount > 0 && rfqErr == null && (
                             <p className="bet-modal-muted">{t("slip.noOffchain")}</p>
                          )}
                       </section>
                       <section className="rfq-modal-section">
                          <div className="bet-modal-quote-head">{t("slip.marketOffers")}</div>
                          {rfqOnly && (
                             <p className="bet-modal-muted">
                                {t("slip.onchainUnavailable", { count: MAX_PARLAY_LEGS })}
                             </p>
                          )}
                          {!rfqOnly && quoteStatus === "loading" && (
                             <p className="bet-modal-muted" role="status">
                                {t("slip.fetchingOdds")}
                             </p>
                          )}
                          {!rfqOnly && quoteStatus === "err" && quoteErr != null && (
                             <p className="bet-modal-err">{slipReason(quoteErr)}</p>
                          )}
                          {!rfqOnly && quoteStatus === "ok" && quoteRows.length > 0 && (
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
                                         <span className="odds-value">{formatSlipOdds(dec, oddsFormat)}</span>
                                         {isBest ? ` ${t("slip.best")}` : ""}
                                      </li>
                                   );
                                })}
                             </ul>
                          )}
                       </section>
                    </div>
                    <footer className="bet-modal-footer rfq-modal-footer-actions">
                       <div className="bet-slip-tray__return">
                          <span className="bet-slip-tray__return-label">{t("slip.potentialReturn")}</span>
                          <span className="bet-slip-tray__return-value">{potentialReturnLabel}</span>
                       </div>
                       <button
                          type="button"
                          className="bet-modal-btn bet-modal-btn--ghost"
                          disabled={sending}
                          onClick={closeRfqModal}
                       >
                          {t("buttons.close")}
                       </button>
                       {!rfqOnly && (
                          <button
                             type="button"
                             className={
                                sendPhase === "confirming"
                                   ? "bet-modal-btn bet-modal-btn--primary bet-modal-btn--tx-confirming"
                                   : "bet-modal-btn bet-modal-btn--primary"
                             }
                             disabled={!canAuction || sending}
                             onClick={() => void runSendPipeline("auction")}
                          >
                             {sendPhase === "signing"
                                ? t("slip.signInWallet")
                                : sendPhase === "confirming"
                                  ? t("buttons.sending")
                                  : t("slip.placeOnchain")}
                          </button>
                       )}
                    </footer>
                 </div>
              </div>,
              document.body,
           )
         : null}
      </>
   );
}
