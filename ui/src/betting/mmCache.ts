import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { getMmListData, type MmListPdaData } from "spamm-aggregator-sdk";

let cached: MmListPdaData | null = null;

export async function getMmListCached(rpc: Rpc<SolanaRpcApi>): Promise<MmListPdaData> {
   if (cached) {
      return cached;
   }
   cached = await getMmListData(rpc);
   return cached;
}

export function clearMmListCache(): void {
   cached = null;
}
