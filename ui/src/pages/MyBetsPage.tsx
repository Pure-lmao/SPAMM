import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
   createSolanaRpc,
   createSolanaRpcSubscriptions,
   sendAndConfirmTransactionFactory,
   address,
   type Address,
   type Rpc,
   type SolanaRpcApi,
} from "@solana/kit";
import { useCluster, useWallet } from "@solana/connector/react";
import { useAppTransactionSigner } from "../wallet/useAppTransactionSigner";
import { signErrorMessageForUi } from "../wallet/walletStandardV1Signer";
import { requestWalletBalanceRefresh } from "../wallet/walletBalanceRefresh";
import {
   BetResult,
   LIVE_CASHOUT_DELAY,
   PROMO_BOOST,
   PROMO_FREEBET,
   getSettleBetIx,
   getSettleBoostedBetIx,
   getSettleBoostedParlayIx,
   getSettleFreebetIx,
   getSettleFreebetParlayIx,
   getSettleParlayIx,
   ODDS_SCALE,
   type BetAccountData,
   type MarketId,
} from "spamm-aggregator-sdk";
import {
   canCashoutRow,
   cashoutUsesRfq,
   escrowClaimReady,
   loadEscrowForOrigBet,
   origBetIdOfRow,
   quoteAndSignRfqParlayCashout,
   quoteAuctionCashout,
   quoteRfqParlayCashout,
   buildSignAuctionCashoutTx,
   buildSignClaimCashoutTx,
   ticketAmountOfRow,
   ticketFeepayerOfRow,
   walletRowFreebetId,
} from "../betting/cashout";
import { buildSignV1Transaction, httpToWsRpcUrl, resolveAppHttpRpcUrl } from "../betting/txPipeline";
import { formatUsdcBaseUnitsForUi } from "../betting/usdc";
import { userWinCreditBase, solscanTxUrl } from "../betting/betSlipUtils";
import { convertOdds, type OddsFormat } from "../settings/convertOdds";
import { useSettings } from "../settings/SettingsContext";
import {
   fetchClosedBetHistory,
   fetchOpenWalletBets,
   walletBetRowResult,
   type WalletBetRow,
   type WalletParlayLeg,
} from "../markets/fetchBetHistory";
import { fetchBetCardEvents } from "../markets/fetchEvent";
import { fetchPromosForBetLookup } from "../markets/fetchPromos";
import {
   betMarketDisplayLines,
   eventLookupKey,
   indexPromotionalMarkets,
   isPromoMarketChain,
   promoMarketLookupKey,
   useBetMarketCopy,
   type BetMarketDisplayLines,
} from "../markets/myBetsMarketDisplay";
import type { BetCardEvent, UiPromotionalMarket } from "../markets/types";
import { useI18n } from "../i18n/useI18n";
import type { Translate } from "../i18n/translate";

type LoadState = "idle" | "loading" | "ok" | "err";

type MyBetsTab = "open" | "closed";

const MAX_SETTLE_IX_PER_TX = 9;
const CASHOUT_QUOTE_DEBOUNCE_MS = 450;

function betResultLabel(r: BetResult, t: Translate): string {
   switch (r) {
      case BetResult.Pending:
         return t("myBets.pending");
      case BetResult.Won:
         return t("myBets.won");
      case BetResult.Lost:
         return t("myBets.lost");
      case BetResult.HalfWon:
         return t("myBets.halfWon");
      case BetResult.HalfLost:
         return t("myBets.halfLost");
      case BetResult.Push:
         return t("myBets.push");
      case BetResult.Cancelled:
         return t("myBets.cancelled");
      case BetResult.RolledBack:
         return t("myBets.rolledBack");
      case BetResult.CashedOut:
         return t("myBets.cashedOut");
      case BetResult.ModifiedWin:
         return t("myBets.modifiedWin");
      default:
         return t("myBets.unknown", { code: r });
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
      case BetResult.CashedOut:
         return "cashed-out";
      case BetResult.ModifiedWin:
         return "modified-win";
      default:
         return "unknown";
   }
}

function oddsFromScaled(scaled: bigint, format: OddsFormat): string {
   if (scaled === 0n) {
      return "0.000";
   }
   const x = Number(scaled) / Number(ODDS_SCALE);
   if (!Number.isFinite(x) || x <= 0) {
      return "—";
   }
   return convertOdds(x, format, "slip");
}

/** Effective filled odds from on-chain `payout` / `amount` (unchanged after grading). */
function filledOddsScaledFromStake(amount: bigint, payout: bigint): bigint | null {
   if (amount <= 0n || payout <= 0n) {
      return null;
   }
   return (payout * ODDS_SCALE) / amount;
}

function filledOddsUiFromStake(amount: bigint, payout: bigint, format: OddsFormat): string {
   const scaled = filledOddsScaledFromStake(amount, payout);
   return scaled !== null ? oddsFromScaled(scaled, format) : "—";
}

function legOddsUi(oddsScaled: bigint | null, format: OddsFormat): string {
   if (oddsScaled === null) {
      return "—";
   }
   return oddsFromScaled(oddsScaled, format);
}

function eventGroupOddsUi(items: readonly { leg: WalletParlayLeg }[], format: OddsFormat): string {
   const priced = items.find((item) => item.leg.oddsScaled != null && item.leg.oddsScaled > 0n);
   return priced != null ? oddsFromScaled(priced.leg.oddsScaled!, format) : "—";
}

type ParlayLegItem = {
   index: number;
   leg: WalletParlayLeg;
};

type ParlayDisplayGroup =
   | { kind: "leg"; index: number; leg: WalletParlayLeg }
   | { kind: "event"; eventKey: string; items: readonly ParlayLegItem[] };

