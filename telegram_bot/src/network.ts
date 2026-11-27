import { address, type Address } from "@solana/kit";
import { NETWORKS } from "./constants";
import { HELIUS_API_KEY, NETWORK } from "./env";

const profile = NETWORKS[NETWORK];

export const APP_NETWORK = NETWORK;
export const IS_DEVNET = NETWORK === "devnet";
export const API_DOMAIN = profile.api;
export const LABS_DOMAIN = profile.labs;
export const MINT: Address = address(profile.mint);
export const CAIP2 = profile.caip2;

export const RPC_URL =
   HELIUS_API_KEY === ""
      ? profile.rpcPublic
      : `https://${profile.heliusHost}/?api-key=${encodeURIComponent(HELIUS_API_KEY)}`;

export type Explorer = "solscan" | "solana" | "orb";

export function txUrl(explorer: Explorer, signature: string): string {
   const cluster = profile.solscanCluster === "" ? "" : `?cluster=${profile.solscanCluster}`;
   const base = explorer === "solana"
      ? "https://explorer.solana.com/tx/"
      : explorer === "orb"
         ? "https://orbmarkets.io/tx/"
         : "https://solscan.io/tx/";
   return `${base}${encodeURIComponent(signature)}${cluster}`;
}

export function httpToWs(httpUrl: string): string {
   if (httpUrl.startsWith("https://")) {
      return `wss://${httpUrl.slice("https://".length)}`;
   }
   if (httpUrl.startsWith("http://")) {
      return `ws://${httpUrl.slice("http://".length)}`;
   }
   return httpUrl;
}
