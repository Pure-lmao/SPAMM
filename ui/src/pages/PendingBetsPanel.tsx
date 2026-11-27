import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { useCluster } from "@solana/connector/react";
import { useLocation } from "react-router-dom";
import { BetResult } from "spamm-aggregator-sdk";
import { resolveAppHttpRpcUrl } from "../betting/txPipeline";
import { useI18n } from "../i18n/useI18n";
import { subscribeBetRefresh } from "../betting/betRefresh";
import { fetchOpenWalletBets, walletBetRowResult, type WalletBetRow } from "../markets/fetchBetHistory";
import { useBetPresentation } from "../markets/useBetPresentation";
import { useAppWallet } from "../wallet/useAppWallet";
import { WalletBetCard } from "./MyBetsPage";
import { useSideRails } from "../layout/sideRails";

/** Phone layout. The edge tab is hidden here. */
const MOBILE_MQ = "(max-width: 720px)";
/** Matches the layout rule that keeps this column beside the main page. */
const WIDE_MQ = "(min-width: 1620px)";

function useMediaQuery(query: string): boolean {
   const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
   useEffect(() => {
      const mq = window.matchMedia(query);
      const onChange = () => setMatches(mq.matches);
      onChange();
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
   }, [query]);
   return matches;
}

export function PendingBetsPanel(): ReactElement | null {
   const mobile = useMediaQuery(MOBILE_MQ);
   const wide = useMediaQuery(WIDE_MQ);
   const { betsRequested, betsDismissed, openBets, closeBets, setBetsVisible } = useSideRails();
   const { pathname } = useLocation();
   const onMyBets = pathname === "/my-bets";
   const showPanel = !mobile && !onMyBets && !betsDismissed && (wide || betsRequested);
   const showTab = !mobile && !onMyBets && !(wide && showPanel);
   const { account, isConnected } = useAppWallet();
   const connected = isConnected && account != null;
   const { cluster } = useCluster();
   const { t } = useI18n();
   const clusterRpcUrl = useMemo(() => resolveAppHttpRpcUrl(cluster?.url), [cluster?.url]);
   const rpc = useMemo(() => createSolanaRpc(clusterRpcUrl) as Rpc<SolanaRpcApi>, [clusterRpcUrl]);
   const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
   const [err, setErr] = useState<string | null>(null);
   const [rows, setRows] = useState<readonly WalletBetRow[]>([]);

   useEffect(() => {
      setBetsVisible(showPanel);
      return () => setBetsVisible(false);
   }, [showPanel, setBetsVisible]);

   const load = useCallback(async () => {
      if (!showPanel || !isConnected || !account) {
         setRows([]);
         setState("idle");
         setErr(null);
         return;
      }
      setState("loading");
      setErr(null);
      try {
         const list = await fetchOpenWalletBets(rpc, account);
         setRows(list.filter((row) => walletBetRowResult(row) === BetResult.Pending));
         setState("ok");
      } catch (e) {
         setErr(e instanceof Error ? e.message : String(e));
         setState("err");
      }
   }, [account, isConnected, rpc, showPanel]);

   useEffect(() => {
      void load();
   }, [load]);

   useEffect(() => subscribeBetRefresh(() => {
      void load();
   }), [load]);

   const { eventsByKey, promosByMarketKey } = useBetPresentation(rows);

   if (!showTab && !showPanel) {
      return null;
   }

   const tab = showTab ? (
      <button
         type="button"
         className={`pending-bets-tab${showPanel ? " pending-bets-tab--docked" : ""}`}
         aria-expanded={showPanel}
         aria-controls="pending-bets-panel"
         onClick={() => {
            if (showPanel) {
               closeBets();
            } else {
               openBets();
            }
         }}
      >
         {t("myBets.title")}
      </button>
   ) : null;

   const panel =
      showPanel && !connected && !wide ? (
         <aside id="pending-bets-panel" className="pending-bets-panel pending-bets-panel--forced" aria-label={t("myBets.pendingPanel")}>
            <h2 className="pending-bets-panel__title">{t("myBets.title")}</h2>
            <p className="my-bets-page__hint">{t("myBets.connectHint")}</p>
         </aside>
      ) : showPanel && connected ? (
         <aside
            id="pending-bets-panel"
            className={`pending-bets-panel${wide ? "" : " pending-bets-panel--forced"}`}
            aria-label={t("myBets.pendingPanel")}
         >
         <div className="pending-bets-panel__head">
            <h2 className="pending-bets-panel__title">{t("myBets.pendingBets", { count: rows.length })}</h2>
            <button
               type="button"
               className="my-bets-page__refresh"
               disabled={state === "loading"}
               onClick={() => void load()}
            >
               {state === "loading" ? t("myBets.refreshing") : t("myBets.refresh")}
            </button>
         </div>
         {state === "err" && err != null && <p className="my-bets-page__err">{err}</p>}
         {state === "loading" && rows.length === 0 && <p className="my-bets-page__loading">{t("myBets.loading")}</p>}
         {state === "ok" && rows.length === 0 && <p className="my-bets-page__empty">{t("myBets.emptyPending")}</p>}
         {rows.length > 0 && (
            <ul className="my-bets-list pending-bets-panel__list">
               {rows.map((row) => (
                  <WalletBetCard
                     key={row.address}
                     row={row}
                     eventsByKey={eventsByKey}
                     promosByMarketKey={promosByMarketKey}
                     interactive
                     onChanged={() => {
                        void load();
                     }}
                  />
               ))}
            </ul>
         )}
      </aside>
      ) : null;

   if (tab != null && panel != null) {
      return (
         <div className="pending-bets-dock">
            {tab}
            {panel}
         </div>
      );
   }
   return tab ?? panel;
}