function groupParlayLegsForDisplay(legs: readonly WalletParlayLeg[]): ParlayDisplayGroup[] {
   const byEvent = new Map<string, ParlayLegItem[]>();
   const order: string[] = [];
   legs.forEach((leg, index) => {
      const key = eventLookupKey(leg.marketId);
      let bucket = byEvent.get(key);
      if (bucket === undefined) {
         bucket = [];
         byEvent.set(key, bucket);
         order.push(key);
      }
      bucket.push({ index, leg });
   });
   return order.map((key) => {
      const items = byEvent.get(key)!;
      if (items.length >= 2) {
         return { kind: "event", eventKey: key, items };
      }
      const only = items[0]!;
      return { kind: "leg", index: only.index, leg: only.leg };
   });
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
   isFreebet: boolean,
   finalPayout: bigint | null = null,
): bigint {
   const hasOdds = oddsScaled !== null && oddsScaled > 0n;

   switch (result) {
      case BetResult.Won:
         return userWinCreditBase(amount, payout, oddsScaled, isFreebet);
      case BetResult.HalfWon:
      case BetResult.ModifiedWin: {
         if (finalPayout != null) {
            return finalPayout;
         }
         const half = amount / 2n;
         if (isFreebet) {
            return userWinCreditBase(half, 0n, oddsScaled, true);
         }
         if (hasOdds) {
            return half + (half * oddsScaled) / ODDS_SCALE;
         }
         return payout;
      }
      case BetResult.Lost:
         return 0n;
      case BetResult.HalfLost:
         return isFreebet ? 0n : amount / 2n;
      case BetResult.Push:
      case BetResult.Cancelled:
      case BetResult.RolledBack:
         return isFreebet ? 0n : amount;
      case BetResult.CashedOut:
         if (finalPayout != null) {
            return finalPayout;
         }
         return isFreebet ? 0n : amount;
      default:
         return isFreebet ? userWinCreditBase(amount, payout, oddsScaled, true) : payout;
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

function BetBanner({
   betPda,
   betId,
   result,
   placedAt,
   historySig,
}: {
   betPda: string;
   betId: bigint;
   result: BetResult;
   placedAt?: number;
   historySig?: string;
}): ReactElement {
   const { t, formatBetTime } = useI18n();
   const when = placedAt != null ? formatBetTime(placedAt) : "";
   const href = historySig ? solscanTxUrl(historySig) : solscanAddressUrl(betPda);
   const linkLabel = historySig ? truncateAddressMiddle(historySig, 4, 4) : truncateAddressMiddle(betPda);
   return (
      <div className={`my-bets-card__banner my-bets-card__banner--${resultModifierClass(result)}`}>
         <span className="my-bets-card__banner-result">{betResultLabel(result, t)}</span>
         <div className="my-bets-card__banner-meta">
            {when !== "" && (
               <span className="my-bets-card__bet-time" title={when}>
                  {when}
               </span>
            )}
            <span className="my-bets-card__bet-id" title={t("myBets.betId", { id: betId.toString() })}>
               {betId.toString()}
            </span>
            <a
               href={href}
               target="_blank"
               rel="noopener noreferrer"
               className="my-bets-card__account-link"
               title={historySig ?? betPda}
            >
               {linkLabel}
            </a>
         </div>
      </div>
   );
}

function BetStakeGrid({
   amount,
   payout,
   result,
   freebet,
   boost = false,
   finalPayout = null,
}: {
   amount: bigint;
   payout: bigint;
   result: BetResult;
   freebet?: boolean;
   boost?: boolean;
   finalPayout?: bigint | null;
}): ReactElement {
   const { oddsFormat } = useSettings();
   const { t } = useI18n();
   const oddsScaled = filledOddsScaledFromStake(amount, payout);
   const oddsUi = filledOddsUiFromStake(amount, payout, oddsFormat);
   const settled = result !== BetResult.Pending;
   const payoutLabel = settled ? t("myBets.return") : t("myBets.potentialPayout");
   const payoutBase = settled
      ? settledReturnBaseUnits(amount, payout, result, oddsScaled, freebet === true, finalPayout)
      : userWinCreditBase(amount, payout, oddsScaled, freebet === true);

   return (
      <dl className="my-bets-card__grid">
         <div>
            <dt>{result === BetResult.CashedOut ? t("myBets.cashoutAmount") : t("myBets.stake")}</dt>
            <dd>
               <strong>{formatUsdcBaseUnitsForUi(amount)}</strong> USDC
               {freebet === true && <span className="my-bets-card__stake-freebet"> {t("myBets.freebet")}</span>}
               {boost === true && <span className="my-bets-card__stake-freebet"> {t("myBets.boost")}</span>}
            </dd>
         </div>
         {result !== BetResult.CashedOut && (
            <div>
               <dt>{t("myBets.filledOdds")}</dt>
               <dd>{oddsUi === "—" ? "—" : `${oddsUi}`}</dd>
            </div>
         )}
         <div>
            <dt>{payoutLabel}</dt>
            <dd>
               <strong>{formatUsdcBaseUnitsForUi(payoutBase)}</strong> USDC
            </dd>
         </div>
      </dl>
   );
}

function walletBetMarketIds(row: WalletBetRow): readonly MarketId[] {
   if (row.kind === "single") {
      return [row.data.marketId];
   }
   return row.legs.map((leg) => leg.marketId);
}

function BetMarketBody({
   lines,
   hideEventLine = false,
}: {
   lines: BetMarketDisplayLines;
   hideEventLine?: boolean;
}): ReactElement {
   return (
      <>
         {!hideEventLine && (
            <p className="my-bets-card__event-line">
               <span className="my-bets-card__event-title">{lines.eventTitle}</span>
               {lines.liveSuffix !== "" && <span className="my-bets-card__live-mark">{lines.liveSuffix}</span>}
            </p>
         )}
         {lines.promoTitle != null ? (
            <div className="my-bets-card__promo">
               <p className="my-bets-card__promo-title">{lines.promoTitle}</p>
               {lines.promoDescription != null && (
                  <p className="my-bets-card__promo-description">{lines.promoDescription}</p>
               )}
               <p className="my-bets-card__market-detail my-bets-card__market-detail--pick">{lines.pick}</p>
            </div>
         ) : (
            <p className="my-bets-card__market-detail">{lines.detailLine}</p>
         )}
      </>
   );
}

type AuctionCashoutQuote = {
   amount: bigint;
   maxPayment: bigint;
   fillingMm: Address;
   mmPrograms: Address[];
};

function CashoutBetPreview({
   row,
   eventsByKey,
   promosByMarketKey,
}: {
   row: WalletBetRow;
   eventsByKey: ReadonlyMap<string, BetCardEvent | null>;
   promosByMarketKey: ReadonlyMap<string, UiPromotionalMarket>;
}): ReactElement {
   const copy = useBetMarketCopy();
   const { t } = useI18n();
   if (row.kind === "single") {
      const b = row.data;
      const ek = eventLookupKey(b.marketId);
      const promoKey = isPromoMarketChain(b.marketId) ? promoMarketLookupKey(b.marketId) : null;
      const promo = promoKey != null ? (promosByMarketKey.get(promoKey) ?? null) : null;
      const lines = betMarketDisplayLines(eventsByKey.get(ek) ?? undefined, b.marketId, b.side, promo, copy);
      return <BetMarketBody lines={lines} />;
   }
   const legCount = row.legs.length;
   return (
      <>
         <p className="my-bets-card__parlay-heading">
            {legCount === 1 ? t("myBets.parlayOne", { count: legCount }) : t("myBets.parlayMany", { count: legCount })}
         </p>
         <ParlayLegsList
            listKey={`${row.address}-cashout`}
            legs={row.legs}
            eventsByKey={eventsByKey}
            promosByMarketKey={promosByMarketKey}
         />
      </>
   );
}

function CashoutModal({
   row,
   eventsByKey,
   promosByMarketKey,
   onClose,
   onChanged,
}: {
   row: WalletBetRow;
   eventsByKey: ReadonlyMap<string, BetCardEvent | null>;
   promosByMarketKey: ReadonlyMap<string, UiPromotionalMarket>;
   onClose: () => void;
   onChanged: () => void;
}): ReactElement {
   const { account, isConnected } = useWallet();
   const { signer: walletSigner, ready: signerReady, walletName } = useAppTransactionSigner();
   const { cluster } = useCluster();
   const clusterRpcUrl = useMemo(() => resolveAppHttpRpcUrl(cluster?.url), [cluster?.url]);
   const rpc = useMemo(() => createSolanaRpc(clusterRpcUrl) as Rpc<SolanaRpcApi>, [clusterRpcUrl]);
   const rpcSubscriptions = useMemo(
      () => createSolanaRpcSubscriptions(httpToWsRpcUrl(clusterRpcUrl)),
      [clusterRpcUrl],
   );

   const stake = ticketAmountOfRow(row);
   const usesRfq = cashoutUsesRfq(row);
   const [cashAmount, setCashAmount] = useState(stake);
   const [debouncedAmount, setDebouncedAmount] = useState(stake);
   const skipDebounceRef = useRef(true);
   const [quotedPay, setQuotedPay] = useState<bigint | null>(null);
   const [quoting, setQuoting] = useState(false);
   const [quoteErr, setQuoteErr] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);
   const [sendErr, setSendErr] = useState<string | null>(null);
   const lockRef = useRef(false);
   const auctionQuoteRef = useRef<AuctionCashoutQuote | null>(null);
   const { t } = useI18n();

   useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
         if (e.key === "Escape" && !lockRef.current) {
            onClose();
         }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
   }, [onClose]);

   useEffect(() => {
      if (skipDebounceRef.current) {
         skipDebounceRef.current = false;
         setDebouncedAmount(cashAmount);
         return;
      }
      const id = window.setTimeout(() => setDebouncedAmount(cashAmount), CASHOUT_QUOTE_DEBOUNCE_MS);
      return () => window.clearTimeout(id);
   }, [cashAmount]);

   useEffect(() => {
      if (!isConnected || account == null || debouncedAmount <= 0n) {
         setQuotedPay(null);
         setQuoting(false);
         auctionQuoteRef.current = null;
         return;
      }
      let cancelled = false;
      setQuoting(true);
      setQuoteErr(null);
      void (async () => {
         try {
            const user = address(account);
            if (usesRfq) {
               if (row.kind !== "parlay" || row.account == null) {
                  throw new Error("Parlay account missing");
               }
               const q = await quoteRfqParlayCashout({ user, parlay: row.account, amount: debouncedAmount });
               if (cancelled) {
                  return;
               }
               auctionQuoteRef.current = null;
               setQuotedPay(q.maxPayment);
            } else {
               const q = await quoteAuctionCashout({ rpc, user, row, amount: debouncedAmount });
               if (cancelled) {
                  return;
               }
               auctionQuoteRef.current = { amount: debouncedAmount, ...q };
               setQuotedPay(q.maxPayment);
            }
         } catch (e) {
            if (!cancelled) {
               auctionQuoteRef.current = null;
               setQuotedPay(null);
               setQuoteErr(e instanceof Error ? e.message : String(e));
            }
         } finally {
            if (!cancelled) {
               setQuoting(false);
            }
         }
      })();
      return () => {
         cancelled = true;
      };
   }, [account, debouncedAmount, isConnected, rpc, row, usesRfq]);

   const remaining = stake - cashAmount;
   const quoteReady =
      cashAmount > 0n && cashAmount === debouncedAmount && quotedPay != null && !quoting && quoteErr == null;
   const sliderMax = Number(stake);

   const runCashout = async () => {
      if (!isConnected || account == null || walletSigner == null || !signerReady) {
         return;
      }
      if (cashAmount <= 0n || cashAmount > stake) {
         return;
      }
      if (lockRef.current) {
         return;
      }
      lockRef.current = true;
      setBusy(true);
      setSendErr(null);
      try {
         const user = address(account);
         const sendAndConfirm = sendAndConfirmTransactionFactory({
            rpc,
            rpcSubscriptions,
         } as never);
         let signed;
         if (usesRfq) {
            if (row.kind !== "parlay" || row.account == null) {
               throw new Error("Parlay account missing");
            }
            const out = await quoteAndSignRfqParlayCashout({
               rpc,
               walletSigner,
               user,
               parlay: row.account,
               amount: cashAmount,
            });
            signed = out.signed;
         } else {
            let q = auctionQuoteRef.current;
            if (q == null || q.amount !== cashAmount) {
               q = { amount: cashAmount, ...(await quoteAuctionCashout({ rpc, user, row, amount: cashAmount })) };
               auctionQuoteRef.current = q;
            }
            signed = await buildSignAuctionCashoutTx({
               rpc,
               walletSigner,
               user,
               row,
               fillingMm: q.fillingMm,
               mmPrograms: q.mmPrograms,
               maxPayment: q.maxPayment,
               amount: cashAmount,
            });
         }
         await sendAndConfirm(signed as never, { commitment: "confirmed" });
         requestWalletBalanceRefresh();
         onChanged();
         onClose();
      } catch (e) {
         setSendErr(signErrorMessageForUi(e, { walletName }));
      } finally {
         setBusy(false);
         lockRef.current = false;
      }
   };

   const receiveUpdating = cashAmount > 0n && (quoting || cashAmount !== debouncedAmount);
   const receiveUi =
      cashAmount <= 0n || quotedPay == null || receiveUpdating ? null : formatUsdcBaseUnitsForUi(quotedPay);

   return (
      <div
         className="bet-modal-overlay"
         role="presentation"
         onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
               onClose();
            }
         }}
      >
         <div
            className="bet-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cashout-modal-title"
            onMouseDown={(e) => e.stopPropagation()}
         >
            <header className="bet-modal-header">
               <h2 id="cashout-modal-title" className="bet-modal-title">
                  {t("myBets.cashOut")}
               </h2>
               <button type="button" className="bet-modal-close" onClick={onClose} aria-label={t("buttons.close")} disabled={busy}>
                  ×
               </button>
            </header>
            <div className="bet-modal-body">
               <div className="cashout-modal__bet">
                  <CashoutBetPreview row={row} eventsByKey={eventsByKey} promosByMarketKey={promosByMarketKey} />
                  <p className="cashout-modal__stake">
                     {t("myBets.stake")} <strong>{formatUsdcBaseUnitsForUi(stake)}</strong> USDC
                  </p>
               </div>
               <label className="cashout-modal__slider-field">
                  <span className="bet-modal-field-label">{t("myBets.amountToCashOut")}</span>
                  <input
                     className="cashout-modal__slider"
                     type="range"
                     min={0}
                     max={Number.isFinite(sliderMax) ? sliderMax : 0}
                     step={1}
                     value={cashAmount.toString()}
                     disabled={busy || stake <= 0n}
                     onChange={(e) => {
                        let next = BigInt(e.target.value);
                        if (next < 0n) {
                           next = 0n;
                        }
                        if (next > stake) {
                           next = stake;
                        }
                        setCashAmount(next);
                     }}
                     onPointerUp={(e) => {
                        setDebouncedAmount(BigInt(e.currentTarget.value));
                     }}
                     onKeyUp={(e) => {
                        setDebouncedAmount(BigInt(e.currentTarget.value));
                     }}
                  />
               </label>
               <dl className="cashout-modal__stats">
                  <div>
                     <dt>{t("myBets.cashingOut")}</dt>
                     <dd>
                        <strong>{formatUsdcBaseUnitsForUi(cashAmount)}</strong> USDC
                     </dd>
                  </div>
                  <div>
                     <dt>{t("myBets.remaining")}</dt>
                     <dd>
                        <strong>{formatUsdcBaseUnitsForUi(remaining)}</strong> USDC
                     </dd>
                  </div>
                  <div>
                     <dt>{t("myBets.youReceive")}</dt>
                     <dd>
                        {receiveUpdating ? (
                           <strong>…</strong>
                        ) : receiveUi != null ? (
                           <>
                              <strong>{receiveUi}</strong> USDC
                           </>
                        ) : (
                           <strong>—</strong>
                        )}
                     </dd>
                  </div>
               </dl>
               {quoting && cashAmount === debouncedAmount && <p className="bet-modal-muted">{t("myBets.fetchingQuote")}</p>}
               {quoteErr != null && cashAmount === debouncedAmount && <p className="bet-modal-err">{quoteErr}</p>}
               {sendErr != null && <p className="bet-modal-err">{sendErr}</p>}
            </div>
            <footer className="bet-modal-footer">
               <button type="button" className="bet-modal-btn bet-modal-btn--ghost" disabled={busy} onClick={onClose}>
                  {t("buttons.cancel")}
               </button>
               <button
                  type="button"
                  className="bet-modal-btn bet-modal-btn--primary"
                  disabled={busy || !quoteReady || !signerReady || walletSigner == null}
                  onClick={() => void runCashout()}
               >
                  {busy ? t("myBets.cashingOutBusy") : t("myBets.confirmCashOut")}
               </button>
            </footer>
         </div>
      </div>
   );
}

