import { BetResult } from "spamm-aggregator-sdk";

const apiDomain = import.meta.env.VITE_API_DOMAIN?.trim() ?? "";

export type SettleWithTxlineProofMeta = {
   fixtureId: string;
   seq: number;
   txlinePeriod: number;
   betPeriod: number;
   score: { home: number; away: number };
};

export type SettleWithTxlineBuildPayload = {
   expectedResult: BetResult.Won | BetResult.Lost;
   /** Base64-encoded TxLINE `validate_stat` anchor instruction. */
   validateStatIxData: string;
   computeUnitLimit: number;
   proof: SettleWithTxlineProofMeta;
};

export type SettleWithTxlineApiResponse = SettleWithTxlineBuildPayload | { error: string };

export function base64ToBytes(base64: string): Uint8Array {
   const bin = atob(base64);
   const out = new Uint8Array(bin.length);
   for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
   }
   return out;
}

export async function fetchSettleWithTxlineBuildPayload(
   betPda: string,
   signer: string,
): Promise<SettleWithTxlineBuildPayload> {
   const q = new URLSearchParams({ betPda, signer });
   const res = await fetch(`${apiDomain}/api/settleWithTxline?${q.toString()}`);
   const data = (await res.json()) as SettleWithTxlineApiResponse;
   if ("error" in data && data.error) {
      throw new Error(data.error);
   }
   if (!("validateStatIxData" in data) || !data.validateStatIxData) {
      throw new Error(`HTTP ${res.status}: missing settle build payload`);
   }
   return data;
}
