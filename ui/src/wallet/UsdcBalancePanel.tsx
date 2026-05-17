import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
   address,
   createSolanaRpc,
   createSolanaRpcSubscriptions,
   sendAndConfirmTransactionFactory,
   type Rpc,
   type SolanaRpcApi,
} from "@solana/kit";
import { useCluster, useKitTransactionSigner, useWallet } from "@solana/connector/react";
import { getWalletUsdcTokenBalance } from "spamm-aggregator-sdk";
import { formatUsdcBaseUnitsForUi, USDC_BASE_UNITS_PER_TOKEN } from "../betting/usdc";
import { buildSignV0Transaction, httpToWsRpcUrl, resolveHttpRpcUrl } from "../betting/txPipeline";
import { buildDevnetUsdcAirdropIx } from "./devnetUsdcAirdropIx";

const MIN_UI_USDC = 10n;
const MIN_BALANCE_BASE = MIN_UI_USDC * USDC_BASE_UNITS_PER_TOKEN;

/** 0.01 SOL in lamports. */
const MIN_SOL_LAMPORTS = 10_000_000n;

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
   const { signer, ready: signerReady } = useKitTransactionSigner();
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

   const [balanceBase, setBalanceBase] = useState<bigint | null>(null);
   const [solLamports, setSolLamports] = useState<bigint | null>(null);
   const [loadErr, setLoadErr] = useState<string | null>(null);
   const [usdcAirdropBusy, setUsdcAirdropBusy] = useState(false);
   const [usdcAirdropErr, setUsdcAirdropErr] = useState<string | null>(null);
   const [solAirdropBusy, setSolAirdropBusy] = useState(false);
   const [solAirdropErr, setSolAirdropErr] = useState<string | null>(null);
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

   const runUsdcAirdrop = useCallback(async () => {
      if (!isConnected || !account || !signer || !signerReady) {
         setUsdcAirdropErr("Connect a wallet first.");
         return;
      }
      setUsdcAirdropBusy(true);
      setUsdcAirdropErr(null);
      try {
         const userAddress = address(account);
         const ix = await buildDevnetUsdcAirdropIx(userAddress);
         const signed = await buildSignV0Transaction(rpc, {
            feePayer: signer,
            instructions: [ix],
            signers: [signer],
            useALT: false,
         });
         const sendAndConfirm = sendAndConfirmTransactionFactory({
            rpc,
            rpcSubscriptions,
         } as never);
         await sendAndConfirm(signed as never, { commitment: "confirmed" });
         await refresh();
      } catch (e) {
         setUsdcAirdropErr(e instanceof Error ? e.message : String(e));
      } finally {
         setUsdcAirdropBusy(false);
      }
   }, [account, isConnected, refresh, rpc, rpcSubscriptions, signer, signerReady]);

   const runSolAirdrop = useCallback(async () => {
      if (!isConnected || !account) {
         setSolAirdropErr("Connect a wallet first.");
         return;
      }
      setSolAirdropBusy(true);
      setSolAirdropErr(null);
      try {
         const user = String(address(account));
         const q = new URLSearchParams({ user });
         const res = await fetch(`/api/airdrop/sol?${q.toString()}`);
         const raw: unknown = await res.json().catch(() => null);
         if (!res.ok) {
            const msg =
               raw !== null &&
               typeof raw === "object" &&
               "error" in raw &&
               typeof (raw as { error: unknown }).error === "string"
                  ? (raw as { error: string }).error
                  : res.statusText || "SOL airdrop request failed";
            throw new Error(msg);
         }
         const parsed =
            raw !== null && typeof raw === "object" && "success" in raw
               ? (raw as { success: boolean; error?: string })
               : null;
         if (parsed === null || !parsed.success) {
            throw new Error(parsed?.error ?? "SOL airdrop failed");
         }
         await refresh();
      } catch (e) {
         setSolAirdropErr(e instanceof Error ? e.message : String(e));
      } finally {
         setSolAirdropBusy(false);
      }
   }, [account, isConnected, refresh]);

   if (!isConnected || !account) {
      return null;
   }

   const showUsdcAirdrop = balanceBase !== null && balanceBase < MIN_BALANCE_BASE;
   const showSolAirdrop = solLamports !== null && solLamports < MIN_SOL_LAMPORTS;

   return (
      <div className="usdc-balance-panel">
         <div className="usdc-balance-panel__stack">
            <div className="usdc-balance-panel__main">
               {showUsdcAirdrop && (
                  <button
                     type="button"
                     className="usdc-balance-panel__airdrop"
                     disabled={usdcAirdropBusy || !signerReady}
                     onClick={() => void runUsdcAirdrop()}
                  >
                     {usdcAirdropBusy ? "Airdropping…" : "Airdrop 100 USDC"}
                  </button>
               )}
               <div className="usdc-balance-panel__row">
                  <span className="usdc-balance-panel__label">USDC</span>
                  {balanceBase === null && loadErr == null && <span className="usdc-balance-panel__value">…</span>}
                  {balanceBase !== null && (
                     <span className="usdc-balance-panel__value">{formatUsdcBaseUnitsForUi(balanceBase)}</span>
                  )}
                  {loadErr != null && balanceBase === null && <span className="usdc-balance-panel__err" title={loadErr}>—</span>}
               </div>
            </div>
            <div className="usdc-balance-panel__main">
               {showSolAirdrop && (
                  <button
                     type="button"
                     className="usdc-balance-panel__airdrop"
                     disabled={solAirdropBusy}
                     onClick={() => void runSolAirdrop()}
                  >
                     {solAirdropBusy ? "Sending…" : "Airdrop SOL"}
                  </button>
               )}
               <div className="usdc-balance-panel__row">
                  <span className="usdc-balance-panel__label">SOL</span>
                  {solLamports === null && loadErr == null && <span className="usdc-balance-panel__value">…</span>}
                  {solLamports !== null && <span className="usdc-balance-panel__value">{formatSolFromLamports(solLamports)}</span>}
                  {loadErr != null && solLamports === null && <span className="usdc-balance-panel__err" title={loadErr}>—</span>}
               </div>
            </div>
         </div>
         {(solAirdropErr != null || usdcAirdropErr != null) && (
            <div className="usdc-balance-panel__errs">
               {solAirdropErr != null && (
                  <span className="usdc-balance-panel__airdrop-err" title={solAirdropErr}>
                     {solAirdropErr}
                  </span>
               )}
               {usdcAirdropErr != null && (
                  <span className="usdc-balance-panel__airdrop-err" title={usdcAirdropErr}>
                     {usdcAirdropErr}
                  </span>
               )}
            </div>
         )}
      </div>
   );
}