function CardActions({
   row,
   interactive,
   onChanged,
   eventsByKey,
   promosByMarketKey,
}: {
   row: WalletBetRow;
   interactive: boolean;
   onChanged: () => void;
   eventsByKey: ReadonlyMap<string, BetCardEvent | null>;
   promosByMarketKey: ReadonlyMap<string, UiPromotionalMarket>;
}): ReactElement | null {
   const { account, isConnected } = useWallet();
   const { signer: walletSigner, ready: signerReady, walletName } = useAppTransactionSigner();
   const { cluster } = useCluster();
   const clusterRpcUrl = useMemo(() => resolveAppHttpRpcUrl(cluster?.url), [cluster?.url]);
   const rpc = useMemo(() => createSolanaRpc(clusterRpcUrl) as Rpc<SolanaRpcApi>, [clusterRpcUrl]);
   const rpcSubscriptions = useMemo(
      () => createSolanaRpcSubscriptions(httpToWsRpcUrl(clusterRpcUrl)),
      [clusterRpcUrl],
   );

   const [busy, setBusy] = useState(false);
   const [err, setErr] = useState<string | null>(null);
   const [cashoutOpen, setCashoutOpen] = useState(false);
   const [escrowReady, setEscrowReady] = useState(false);
   const [escrowWait, setEscrowWait] = useState<number | null>(null);
   const lockRef = useRef(false);
   const { t } = useI18n();

   const result = walletBetRowResult(row);
   const showCashout = interactive && canCashoutRow(row);
   const showClaimEscrow = interactive && result === BetResult.CashedOut;

   useEffect(() => {
      if (!showClaimEscrow || !isConnected || account == null) {
         return;
      }
      let cancelled = false;
      const tick = async () => {
         const escrow = await loadEscrowForOrigBet(rpc, address(account), origBetIdOfRow(row));
         if (cancelled) {
            return;
         }
         if (escrow == null) {
            setEscrowReady(false);
            setEscrowWait(null);
            return;
         }
         const now = Math.floor(Date.now() / 1000);
         if (escrowClaimReady(escrow, now)) {
            setEscrowReady(true);
            setEscrowWait(0);
         } else {
            setEscrowReady(false);
            setEscrowWait(escrow.timestamp + LIVE_CASHOUT_DELAY - now);
         }
      };
      void tick();
      const id = window.setInterval(() => void tick(), 2000);
      return () => {
         cancelled = true;
         window.clearInterval(id);
      };
   }, [showClaimEscrow, row, rpc, isConnected, account]);

   if (!showCashout && !showClaimEscrow) {
      return null;
   }

   const runClaimEscrow = async () => {
      if (!isConnected || account == null || walletSigner == null || !signerReady) {
         return;
      }
      if (lockRef.current) {
         return;
      }
      lockRef.current = true;
      setBusy(true);
      setErr(null);
      try {
         const escrow = await loadEscrowForOrigBet(rpc, address(account), origBetIdOfRow(row));
         if (escrow == null) {
            throw new Error("Cashout escrow not found");
         }
         if (!escrowClaimReady(escrow)) {
            throw new Error("Cashout delay not finished");
         }
         const signed = await buildSignClaimCashoutTx({
            rpc,
            walletSigner,
            escrow,
            ticketFeepayer: ticketFeepayerOfRow(row),
            mint: row.kind === "single" ? row.data.marketId.mint : row.legs[0]!.marketId.mint,
         });
         const sendAndConfirm = sendAndConfirmTransactionFactory({
            rpc,
            rpcSubscriptions,
         } as never);
         await sendAndConfirm(signed as never, { commitment: "confirmed" });
         requestWalletBalanceRefresh();
         onChanged();
      } catch (e) {
         setErr(signErrorMessageForUi(e, { walletName }));
      } finally {
         setBusy(false);
         lockRef.current = false;
      }
   };

   return (
      <div className="my-bets-card__actions">
         {showCashout && (
            <button
               type="button"
               className="my-bets-card__cashout"
               disabled={!signerReady || walletSigner == null}
               onClick={() => setCashoutOpen(true)}
            >
               {t("myBets.cashOut")}
            </button>
         )}
         {showClaimEscrow && (
            <button
               type="button"
               className="my-bets-card__cashout"
               disabled={busy || !escrowReady || !signerReady || walletSigner == null}
               onClick={() => void runClaimEscrow()}
            >
               {busy
                  ? t("myBets.claiming")
                  : escrowWait != null && escrowWait > 0
                    ? t("myBets.claimCashoutIn", { seconds: escrowWait })
                    : t("myBets.claimCashout")}
            </button>
         )}
         {err != null && <p className="my-bets-card__action-err">{err}</p>}
         {cashoutOpen && (
            <CashoutModal
               row={row}
               eventsByKey={eventsByKey}
               promosByMarketKey={promosByMarketKey}
               onClose={() => setCashoutOpen(false)}
               onChanged={onChanged}
            />
         )}
      </div>
   );
}

