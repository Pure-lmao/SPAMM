/// <reference types="vite/client" />

interface ImportMetaEnv {
   readonly VITE_NETWORK?: string;
   readonly VITE_SOLANA_RPC_URL?: string;
   readonly VITE_API_DOMAIN?: string;
   readonly VITE_LABS_DOMAIN?: string;
   readonly VITE_PRIVY_APP_ID?: string;
}

interface ImportMeta {
   readonly env: ImportMetaEnv;
}
