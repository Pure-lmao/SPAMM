/** Cluster selected by the `NETWORK` env var (`devnet` or `mainnet`) at dev/build time. */

import { address } from "@solana/kit";

export type AppNetwork = "devnet" | "mainnet";

function readNetwork(): AppNetwork {
   const raw = import.meta.env.VITE_NETWORK?.trim().toLowerCase() ?? "";
   if (raw === "mainnet" || raw === "mainnet-beta") {
      return "mainnet";
   }
   return "devnet";
}

export const APP_NETWORK: AppNetwork = readNetwork();

export const IS_DEVNET = APP_NETWORK === "devnet";

/** Wallet Standard / Privy chain id for the active cluster. */
export const SOLANA_CHAIN_ID = IS_DEVNET ? "solana:devnet" : "solana:mainnet";

export const SOLANA_CLUSTER_LABEL = IS_DEVNET ? "Devnet" : "Mainnet";

const DEVNET_USDC_MINT = address("Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr");
const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const MINT = IS_DEVNET ? DEVNET_USDC_MINT : USDC_MINT;



/**
 * yano.markets — events and markets.
 * Devnet is `https://devapi.yano.markets`; mainnet is `https://api.yano.markets`.
 */
export const API_DOMAIN = import.meta.env.VITE_API_DOMAIN?.trim() ?? "";

/**
 * yanolabs.com — RFQ and bet history.
 * Devnet is `https://devapi.yanolabs.com`; mainnet is `https://api.yanolabs.com`.
 */
export const LABS_DOMAIN = import.meta.env.VITE_LABS_DOMAIN?.trim() ?? "";

/** HTTP RPC for the active cluster (Helius when configured, otherwise the public cluster RPC). */
export const SOLANA_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL?.trim() ?? "";

export const PUBLIC_SOLANA_RPC = IS_DEVNET
   ? "https://api.devnet.solana.com"
   : "https://api.mainnet-beta.solana.com";

/** Solscan query. Mainnet is the default cluster and has no `cluster` param. */
export function solscanClusterSuffix(): string {
   return IS_DEVNET ? "?cluster=devnet" : "";
}

export function solscanTxUrl(signature: string): string {
   return `https://solscan.io/tx/${encodeURIComponent(signature)}${solscanClusterSuffix()}`;
}

export function solscanAccountUrl(account: string): string {
   return `https://solscan.io/account/${encodeURIComponent(account)}${solscanClusterSuffix()}`;
}

/** Solana Explorer origin for the active cluster. */
export function solanaExplorerUrl(): string {
   return IS_DEVNET ? "https://explorer.solana.com/?cluster=devnet" : "https://explorer.solana.com";
}