function BetCard({
   betPda,
   b,
   eventsByKey,
   promosByMarketKey,
   actions,
   historySig,
   finalPayout = null,
}: {
   betPda: string;
   b: BetAccountData;
   eventsByKey: ReadonlyMap<string, BetCardEvent | null>;
   promosByMarketKey: ReadonlyMap<string, UiPromotionalMarket>;
   actions?: ReactElement | null;
   historySig?: string;
   finalPayout?: bigint | null;
}): ReactElement {
   const copy = useBetMarketCopy();
   const ek = eventLookupKey(b.marketId);
   const promoKey = isPromoMarketChain(b.marketId) ? promoMarketLookupKey(b.marketId) : null;
   const promo = promoKey != null ? (promosByMarketKey.get(promoKey) ?? null) : null;
   const lines = betMarketDisplayLines(eventsByKey.get(ek) ?? undefined, b.marketId, b.side, promo, copy);

   return (
      <li className="my-bets-card">
         <BetBanner
            betPda={betPda}
            betId={b.betId}
            result={b.result}
            placedAt={b.timestamp}
            historySig={historySig}
         />
         <div className="my-bets-card__body">
            <BetMarketBody lines={lines} />
            <BetStakeGrid
               amount={b.amount}
               payout={b.payout}
               result={b.result}
               freebet={b.promoType === PROMO_FREEBET}
               boost={b.promoType === PROMO_BOOST}
               finalPayout={finalPayout}
            />
            {actions}
         </div>
      </li>
   );
}

