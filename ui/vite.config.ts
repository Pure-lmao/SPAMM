import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sdkEntry = path.resolve(__dirname, "../aggregator/sdk/ts/src/index.ts");

const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
   resolve: {
      alias: {
         "spamm-aggregator-sdk": sdkEntry,
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
});
