import { useMemo, type ReactNode } from "react";
import { AppProvider } from "@solana/connector/react";
import { getDefaultConfig, getDefaultMobileConfig } from "@solana/connector/headless";

function appOrigin(): string {
   if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
   }
   return "http://localhost:5173";
}

export function SolanaProviders({ children }: { children: ReactNode }) {
   const connectorConfig = useMemo(() => {
      const custom = import.meta.env.VITE_SOLANA_RPC_URL?.trim();
      const clusters = custom
         ? [
              {
                 id: "solana:devnet" as const,
                 label: "Devnet (custom RPC)",
                 url: custom,
              },
           ]
         : undefined;

      return getDefaultConfig({
         appName: "SPAMM",
         appUrl: appOrigin(),
         autoConnect: true,
         enableMobile: true,
         network: "devnet",
         clusters,
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

   return (
      <AppProvider connectorConfig={connectorConfig} mobile={mobile}>
         {children}
      </AppProvider>
   );
}