function ParlayLegOdds({ oddsScaled }: { oddsScaled: bigint | null }): ReactElement {
   const { oddsFormat } = useSettings();
   const ui = legOddsUi(oddsScaled, oddsFormat);
   const zero = oddsScaled === 0n;
   return (
      <span className={`my-bets-card__parlay-odds${zero ? " my-bets-card__parlay-odds--zero" : ""}`}>
         {ui}
      </span>
   );
}

function ParlayLegRow({
   leg,
   legIndex,
   eventsByKey,
   promosByMarketKey,
   hideEventLine = false,
   hideOdds = false,
}: {
   leg: WalletParlayLeg;
   legIndex: number;
   eventsByKey: ReadonlyMap<string, BetCardEvent | null>;
   promosByMarketKey: ReadonlyMap<string, UiPromotionalMarket>;
   hideEventLine?: boolean;
   hideOdds?: boolean;
}): ReactElement {
   const copy = useBetMarketCopy();
   const { t } = useI18n();
   const ek = eventLookupKey(leg.marketId);
   const promoKey = isPromoMarketChain(leg.marketId) ? promoMarketLookupKey(leg.marketId) : null;
   const promo = promoKey != null ? (promosByMarketKey.get(promoKey) ?? null) : null;
   const lines = betMarketDisplayLines(eventsByKey.get(ek) ?? undefined, leg.marketId, leg.side, promo, copy);
   const legResult = leg.result;
   const showResult = legResult != null && legResult !== BetResult.Pending;
   return (
      <li className="my-bets-card__parlay-leg">
         <span className="my-bets-card__parlay-leg-num" aria-hidden>
            {legIndex + 1}
         </span>
         <div className="my-bets-card__parlay-leg-main">
            <div className="my-bets-card__parlay-leg-text">
               <BetMarketBody lines={lines} hideEventLine={hideEventLine} />
               {showResult && (
                  <span className={`my-bets-card__leg-result my-bets-card__leg-result--${resultModifierClass(legResult)}`}>
                     {betResultLabel(legResult, t)}
                  </span>
               )}
            </div>
            {!hideOdds && <ParlayLegOdds oddsScaled={leg.oddsScaled} />}
         </div>
      </li>
   );
}

