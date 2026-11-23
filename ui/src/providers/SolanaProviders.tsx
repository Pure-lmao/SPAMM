import { useLayoutEffect, useMemo, type ReactNode } from "react";
import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { AppProvider } from "@solana/connector/react";
import { getDefaultConfig, getDefaultMobileConfig } from "@solana/connector/headless";
import { httpToWsRpcUrl } from "../betting/txPipeline";
import {
   APP_NETWORK,
   IS_DEVNET,
   SOLANA_CHAIN_ID,
   SOLANA_CLUSTER_LABEL,
   SOLANA_RPC_URL,
   solanaExplorerUrl,
} from "../network";
import { registerSpammEphemeralDevnetWallet } from "../wallet/ephemeralDevnetWallet";
import { PRIVY_LOGIN_METHODS } from "../wallet/privyLoginMethods";

const solanaConnectorKey = "__spammPrivySolanaConnectors";

function solanaConnectors() {
   const cached = (globalThis as Record<string, unknown>)[solanaConnectorKey];
   if (cached != null) {
      return cached as ReturnType<typeof toSolanaWalletConnectors>;
   }
   const created = toSolanaWalletConnectors({ shouldAutoConnect: false });
   (globalThis as Record<string, unknown>)[solanaConnectorKey] = created;
   return created;
}

function appOrigin(): string {
   if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
   }
   return "http://localhost:5173";
}

export function SolanaProviders({ children }: { children: ReactNode }) {
   useLayoutEffect(() => {
      if (!IS_DEVNET) {
         return;
      }
      return registerSpammEphemeralDevnetWallet();
   }, []);

   const connectorConfig = useMemo(() => {
      return getDefaultConfig({
         appName: "SPAMM",
         appUrl: appOrigin(),
         autoConnect: false,
         enableMobile: true,
         persistClusterSelection: false,
         network: APP_NETWORK,
         clusters: [
            {
               id: SOLANA_CHAIN_ID,
               label: SOLANA_CLUSTER_LABEL,
               url: SOLANA_RPC_URL,
            },
         ],
      });
   }, []);

   const mobile = useMemo(
      () =>
         getDefaultMobileConfig({
            appName: "SPAMM",
            appUrl: appOrigin(),
         }),
      [],
   );

   const privyConfig = useMemo((): PrivyClientConfig => {
      return {
         loginMethods: [...PRIVY_LOGIN_METHODS],
         appearance: {
            theme: "dark",
            accentColor: "#c9a84c",
            walletChainType: "solana-only",
            walletList: ["detected_solana_wallets", "phantom", "solflare", "backpack", "jupiter"],
         },
         externalWallets: {
            solana: {
               connectors: solanaConnectors(),
            },
         },
         embeddedWallets: {
            solana: {
               createOnLogin: "users-without-wallets",
            },
         },
         solana: {
            rpcs: {
               [SOLANA_CHAIN_ID]: {
                  rpc: createSolanaRpc(SOLANA_RPC_URL),
                  rpcSubscriptions: createSolanaRpcSubscriptions(httpToWsRpcUrl(SOLANA_RPC_URL)),
                  blockExplorerUrl: solanaExplorerUrl(),
               },
            },
         },
      };
   }, []);

   const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim() ?? "";

   return (
      <AppProvider connectorConfig={connectorConfig} mobile={mobile}>
         <PrivyProvider appId={appId} config={privyConfig}>
            {children}
         </PrivyProvider>
      </AppProvider>
   );
}
