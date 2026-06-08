import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
   address,
   createSolanaRpc,
   type Rpc,
   type SolanaRpcApi,
} from "@solana/kit";
import { useCluster, useWallet } from "@solana/connector/react";
import { getWalletUsdcTokenBalance } from "spamm-aggregator-sdk";
import { formatUsdcBaseUnitsForUi } from "../betting/usdc";
import { resolveHttpRpcUrl } from "../betting/txPipeline";

const LAMPORTS_PER_SOL = 1_000_000_000n;
/** 0.0001 SOL — display precision is 4 decimal places. */
const LAMPORTS_PER_0001_SOL = 100_000n;

function formatSolFromLamports(lamports: bigint): string {
   const sign = lamports < 0n ? "-" : "";
   const v = lamports < 0n ? -lamports : lamports;
   const half = LAMPORTS_PER_0001_SOL / 2n;
   const rounded = ((v + half) / LAMPORTS_PER_0001_SOL) * LAMPORTS_PER_0001_SOL;
   const whole = rounded / LAMPORTS_PER_SOL;
   const fracLamports = rounded % LAMPORTS_PER_SOL;
   if (fracLamports === 0n) {
      return `${sign}${whole}`;
   }
   const dec = fracLamports / LAMPORTS_PER_0001_SOL;
   const fracStr = dec.toString().padStart(4, "0").replace(/0+$/, "");
   return `${sign}${whole}.${fracStr}`;
}

export function UsdcBalancePanel(): ReactElement | null {
   const { isConnected, account } = useWallet();
   const { cluster } = useCluster();

   const clusterRpcUrl = useMemo(() => {
      // MAINNET: VITE_SOLANA_RPC_URL — see ui/.env.production
      const env = typeof import.meta.env.VITE_SOLANA_RPC_URL === "string" ? import.meta.env.VITE_SOLANA_RPC_URL.trim() : "";
      const fromCluster = cluster?.url?.trim() ?? "";
      const raw = fromCluster !== "" ? fromCluster : env;
      return resolveHttpRpcUrl(raw !== "" ? raw : null);
   }, [cluster?.url]);

   const rpc = useMemo(() => createSolanaRpc(clusterRpcUrl) as Rpc<SolanaRpcApi>, [clusterRpcUrl]);

   const [balanceBase, setBalanceBase] = useState<bigint | null>(null);
   const [solLamports, setSolLamports] = useState<bigint | null>(null);
   const [loadErr, setLoadErr] = useState<string | null>(null);
   const cancelledRef = useRef(false);

   const refresh = useCallback(async () => {
      if (!isConnected || !account) {
         setBalanceBase(null);
         setSolLamports(null);
         setLoadErr(null);
         return;
      }
      setLoadErr(null);
      try {
         const userAddr = address(account);
         const [usdcBal, solBalRes] = await Promise.all([
            getWalletUsdcTokenBalance(rpc, userAddr),
            rpc.getBalance(userAddr).send(),
         ]);
         if (!cancelledRef.current) {
            setBalanceBase(usdcBal);
            setSolLamports(solBalRes.value);
         }
      } catch (e) {
         if (!cancelledRef.current) {
            setLoadErr(e instanceof Error ? e.message : String(e));
            setBalanceBase(null);
            setSolLamports(null);
         }
      }
   }, [account, isConnected, rpc]);

   useEffect(() => {
      cancelledRef.current = false;
      void refresh();
      return () => {
         cancelledRef.current = true;
      };
   }, [refresh]);

   if (!isConnected || !account) {
      return null;
   }

   return (
      <div className="usdc-balance-panel">
         <div className="usdc-balance-panel__stack">
            <div className="usdc-balance-panel__balance-grid" aria-label="Token balances">
               <span className="usdc-balance-panel__amount-cell" aria-label="USDC balance">
                  {balanceBase === null && loadErr == null && <span className="usdc-balance-panel__amount-dim">…</span>}
                  {balanceBase !== null && (
                     <span className="usdc-balance-panel__amount">{formatUsdcBaseUnitsForUi(balanceBase)}</span>
                  )}
                  {loadErr != null && balanceBase === null && (
                     <span className="usdc-balance-panel__err" title={loadErr}>
                        —
                     </span>
                  )}
               </span>
               <span className="usdc-balance-panel__suffix">USDC</span>
               <span className="usdc-balance-panel__amount-cell" aria-label="SOL balance">
                  {solLamports === null && loadErr == null && <span className="usdc-balance-panel__amount-dim">…</span>}
                  {solLamports !== null && (
                     <span className="usdc-balance-panel__amount">{formatSolFromLamports(solLamports)}</span>
                  )}
                  {loadErr != null && solLamports === null && (
                     <span className="usdc-balance-panel__err" title={loadErr}>
                        —
                     </span>
                  )}
               </span>
               <span className="usdc-balance-panel__suffix">SOL</span>
            </div>
         </div>
      </div>
   );
}