function ParlayEventGroup({
   items,
   eventsByKey,
   promosByMarketKey,
}: {
   items: readonly ParlayLegItem[];
   eventsByKey: ReadonlyMap<string, BetCardEvent | null>;
   promosByMarketKey: ReadonlyMap<string, UiPromotionalMarket>;
}): ReactElement {
   const copy = useBetMarketCopy();
   const first = items[0]!.leg;
   const ek = eventLookupKey(first.marketId);
   const promoKey = isPromoMarketChain(first.marketId) ? promoMarketLookupKey(first.marketId) : null;
   const promo = promoKey != null ? (promosByMarketKey.get(promoKey) ?? null) : null;
   const lines = betMarketDisplayLines(eventsByKey.get(ek) ?? undefined, first.marketId, first.side, promo, copy);
   const { oddsFormat } = useSettings();
   const eventOdds = eventGroupOddsUi(items, oddsFormat);
   return (
      <li className="my-bets-card__parlay-event">
         <div className="my-bets-card__parlay-event-head">
            <p className="my-bets-card__event-line">
               <span className="my-bets-card__event-title">{lines.eventTitle}</span>
               {lines.liveSuffix !== "" && <span className="my-bets-card__live-mark">{lines.liveSuffix}</span>}
            </p>
            <span className="my-bets-card__parlay-odds">{eventOdds}</span>
         </div>
         <ol className="my-bets-card__parlay-event-legs">
            {items.map(({ index, leg }) => (
               <ParlayLegRow
                  key={index}
                  leg={leg}
                  legIndex={index}
                  eventsByKey={eventsByKey}
                  promosByMarketKey={promosByMarketKey}
                  hideEventLine
                  hideOdds
               />
            ))}
         </ol>
      </li>
   );
}

function ParlayLegsList({
   listKey,
   legs,
   eventsByKey,
   promosByMarketKey,
}: {
   listKey: string;
   legs: readonly WalletParlayLeg[];
   eventsByKey: ReadonlyMap<string, BetCardEvent | null>;
   promosByMarketKey: ReadonlyMap<string, UiPromotionalMarket>;
}): ReactElement {
   const groups = groupParlayLegsForDisplay(legs);
   return (
      <ol className="my-bets-card__parlay-legs">
         {groups.map((group) =>
            group.kind === "event" ? (
               <ParlayEventGroup
                  key={`${listKey}-${group.eventKey}`}
                  items={group.items}
                  eventsByKey={eventsByKey}
                  promosByMarketKey={promosByMarketKey}
               />
            ) : (
               <ParlayLegRow
                  key={`${listKey}-${group.index}`}
                  leg={group.leg}
                  legIndex={group.index}
                  eventsByKey={eventsByKey}
                  promosByMarketKey={promosByMarketKey}
               />
            ),
         )}
      </ol>
   );
}

