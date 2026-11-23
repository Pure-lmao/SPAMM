import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sdkEntry = path.resolve(__dirname, "../aggregator/sdk/ts/src/index.ts");
const scorePredictSdkEntry = path.resolve(__dirname, "../score_predict/sdk/ts/src/index.ts");

const PUBLIC_RPC = {
   devnet: "https://api.devnet.solana.com",
   mainnet: "https://api.mainnet-beta.solana.com",
} as const;

type AppNetwork = keyof typeof PUBLIC_RPC;

function resolveAppNetwork(raw: string | undefined): AppNetwork {
   const value = (raw ?? "").trim().toLowerCase();
   if (value === "" || value === "devnet") {
      return "devnet";
   }
   if (value === "mainnet" || value === "mainnet-beta") {
      return "mainnet";
   }
   throw new Error(`NETWORK must be "devnet" or "mainnet" (got ${JSON.stringify(raw)})`);
}

function apiOrigin(network: AppNetwork, host: string): string {
   const prefix = network === "devnet" ? "devapi" : "api";
   return `https://${prefix}.${host}`;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
   for (const value of values) {
      const trimmed = value?.trim() ?? "";
      if (trimmed !== "") {
         return trimmed;
      }
   }
   return "";
}

export default defineConfig(({ mode }) => {
   const env = loadEnv(mode, __dirname, "");
   const network = resolveAppNetwork(env.NETWORK);
   const apiDomain = firstNonEmpty(env.API_DOMAIN) || apiOrigin(network, "yano.markets");
   const labsDomain = firstNonEmpty(env.LABS_DOMAIN) || apiOrigin(network, "yanolabs.com");
   const rpcKey = network === "devnet" ? "SOLANA_RPC_URL_DEVNET" : "SOLANA_RPC_URL_MAINNET";
   const rpcUrl = firstNonEmpty(env[rpcKey], env.SOLANA_RPC_URL) || PUBLIC_RPC[network];

   process.env.VITE_NETWORK = network;
   process.env.VITE_API_DOMAIN = apiDomain;
   process.env.VITE_LABS_DOMAIN = labsDomain;
   process.env.VITE_SOLANA_RPC_URL = rpcUrl;

   const apiTarget = firstNonEmpty(env.API_PROXY_TARGET) || "http://127.0.0.1:8787";

   console.log(`[ui] NETWORK=${network} API=${apiDomain}`);

   return {
      resolve: {
         alias: {
            "spamm-aggregator-sdk": sdkEntry,
            "spamm-score-predict-sdk": scorePredictSdkEntry,
         },
      },
      plugins: [react()],
      server: {
         proxy: {
            "/api": {
               target: apiTarget,
               changeOrigin: true,
            },
         },
      },
      define: {
         "import.meta.env.VITE_NETWORK": JSON.stringify(network),
         "import.meta.env.VITE_API_DOMAIN": JSON.stringify(apiDomain),
         "import.meta.env.VITE_LABS_DOMAIN": JSON.stringify(labsDomain),
         "import.meta.env.VITE_SOLANA_RPC_URL": JSON.stringify(rpcUrl),
      },
   };
});
