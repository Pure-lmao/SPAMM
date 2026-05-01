import { getAddressEncoder, type Address } from '@solana/kit';
import type { Rpc } from '@solana/rpc-spec';
import type { SolanaRpcApi } from '@solana/rpc-api';
import type { Base64EncodedBytes, GetProgramAccountsMemcmpFilter } from '@solana/rpc-types';

import { AGGREGATOR_PROGRAM_ID } from './constants.js';
import {
   decodeBetAccountDataStrict,
   decodeConfigPdaData,
   decodeEventStateData,
   decodeMmEncumbrancePdaData,
   decodeMmListPdaData,
   decodeMmQuoteBuffer,
   decodeNettingPdaAccountData,
   getMarketIdEncoder,
} from './codex.js';
import {
   encodeEventIdWire,
   getBetPda,
   getConfigPda,
   getEventStatePda,
   getAta,
   getMmConfigPda,
   getMmEncumbrancePda,
   getMmListPda,
   getMmQuoteBufferPda,
   getNettingPda,
} from './helpers.js';
import {
   BET_ACCOUNT_DISCRIMINATOR,
   BET_ACCOUNT_LEN,
   type BetAccountData,
   type ConfigPdaData,
   type EventId,
   type EventStateData,
   type MarketId,
   type MmEncumbrancePdaData,
   type MmListPdaData,
   type MmQuoteBuffer,
   type NettingPdaAccountData,
} from './types.js';

const addressEncoder = getAddressEncoder();
const marketIdEncoder = getMarketIdEncoder();

const MAX_GET_PROGRAM_ACCOUNTS_FILTERS = 4;

/**
 * Byte offsets for on-chain `BetAccountDataZc` (`account_bet.rs` `to_zc`).
 * `1 + 1 + 32 + 32 + 8 + 27 + 1 + 8 + 8 + 2 + 32 + 1 = 153` bytes before fillers; `BET_RESULT_OFFSET` in Rust is 152.
 */
export const BET_ACCOUNT_WIRE_OFFSETS = {
   discriminator: 0,
   bump: 1,
   owner: 2,
   feepayer: 34,
   betId: 66,
   marketId: 74,
   side: 101,
   amount: 102,
   payout: 110,
   eventStateSequence: 118,
   eventStateHash: 120,
   result: 152,
   filler0: 153,
} as const;

export type ProgramAccountRaw = Readonly<{
   address: Address;
   data: Uint8Array;
}>;

function base64DataToUint8Array(data: readonly [string, string]): Uint8Array {
   const [b64] = data;
   const bin = atob(b64);
   const out = new Uint8Array(bin.length);
   for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
   }
   return out;
}

function bytesToBase64EncodedBytes(bytes: Uint8Array): Base64EncodedBytes {
   let binary = '';
   for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
   }
   return btoa(binary) as Base64EncodedBytes;
}

function u8WireByte(value: number): Uint8Array {
   return new Uint8Array([value & 0xff]);
}

function u64Le(value: bigint): Uint8Array {
   const out = new Uint8Array(8);
   new DataView(out.buffer).setBigUint64(0, value, true);
   return out;
}

function memcmp(offset: bigint, bytes: Uint8Array): GetProgramAccountsMemcmpFilter {
   return {
      memcmp: {
         offset,
         bytes: bytesToBase64EncodedBytes(bytes),
         encoding: 'base64',
      },
   };
}

type MemcmpSeg = Readonly<{ offset: number; bytes: Uint8Array }>;

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

function encodeMarketIdWire(marketId: MarketId): Uint8Array {
   return new Uint8Array(marketIdEncoder.encode(marketId));
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
 * SPL token account balance via RPC `getTokenAccountBalance` (fractional units as `bigint`).
 */
export async function getTokenAccountBalance(rpc: Rpc<SolanaRpcApi>, account: Address): Promise<bigint> {
   const res = await rpc.getTokenAccountBalance(account).send();
   return BigInt(res.value.amount);
}

/**
 * Liability vault ATA balance for an MM program (ATA owner = MM encumbrance PDA on the aggregator).
 * Same ATA derivation as `getWithdrawFromLiabilityAccountIx` / `settleFillerAccountRow` in `instructions.ts`.
 */
export async function getMmLiabilityAtaBalance(rpc: Rpc<SolanaRpcApi>, mmProgramId: Address): Promise<bigint> {
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgramId);
   const liabilityAta = await getAta(mmEncumbrancePda);
   return getTokenAccountBalance(rpc, liabilityAta);
}

/**
 * MM collateral token ATA balance (ATA owner = MM config PDA on the MM program).
 */
export async function getMmTokenAtaBalance(rpc: Rpc<SolanaRpcApi>, mmProgramId: Address): Promise<bigint> {
   const [mmConfigPda] = await getMmConfigPda(mmProgramId);
   const mmTokenAta = await getAta(mmConfigPda);
   return getTokenAccountBalance(rpc, mmTokenAta);
}

export async function getMmListData(rpc: Rpc<SolanaRpcApi>): Promise<MmListPdaData> {
   const [addr] = await getMmListPda();
   const raw = await readAccountDataRaw(rpc, addr);
   if (raw === null) {
      throw new Error('MM list account not found');
   }
   return decodeMmListPdaData(raw);
}

/** Alias for {@link getMmListData} (preferred spelling in docs). */
export const getMMListData = getMmListData;

export async function getAggregatorConfigData(rpc: Rpc<SolanaRpcApi>): Promise<ConfigPdaData> {
   const [addr] = await getConfigPda();
   const raw = await readAccountDataRaw(rpc, addr);
   if (raw === null) {
      throw new Error('Aggregator config account not found');
   }
   return decodeConfigPdaData(raw);
}

