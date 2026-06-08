/// <reference types="vite/client" />

interface ImportMetaEnv {
   /** MAINNET: mainnet RPC HTTP URL — set in ui/.env or ui/.env.production */
   readonly VITE_SOLANA_RPC_URL?: string;
   readonly VITE_API_DOMAIN?: string;
}

interface ImportMeta {
   readonly env: ImportMetaEnv;
}
