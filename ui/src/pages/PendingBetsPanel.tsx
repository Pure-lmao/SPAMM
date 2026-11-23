import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { useCluster } from "@solana/connector/react";
import { useLocation } from "react-router-dom";
import { BetResult } from "spamm-aggregator-sdk";
import { resolveAppHttpRpcUrl } from "../betting/txPipeline";
import { useI18n } from "../i18n/useI18n";
import { fetchOpenWalletBets, walletBetRowResult, type WalletBetRow } from "../markets/fetchBetHistory";
import { useBetPresentation } from "../markets/useBetPresentation";
import { useAppWallet } from "../wallet/useAppWallet";
import { WalletBetCard } from "./MyBetsPage";

/** Matches the layout rule that makes room for this column beside the main page. */
const PANEL_MQ = "(min-width: 1620px)";

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
   const wide = useMediaQuery(PANEL_MQ);
   const { pathname } = useLocation();
   const shown = wide && pathname !== "/my-bets";
   const { account, isConnected } = useAppWallet();
   const { cluster } = useCluster();
   const { t } = useI18n();
   const clusterRpcUrl = useMemo(() => resolveAppHttpRpcUrl(cluster?.url), [cluster?.url]);
   const rpc = useMemo(() => createSolanaRpc(clusterRpcUrl) as Rpc<SolanaRpcApi>, [clusterRpcUrl]);
   const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
   const [err, setErr] = useState<string | null>(null);
   const [rows, setRows] = useState<readonly WalletBetRow[]>([]);

   const load = useCallback(async () => {
      if (!shown || !isConnected || !account) {
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
   }, [account, isConnected, rpc, shown]);

   useEffect(() => {
      void load();
   }, [load]);

   const { eventsByKey, promosByMarketKey } = useBetPresentation(rows);

   if (!shown || !isConnected || account == null) {
      return null;
   }

   return (
      <aside className="pending-bets-panel" aria-label={t("myBets.pendingPanel")}>
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
   );
}