function ParlayBetCard({
   betPda,
   row,
   eventsByKey,
   promosByMarketKey,
   actions,
}: {
   betPda: string;
   row: Extract<WalletBetRow, { kind: "parlay" }>;
   eventsByKey: ReadonlyMap<string, BetCardEvent | null>;
   promosByMarketKey: ReadonlyMap<string, UiPromotionalMarket>;
   actions?: ReactElement | null;
}): ReactElement {
   const { t } = useI18n();
   const legCount = row.legs.length;
   return (
      <li className="my-bets-card my-bets-card--parlay">
         <BetBanner
            betPda={betPda}
            betId={row.betId}
            result={row.result}
            placedAt={row.timestamp}
            historySig={row.historySig}
         />
         <div className="my-bets-card__body">
            <p className="my-bets-card__parlay-heading">
               {legCount === 1 ? t("myBets.parlayOne", { count: legCount }) : t("myBets.parlayMany", { count: legCount })}
            </p>
            <ParlayLegsList
               listKey={betPda}
               legs={row.legs}
               eventsByKey={eventsByKey}
               promosByMarketKey={promosByMarketKey}
            />
            <BetStakeGrid
               amount={row.amount}
               payout={row.payout}
               result={row.result}
               freebet={(row.promoType ?? row.account?.promoType) === PROMO_FREEBET || walletRowFreebetId(row) !== 0}
               boost={(row.promoType ?? row.account?.promoType) === PROMO_BOOST}
               finalPayout={row.finalPayout ?? null}
            />
            {actions}
         </div>
      </li>
   );
}

function WalletBetCard({
   row,
   eventsByKey,
   promosByMarketKey,
   interactive,
   onChanged,
}: {
   row: WalletBetRow;
   eventsByKey: ReadonlyMap<string, BetCardEvent | null>;
   promosByMarketKey: ReadonlyMap<string, UiPromotionalMarket>;
   interactive?: boolean;
   onChanged?: () => void;
}): ReactElement {
   const actions =
      interactive === true && onChanged != null ? (
         <CardActions
            row={row}
            interactive
            onChanged={onChanged}
            eventsByKey={eventsByKey}
            promosByMarketKey={promosByMarketKey}
         />
      ) : null;
   if (row.kind === "parlay") {
      return (
         <ParlayBetCard
            betPda={row.address}
            row={row}
            eventsByKey={eventsByKey}
            promosByMarketKey={promosByMarketKey}
            actions={actions}
         />
      );
   }
   return (
      <BetCard
         betPda={row.address}
         b={row.data}
         eventsByKey={eventsByKey}
         promosByMarketKey={promosByMarketKey}
         actions={actions}
         historySig={row.historySig}
         finalPayout={row.finalPayout ?? null}
      />
   );
}

