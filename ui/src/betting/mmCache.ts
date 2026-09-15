import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { getMmListData, type MmListAccountData } from "spamm-aggregator-sdk";

const cachedByRpc = new Map<string, MmListAccountData>();

export async function getMmListCached(rpc: Rpc<SolanaRpcApi>, rpcUrl?: string): Promise<MmListAccountData> {
   const key = rpcUrl?.trim() || "default";
   const hit = cachedByRpc.get(key);
   if (hit != null) {
      return hit;
   }
   const data = await getMmListData(rpc);
   cachedByRpc.set(key, data);
   return data;
}