export type GetBetsDataFilters = Readonly<{
   user?: Address;
   feepayer?: Address;
   amount?: bigint;
   betId?: bigint;
   eventId?: EventId;
   marketId?: MarketId;
}>;

/**
 * Bet PDA accounts under {@link AGGREGATOR_PROGRAM_ID}, filtered by discriminator and fixed size.
 * Optional `memcmp` filters are merged when their byte ranges are adjacent (e.g. `user` + `feepayer`, or
 * `betId` + `marketId`), staying within Solana's filter limit ({@link MAX_GET_PROGRAM_ACCOUNTS_FILTERS} total).
 */
export async function getBetsData(
   rpc: Rpc<SolanaRpcApi>,
   optional?: GetBetsDataFilters,
): Promise<ReadonlyArray<Readonly<{ address: Address; data: BetAccountData }>>> {
   const filters: (GetProgramAccountsMemcmpFilter | { readonly dataSize: bigint })[] = [
      { dataSize: BigInt(BET_ACCOUNT_LEN) },
      memcmp(BigInt(BET_ACCOUNT_WIRE_OFFSETS.discriminator), u8WireByte(BET_ACCOUNT_DISCRIMINATOR)),
   ];

   const segments: MemcmpSeg[] = [];
   if (optional?.marketId !== undefined) {
      segments.push({
         offset: BET_ACCOUNT_WIRE_OFFSETS.marketId,
         bytes: encodeMarketIdWire(optional.marketId),
      });
   } else if (optional?.eventId !== undefined) {
      segments.push({
         offset: BET_ACCOUNT_WIRE_OFFSETS.marketId,
         bytes: encodeEventIdWire(optional.eventId),
      });
   }
   if (optional?.user !== undefined) {
      segments.push({
         offset: BET_ACCOUNT_WIRE_OFFSETS.owner,
         bytes: new Uint8Array(addressEncoder.encode(optional.user)),
      });
   }
   if (optional?.feepayer !== undefined) {
      segments.push({
         offset: BET_ACCOUNT_WIRE_OFFSETS.feepayer,
         bytes: new Uint8Array(addressEncoder.encode(optional.feepayer)),
      });
   }
   if (optional?.betId !== undefined) {
      segments.push({ offset: BET_ACCOUNT_WIRE_OFFSETS.betId, bytes: u64Le(optional.betId) });
   }
   if (optional?.amount !== undefined) {
      segments.push({ offset: BET_ACCOUNT_WIRE_OFFSETS.amount, bytes: u64Le(optional.amount) });
   }

   const merged = mergeAdjacentMemcmpSegments(segments);
   for (const m of merged) {
      if (filters.length >= MAX_GET_PROGRAM_ACCOUNTS_FILTERS) {
         throw new RangeError(
            `getBetsData: at most ${MAX_GET_PROGRAM_ACCOUNTS_FILTERS} filters after merging (use readProgramAccountsRaw for custom filter sets)`,
         );
      }
      filters.push(memcmp(BigInt(m.offset), m.bytes));
   }

   const rows = await readProgramAccountsRaw(rpc, AGGREGATOR_PROGRAM_ID, filters);
   return rows.map((row) => ({
      address: row.address,
      data: decodeBetAccountDataStrict(row.data),
   }));
}

export type GetBetDataKey = Address | Readonly<{ user: Address; betId: bigint }>;

function isBetPdaKey(key: GetBetDataKey): key is Readonly<{ user: Address; betId: bigint }> {
   return typeof key === 'object' && key !== null && 'user' in key && 'betId' in key;
}

/**
 * Loads one bet account by PDA address, or by `(user, betId)` via {@link getBetPda}.
 */
export async function getBetData(rpc: Rpc<SolanaRpcApi>, key: GetBetDataKey): Promise<BetAccountData> {
   const address = isBetPdaKey(key) ? (await getBetPda(key.user, key.betId))[0] : key;
   const raw = await readAccountDataRaw(rpc, address);
   if (raw === null) {
      throw new Error(`Bet account not found: ${String(address)}`);
   }
   return decodeBetAccountDataStrict(raw);
}

export async function getNettingAccountData(
   rpc: Rpc<SolanaRpcApi>,
   mmProgramId: Address,
   eventId: EventId,
): Promise<NettingPdaAccountData> {
   const [addr] = await getNettingPda(mmProgramId, eventId);
   const raw = await readAccountDataRaw(rpc, addr);
   if (raw === null) {
      throw new Error('Netting account not found');
   }
   return decodeNettingPdaAccountData(raw);
}

export async function getEventStateData(
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

export async function getMmEncumbranceData(
   rpc: Rpc<SolanaRpcApi>,
   mmProgramId: Address,
): Promise<MmEncumbrancePdaData> {
   const [addr] = await getMmEncumbrancePda(mmProgramId);
   const raw = await readAccountDataRaw(rpc, addr);
   if (raw === null) {
      throw new Error('MM encumbrance account not found');
   }
   return decodeMmEncumbrancePdaData(raw);
}

export async function getMmQuoteBufferData(rpc: Rpc<SolanaRpcApi>, mmProgramId: Address): Promise<MmQuoteBuffer> {
   const [addr] = await getMmQuoteBufferPda(mmProgramId);
   const raw = await readAccountDataRaw(rpc, addr);
   if (raw === null) {
      throw new Error('MM quote buffer account not found');
   }
   return decodeMmQuoteBuffer(raw);
}
