/** Tuning and cluster tables. Secrets and `NETWORK` stay in the environment. */

export type AppNetwork = "devnet" | "mainnet";

export type NetworkProfile = {
   api: string;
   labs: string;
   rpcPublic: string;
   heliusHost: string;
   mint: string;
   caip2: string;
   /** Empty on mainnet. Devnet Solscan uses `?cluster=devnet`. */
   solscanCluster: string;
};

export const NETWORKS: Record<AppNetwork, NetworkProfile> = {
   devnet: {
      api: "https://devapi.yano.markets",
      labs: "https://devapi.yanolabs.com",
      rpcPublic: "https://api.devnet.solana.com",
      heliusHost: "devnet.helius-rpc.com",
      mint: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
      caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      solscanCluster: "devnet",
   },
   mainnet: {
      api: "https://api.yano.markets",
      labs: "https://api.yanolabs.com",
      rpcPublic: "https://api.mainnet-beta.solana.com",
      heliusHost: "mainnet.helius-rpc.com",
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      solscanCluster: "",
   },
};

/** Same program as the UI devnet USDC faucet. Hidden on mainnet. */
export const DEVNET_USDC_AIRDROP_PROGRAM = "4sN8PnN2ki2W4TFXAfzR645FWs8nimmsYeNtxM8RBK6A";

/** One shared slate for every user. Events do not move often enough to refetch sooner. */
export const SLATE_TTL_MS = 5 * 60_000;
export const LABELS_TTL_MS = 5 * 60_000;
export const MM_LIST_TTL_MS = 5 * 60_000;
export const HISTORY_TTL_MS = 15_000;
export const VOUCHER_TTL_MS = 20_000;

export const PAGE_SIZE = 8;
export const HISTORY_PAGE = 10;
export const SETTLE_BATCH = 9;

/** Whole-USDC buttons on the stake step. */
export const STAKE_PRESETS = [5, 10, 25, 50] as const;

/** Wallets below this lamport balance use the labs sol-free signer. */
export const SOL_FREE_MIN_LAMPORTS = 10_000_000n;

/** Give up on a labs sol-free request after this long so the chat is not stuck. */
export const SOLFREE_TIMEOUT_MS = 20_000;

export const USDC_DECIMALS = 6;
