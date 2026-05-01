import type { Address } from '@solana/kit';
import type { Rpc } from '@solana/rpc-spec';
import type { SolanaRpcApi } from '@solana/rpc-api';
import type { GetProgramAccountsMemcmpFilter } from '@solana/rpc-types';

import {
   decodeEventStateData,
   decodeMmAccountConfig,
   decodeMmOracleMarketData,
   decodeMmQuoteBuffer,
} from './codex.js';
import { getEventStatePda, getMmConfigPda, getMmMarketDataPda, getMmQuoteBufferPda } from './helpers.js';
import type { EventId, EventStateData, MarketId, MmAccountConfig, MmOracleMarketData, MmQuoteBuffer } from './types.js';

export type ProgramAccountRaw = Readonly<{
   address: Address;
   data: Uint8Array;
}>;

export type MemcmpSeg = Readonly<{ offset: number; bytes: Uint8Array }>;

/**
 * Combines non-overlapping memcmp segments that are flush in account memory (end of A === start of B)
 * into a single filter, reducing RPC filter count.
 */
export function mergeAdjacentMemcmpSegments(segments: MemcmpSeg[]): MemcmpSeg[] {
   if (segments.length === 0) {
      return [];
   }
   const sorted = segments.sort((a, b) => a.offset - b.offset);
   const out: MemcmpSeg[] = [];
   let cur: MemcmpSeg = sorted[0]!;

   for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i]!;
      const end = cur.offset + cur.bytes.length;
      if (next.offset === end) {
         const merged = new Uint8Array(cur.bytes.length + next.bytes.length);
         merged.set(cur.bytes, 0);
         merged.set(next.bytes, cur.bytes.length);
         cur = { offset: cur.offset, bytes: merged };
      } else if (next.offset < end) {
         throw new RangeError('mergeAdjacentMemcmpSegments: overlapping filter byte ranges');
      } else {
         out.push(cur);
         cur = { offset: next.offset, bytes: next.bytes.slice() };
      }
   }
   out.push(cur);
   return out;
}

function base64DataToUint8Array(data: readonly [string, string]): Uint8Array {
   const [b64] = data;
   const bin = atob(b64);
   const out = new Uint8Array(bin.length);
   for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
   }
   return out;
}

/**
 * Fetches all program-owned accounts with `encoding: 'base64'` and maps each to `{ address, data }`.
 */
export async function readProgramAccountsRaw(
   rpc: Rpc<SolanaRpcApi>,
   program: Address,
   filters: readonly (GetProgramAccountsMemcmpFilter | { readonly dataSize: bigint })[],
): Promise<ProgramAccountRaw[]> {
   const accounts = await rpc.getProgramAccounts(program, { encoding: 'base64', filters }).send();
   return accounts.map((a) => ({
      address: a.pubkey,
      data: base64DataToUint8Array(a.account.data),
   }));
}

/**
 * Fetches a single account with `encoding: 'base64'` and returns raw data, or `null` if missing.
 */
export async function readAccountDataRaw(rpc: Rpc<SolanaRpcApi>, address: Address): Promise<Uint8Array | null> {
   const res = await rpc.getAccountInfo(address, { encoding: 'base64' }).send();
   if (res.value === null) {
      return null;
   }
   return base64DataToUint8Array(res.value.data);
}

/**
 * SPL token account balance via `getTokenAccountBalance` (fractional units as `bigint`).
 */
export async function readTokenAccountBalance(rpc: Rpc<SolanaRpcApi>, tokenAccount: Address): Promise<bigint> {
   const res = await rpc.getTokenAccountBalance(tokenAccount).send();
   return BigInt(res.value.amount);
}

export async function getMmConfigData(rpc: Rpc<SolanaRpcApi>, mmProgramId: Address): Promise<MmAccountConfig> {
   const [addr] = await getMmConfigPda(mmProgramId);
   const raw = await readAccountDataRaw(rpc, addr);
   if (raw === null) {
      throw new Error('MM config account not found');
   }
   return decodeMmAccountConfig(raw);
}

export async function getMmQuoteBufferData(rpc: Rpc<SolanaRpcApi>, mmProgramId: Address): Promise<MmQuoteBuffer> {
   const [addr] = await getMmQuoteBufferPda(mmProgramId);
   const raw = await readAccountDataRaw(rpc, addr);
   if (raw === null) {
      throw new Error('MM quote buffer account not found');
   }
   return decodeMmQuoteBuffer(raw);
}

export async function getMmEventStateData(
   rpc: Rpc<SolanaRpcApi>,
   mmProgramId: Address,
   eventId: EventId,
): Promise<EventStateData> {
   const [addr] = await getEventStatePda(mmProgramId, eventId);
   const raw = await readAccountDataRaw(rpc, addr);
   if (raw === null) {
      throw new Error('Event state account not found');
   }
   return decodeEventStateData(raw);
}

export async function getMmMarketData(
   rpc: Rpc<SolanaRpcApi>,
   mmProgramId: Address,
   marketId: MarketId,
): Promise<MmOracleMarketData> {
   const [addr] = await getMmMarketDataPda(mmProgramId, marketId);
   const raw = await readAccountDataRaw(rpc, addr);
   console.log(raw)
   if (raw === null) {
      throw new Error('MM market data account not found');
   }
   return decodeMmOracleMarketData(raw);
}