export function MyBetsPage(): ReactElement {
   const { account, isConnected } = useWallet();
   const { signer: walletSigner, ready: signerReady, walletName } = useAppTransactionSigner();
   const { cluster } = useCluster();
   const { t } = useI18n();

   const clusterRpcUrl = useMemo(() => resolveAppHttpRpcUrl(cluster?.url), [cluster?.url]);

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
   const [eventsByKey, setEventsByKey] = useState<ReadonlyMap<string, BetCardEvent | null>>(() => new Map());
   const [promosByMarketKey, setPromosByMarketKey] = useState<ReadonlyMap<string, UiPromotionalMarket>>(
      () => new Map(),
   );
   const [claimBusy, setClaimBusy] = useState(false);
   const [claimErr, setClaimErr] = useState<string | null>(null);
   const claimLockRef = useRef(false);

   const settledRows = useMemo(
      () =>
         rows.filter((row) => {
            const r = walletBetRowResult(row);
            return r !== BetResult.Pending && r !== BetResult.CashedOut;
         }),
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
      for (const row of [...rows, ...closedRows]) {
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
   }, [closedRows, rows]);

   const hasPromoBets = useMemo(() => {
      for (const row of [...rows, ...closedRows]) {
         for (const marketId of walletBetMarketIds(row)) {
            if (isPromoMarketChain(marketId)) {
               return true;
            }
         }
      }
      return false;
   }, [closedRows, rows]);

   useEffect(() => {
      const missing = [...eventKeys.entries()].filter(([key]) => !eventsByKey.has(key));
      if (missing.length === 0) {
         return;
      }
      let cancelled = false;
      void (async () => {
         const byKey = new Map<string, BetCardEvent>();
         try {
            const cards = await fetchBetCardEvents(missing.map(([, ids]) => ids.event));
            for (const ev of cards) {
               byKey.set(`${ev.sport_id}:${ev.league_id}:${ev.id}`, ev);
            }
         } catch {
            /* mark missing keys null below so we do not retry per bet */
         }
         if (!cancelled) {
            setEventsByKey((prev) => {
               const next = new Map(prev);
               for (const [key] of missing) {
                  if (!next.has(key)) {
                     next.set(key, byKey.get(key) ?? null);
                  }
               }
               return next;
            });
         }
      })();
      return () => {
         cancelled = true;
      };
   }, [eventKeys, eventsByKey]);

   useEffect(() => {
      if (!hasPromoBets) {
         setPromosByMarketKey(new Map());
         return;
      }
      let cancelled = false;
      void (async () => {
         try {
            const promos = await fetchPromosForBetLookup();
            if (!cancelled) {
               setPromosByMarketKey(indexPromotionalMarkets(promos));
            }
         } catch {
            if (!cancelled) {
               setPromosByMarketKey(new Map());
            }
         }
      })();
      return () => {
         cancelled = true;
      };
   }, [hasPromoBets]);

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
                  if (row.data.promoType === PROMO_FREEBET || row.data.promoType === PROMO_BOOST) {
                     if (row.issuerAuth == null) {
                        throw new Error("Promo issuer not found");
                     }
                     return row.data.promoType === PROMO_BOOST
                        ? getSettleBoostedBetIx(userAddr, betPda, row.data, row.issuerAuth)
                        : getSettleFreebetIx(userAddr, betPda, row.data, row.issuerAuth);
                  }
                  return getSettleBetIx(userAddr, betPda, row.data);
               }
               if (row.account == null) {
                  throw new Error("Parlay account missing");
               }
               if (row.account.promoType === PROMO_FREEBET || row.account.promoType === PROMO_BOOST) {
                  if (row.issuerAuth == null) {
                     throw new Error("Promo issuer not found");
                  }
                  return row.account.promoType === PROMO_BOOST
                     ? getSettleBoostedParlayIx(userAddr, betPda, row.account, row.issuerAuth)
                     : getSettleFreebetParlayIx(userAddr, betPda, row.account, row.issuerAuth);
               }
               return getSettleParlayIx(userAddr, betPda, row.account);
            }),
         );
         const instructionChunks: (typeof instructionList)[] = [];
         for (let i = 0; i < instructionList.length; i += MAX_SETTLE_IX_PER_TX) {
            instructionChunks.push(instructionList.slice(i, i + MAX_SETTLE_IX_PER_TX));
         }
         for (let chunkIdx = 0; chunkIdx < instructionChunks.length; chunkIdx++) {
            const chunk = instructionChunks[chunkIdx]!;
            const signed = await buildSignV1Transaction(rpc, {
               feePayer: walletSigner,
               instructions: chunk,
               signers: [walletSigner],
            });
            await sendAndConfirm(signed as never, { commitment: "confirmed" });
            requestWalletBalanceRefresh();
            const from = chunkIdx * MAX_SETTLE_IX_PER_TX;
            const settledAddresses = new Set(
               graded.slice(from, from + MAX_SETTLE_IX_PER_TX).map((r) => r.address),
            );
            setRows((prev) => prev.filter((row) => !settledAddresses.has(row.address)));
         }
         await loadOpen();
         void loadClosed();
      } catch (e) {
         setClaimErr(signErrorMessageForUi(e, { walletName }));
      } finally {
         setClaimBusy(false);
         claimLockRef.current = false;
      }
   }, [account, isConnected, loadClosed, loadOpen, rpc, rpcSubscriptions, settledRows, signerReady, walletName, walletSigner]);

   if (!isConnected || !account) {
      return (
         <main className="my-bets-page">
            <h2 className="my-bets-page__title">{t("myBets.title")}</h2>
            <p className="my-bets-page__hint">{t("myBets.connectHint")}</p>
         </main>
      );
   }

   return (
      <main className="my-bets-page">
         <div className="my-bets-page__head">
            <h2 className="my-bets-page__title">{t("myBets.title")}</h2>
            <button
               type="button"
               className="my-bets-page__refresh"
               disabled={activeState === "loading"}
               onClick={() => void (betTab === "open" ? loadOpen() : loadClosed())}
            >
               {activeState === "loading" ? t("myBets.refreshing") : t("myBets.refresh")}
            </button>
         </div>

         {activeState === "err" && activeErr != null && <p className="my-bets-page__err">{activeErr}</p>}
         {claimErr != null && betTab === "open" && <p className="my-bets-page__err">{claimErr}</p>}

         <div className="my-bets-page__tabs-row">
            <div className="my-bets-page__tabs" role="tablist" aria-label={t("myBets.groups")}>
               <button
                  type="button"
                  role="tab"
                  aria-selected={betTab === "open"}
                  className={`my-bets-page__tab${betTab === "open" ? " my-bets-page__tab--active" : ""}`}
                  onClick={() => setBetTab("open")}
               >
                  {t("myBets.openBets", { count: rows.length })}
               </button>
               <button
                  type="button"
                  role="tab"
                  aria-selected={betTab === "closed"}
                  className={`my-bets-page__tab${betTab === "closed" ? " my-bets-page__tab--active" : ""}`}
                  onClick={() => setBetTab("closed")}
               >
                  {t("myBets.closedBets", { count: closedRows.length })}
               </button>
            </div>
            {betTab === "open" && settledRows.length > 0 && (
               <button
                  type="button"
                  className="my-bets-page__claim"
                  disabled={claimBusy || state === "loading" || !signerReady || walletSigner == null}
                  title={
                     walletSigner == null
                        ? t("myBets.connectWallet")
                        : !signerReady
                          ? t("myBets.signerNotReady")
                          : undefined
                  }
                  onClick={() => void runClaim()}
               >
                  {claimBusy
                     ? t("myBets.claiming")
                     : t("myBets.claim", {
                          count: claimTxCount,
                          txs: claimTxCount === 1 ? t("myBets.tx") : t("myBets.txs"),
                       })}
               </button>
            )}
         </div>

         <div className="my-bets-page__tab-panel" role="tabpanel">
            {activeLoading && <p className="my-bets-page__loading">{t("myBets.loading")}</p>}

            {activeState === "ok" && activeEmpty && (
               <p className="my-bets-page__empty">
                  {betTab === "open" ? t("myBets.emptyOpen") : t("myBets.emptyClosed")}
               </p>
            )}

            {betTab === "open" && openCount > 0 && (
               <ul className="my-bets-list">
                  {rows.map((row) => (
                     <WalletBetCard
                        key={row.address}
                        row={row}
                        eventsByKey={eventsByKey}
                        promosByMarketKey={promosByMarketKey}
                        interactive
                        onChanged={() => {
                           void loadOpen();
                           void loadClosed();
                        }}
                     />
                  ))}
               </ul>
            )}

            {betTab === "closed" && closedCount > 0 && (
               <ul className="my-bets-list">
                  {closedRows.map((row) => (
                     <WalletBetCard key={row.address} row={row} eventsByKey={eventsByKey} promosByMarketKey={promosByMarketKey} />
                  ))}
               </ul>
            )}
         </div>
      </main>
   );
}
