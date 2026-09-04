import { getAddressEncoder, type Address } from '@solana/kit';
import type { Rpc } from '@solana/rpc-spec';
import type { SolanaRpcApi } from '@solana/rpc-api';
import type { Base64EncodedBytes, GetProgramAccountsMemcmpFilter } from '@solana/rpc-types';

import { ADDRESS_LEN, AGGREGATOR_PROGRAM_ID, U32_LEN, U64_LEN } from './constants.js';
import {
   decodeBetAccountDataStrict,
   decodeCashoutAccountDataStrict,
   decodeCashoutEscrow,
   decodeCashoutParlayAccountDataStrict,
   decodeConfigPdaData,
   decodeEventStateData,
   decodeFreebetAccountData,
   decodeFreebetIssuer,
   decodeMmAccountConfig,
   decodeMmEncumbrancePdaData,
   decodeMmListPdaData,
   decodeMmParlayQuoteBuffer,
   decodeMmQuoteBuffer,
   decodeNettingPdaAccountData,
   decodeParlayBetAccountDataStrict,
   getMarketIdEncoder,
} from './codex.js';
import {
   encodeEventIdWire,
   getBetPda,
   getCashoutEscrowPda,
   getCashoutPda,
   getCashoutParlayPda,
   getConfigPda,
   getEventStatePda,
   getFreebetIssuerPda,
   getFreebetPda,
   getAta,
   getMmConfigPda,
   getMmEncumbrancePda,
   getMmListPda,
   getMmParlayQuoteBufferPda,
   getMmQuoteBufferPda,
   getNettingPda,
   getParlayBetPda,
} from './helpers.js';
import {
   BET_ACCOUNT_DISCRIMINATOR,
   CASHOUT_ACCOUNT_DISCRIMINATOR,
   CASHOUT_ESCROW_DISCRIMINATOR,
   CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR,
   EVENT_GAME_STATE_LEN,
   MARKET_ID_WIRE_SIZE,
   PARLAY_BET_ACCOUNT_DISCRIMINATOR,
   type BetAccountData,
   type CashoutAccountData,
   type CashoutEscrow,
   type CashoutParlayAccountData,
   type ConfigPdaData,
   type EventId,
   type EventStateData,
   type FreebetAccountData,
   type FreebetIssuer,
   type MarketId,
   type MmAccountConfig,
   type MmEncumbrancePdaData,
   type MmListPdaData,
   type MmParlayQuoteBuffer,
   type MmQuoteBuffer,
   type NettingPdaAccountData,
   type ParlayBetAccountData,
} from './types.js';

const addressEncoder = getAddressEncoder();
const marketIdEncoder = getMarketIdEncoder();

const MAX_GET_PROGRAM_ACCOUNTS_FILTERS = 4;

function packedOffsets<T extends Record<string, number>>(build: (add: (len: number) => number) => T): T {
   let o = 0;
   return build((len) => {
      const start = o;
      o += len;
      return start;
   });
}

/**
 * Byte offsets for on-chain `BetAccountHeader` (`account_bet.rs`, zeropod alignment-1 packed).
 * `result` matches Rust `BET_RESULT_OFFSET`.
 */
export const BET_ACCOUNT_WIRE_OFFSETS = packedOffsets((add) => ({
   discriminator: add(1),
   bump: add(1),
   owner: add(ADDRESS_LEN),
   feepayer: add(ADDRESS_LEN),
   betId: add(U64_LEN),
   marketId: add(MARKET_ID_WIRE_SIZE),
   side: add(1),
   amount: add(U64_LEN),
   payout: add(U64_LEN),
   timestamp: add(U32_LEN),
   freebetId: add(U32_LEN),
   eventStateSequence: add(2),
   eventGameState: add(EVENT_GAME_STATE_LEN),
   result: add(1),
   numFillers: add(1),
   fillers: add(0),
} as const));

/**
 * Byte offsets for on-chain `ParlayBetAccountData` (`account_parlay_bet.rs`, zeropod alignment-1 packed).
 * `result` matches Rust `PARLAY_BET_RESULT_OFFSET`.
 */
export const PARLAY_BET_ACCOUNT_WIRE_OFFSETS = packedOffsets((add) => ({
   discriminator: add(1),
   bump: add(1),
   owner: add(ADDRESS_LEN),
   feepayer: add(ADDRESS_LEN),
   betId: add(U64_LEN),
   amount: add(U64_LEN),
   payout: add(U64_LEN),
   timestamp: add(U32_LEN),
   freebetId: add(U32_LEN),
   fillerAddress: add(ADDRESS_LEN),
   result: add(1),
   numLegs: add(1),
   legs: add(0),
} as const));

/**
 * Byte offsets for on-chain `FreebetIssuer` (`account_freebet_issuer.rs`).
 */
export const FREEBET_ISSUER_WIRE_OFFSETS = packedOffsets((add) => ({
   discriminator: add(1),
   bump: add(1),
   auth: add(ADDRESS_LEN),
   openCount: add(U32_LEN),
} as const));

/**
 * Byte offsets for on-chain `FreebetAccountHeader` (`account_freebet.rs`, packed ZeroPod).
 * Allowed MM addresses follow at {@link FREEBET_ACCOUNT_HEADER_LEN}.
 * Allowed operator addresses follow the MM list (`freebetAllowedOperatorsOffset(numMms)`).
 */
export const FREEBET_ACCOUNT_WIRE_OFFSETS = packedOffsets((add) => ({
   discriminator: add(1),
   bump: add(1),
   state: add(1),
   numMms: add(1),
   minLegs: add(1),
   numOperators: add(1),
   freebetId: add(U32_LEN),
   expiry: add(U32_LEN),
   minOddsScaled: add(U32_LEN),
   maxOddsScaled: add(U32_LEN),
   amount: add(U64_LEN),
   issuerAuth: add(ADDRESS_LEN),
   user: add(ADDRESS_LEN),
   allowedMms: add(0),
} as const));

/**
 * Byte offsets for on-chain `CashoutEscrow` (`account_cashout_escrow.rs`).
 */
export const CASHOUT_ESCROW_WIRE_OFFSETS = packedOffsets((add) => ({
   discriminator: add(1),
   bump: add(1),
   owner: add(ADDRESS_LEN),
   feepayer: add(ADDRESS_LEN),
   origBetId: add(U64_LEN),
   cashoutId: add(U64_LEN),
   timestamp: add(U32_LEN),
   amount: add(U64_LEN),
   payoutRemoved: add(U64_LEN),
   payment: add(U64_LEN),
   marketMaker: add(ADDRESS_LEN),
   isParlay: add(1),
} as const));

/**
 * Byte offsets for on-chain `CashoutAccountHeader` (`account_cashout.rs`, packed ZeroPod).
 * Fillers follow at {@link CASHOUT_ACCOUNT_HEADER_LEN}.
 */
export const CASHOUT_ACCOUNT_WIRE_OFFSETS = packedOffsets((add) => ({
   discriminator: add(1),
   bump: add(1),
   mm: add(ADDRESS_LEN),
   feepayer: add(ADDRESS_LEN),
   origOwner: add(ADDRESS_LEN),
   origBetId: add(U64_LEN),
   cashoutId: add(U64_LEN),
   marketId: add(MARKET_ID_WIRE_SIZE),
   side: add(1),
   amount: add(U64_LEN),
   payout: add(U64_LEN),
   timestamp: add(U32_LEN),
   origEventStateSequence: add(2),
   origEventGameState: add(EVENT_GAME_STATE_LEN),
   cashoutEventStateSequence: add(2),
   cashoutEventGameState: add(EVENT_GAME_STATE_LEN),
   result: add(1),
   numFillers: add(1),
   fillers: add(0),
} as const));

/**
 * Byte offsets for on-chain `CashoutParlayHeader` (`account_cashout_parlay.rs`, packed ZeroPod).
 * Legs follow at {@link CASHOUT_PARLAY_HEADER_LEN}.
 */
export const CASHOUT_PARLAY_ACCOUNT_WIRE_OFFSETS = packedOffsets((add) => ({
   discriminator: add(1),
   bump: add(1),
   mm: add(ADDRESS_LEN),
   feepayer: add(ADDRESS_LEN),
   origOwner: add(ADDRESS_LEN),
   origBetId: add(U64_LEN),
   cashoutId: add(U64_LEN),
   amount: add(U64_LEN),
   payout: add(U64_LEN),
   timestamp: add(U32_LEN),
   result: add(1),
   originalFillerAddress: add(ADDRESS_LEN),
   numLegs: add(1),
   legs: add(0),
} as const));

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
   const out = new Uint8Array(U64_LEN);
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
 * User wallet USDC balance (default {@link MINT_ID} ATA). Returns `0n` if the ATA is missing or RPC errors.
 */
export async function getWalletUsdcTokenBalance(rpc: Rpc<SolanaRpcApi>, owner: Address): Promise<bigint> {
   const ata = await getAta(owner);
   try {
      return await getTokenAccountBalance(rpc, ata);
   } catch {
      return 0n;
   }
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

export async function getAggregatorConfigData(rpc: Rpc<SolanaRpcApi>): Promise<ConfigPdaData> {
   const [addr] = await getConfigPda();
   const raw = await readAccountDataRaw(rpc, addr);
   if (raw === null) {
      throw new Error('Aggregator config account not found');
   }
   return decodeConfigPdaData(raw);
}

/** MM program `["config"]` PDA — includes `rfqSigner` used for RFQ ed25519 verify. */
export async function getMmAccountConfigData(
   rpc: Rpc<SolanaRpcApi>,
   mmProgramId: Address,
): Promise<MmAccountConfig> {
   const [addr] = await getMmConfigPda(mmProgramId);
   const raw = await readAccountDataRaw(rpc, addr);
   if (raw === null) {
      throw new Error(`MM account config not found for ${mmProgramId}`);
   }
   return decodeMmAccountConfig(raw);
}

export type GetBetsDataFilters = Readonly<{
   user?: Address;
   feepayer?: Address;
   amount?: bigint;
   betId?: bigint;
   eventId?: EventId;
   marketId?: MarketId;
   result?: BetAccountData['result'];
}>;

/**
 * Bet PDA accounts under {@link AGGREGATOR_PROGRAM_ID}, filtered by discriminator only (variable account size).
 * Optional `memcmp` filters are merged when their byte ranges are adjacent (e.g. `user` + `feepayer`, or
 * `betId` + `marketId`), staying within Solana's filter limit ({@link MAX_GET_PROGRAM_ACCOUNTS_FILTERS} total).
 */
export async function getBetsData(
   rpc: Rpc<SolanaRpcApi>,
   optional?: GetBetsDataFilters,
): Promise<ReadonlyArray<Readonly<{ address: Address; data: BetAccountData }>>> {
   const filters: (GetProgramAccountsMemcmpFilter | { readonly dataSize: bigint })[] = [
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
   if (optional?.result !== undefined) {
      segments.push({ offset: BET_ACCOUNT_WIRE_OFFSETS.result, bytes: u8WireByte(optional.result) });
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

export type GetParlaysDataFilters = Readonly<{
   user?: Address;
   feepayer?: Address;
   amount?: bigint;
   betId?: bigint;
   result?: ParlayBetAccountData['result'];
}>;

/**
 * Parlay bet PDA accounts under {@link AGGREGATOR_PROGRAM_ID}, filtered by discriminator only (variable account size).
 */
export async function getParlaysData(
   rpc: Rpc<SolanaRpcApi>,
   optional?: GetParlaysDataFilters,
): Promise<ReadonlyArray<Readonly<{ address: Address; data: ParlayBetAccountData }>>> {
   const filters: (GetProgramAccountsMemcmpFilter | { readonly dataSize: bigint })[] = [
      memcmp(BigInt(PARLAY_BET_ACCOUNT_WIRE_OFFSETS.discriminator), u8WireByte(PARLAY_BET_ACCOUNT_DISCRIMINATOR)),
   ];

   const segments: MemcmpSeg[] = [];
   if (optional?.user !== undefined) {
      segments.push({
         offset: PARLAY_BET_ACCOUNT_WIRE_OFFSETS.owner,
         bytes: new Uint8Array(addressEncoder.encode(optional.user)),
      });
   }
   if (optional?.feepayer !== undefined) {
      segments.push({
         offset: PARLAY_BET_ACCOUNT_WIRE_OFFSETS.feepayer,
         bytes: new Uint8Array(addressEncoder.encode(optional.feepayer)),
      });
   }
   if (optional?.betId !== undefined) {
      segments.push({ offset: PARLAY_BET_ACCOUNT_WIRE_OFFSETS.betId, bytes: u64Le(optional.betId) });
   }
   if (optional?.amount !== undefined) {
      segments.push({ offset: PARLAY_BET_ACCOUNT_WIRE_OFFSETS.amount, bytes: u64Le(optional.amount) });
   }
   if (optional?.result !== undefined) {
      segments.push({ offset: PARLAY_BET_ACCOUNT_WIRE_OFFSETS.result, bytes: u8WireByte(optional.result) });
   }

   const merged = mergeAdjacentMemcmpSegments(segments);
   for (const m of merged) {
      if (filters.length >= MAX_GET_PROGRAM_ACCOUNTS_FILTERS) {
         throw new RangeError(
            `getParlaysData: at most ${MAX_GET_PROGRAM_ACCOUNTS_FILTERS} filters after merging (use readProgramAccountsRaw for custom filter sets)`,
         );
      }
      filters.push(memcmp(BigInt(m.offset), m.bytes));
   }

   const rows = await readProgramAccountsRaw(rpc, AGGREGATOR_PROGRAM_ID, filters);
   return rows.map((row) => ({
      address: row.address,
      data: decodeParlayBetAccountDataStrict(row.data),
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

/**
 * Loads one parlay bet PDA by address, or by `(user, betId)` via {@link getParlayBetPda}.
 */
export async function getParlayData(rpc: Rpc<SolanaRpcApi>, key: GetBetDataKey): Promise<ParlayBetAccountData> {
   const address = isBetPdaKey(key) ? (await getParlayBetPda(key.user, key.betId))[0] : key;
   const raw = await readAccountDataRaw(rpc, address);
   if (raw === null) {
      throw new Error(`Parlay account not found: ${String(address)}`);
   }
   return decodeParlayBetAccountDataStrict(raw);
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

export async function getMmParlayQuoteBufferData(
   rpc: Rpc<SolanaRpcApi>,
   mmProgramId: Address,
): Promise<MmParlayQuoteBuffer> {
   const [addr] = await getMmParlayQuoteBufferPda(mmProgramId);
   const raw = await readAccountDataRaw(rpc, addr);
   if (raw === null) {
      throw new Error('MM parlay quote buffer account not found');
   }
   return decodeMmParlayQuoteBuffer(raw);
}

export type GetCashoutEscrowsDataFilters = Readonly<{
   owner?: Address;
   feepayer?: Address;
   origBetId?: bigint;
   cashoutId?: bigint;
   marketMaker?: Address;
   isParlay?: boolean;
}>;

/** Cashout escrow PDAs under {@link AGGREGATOR_PROGRAM_ID}. */
export async function getCashoutEscrowsData(
   rpc: Rpc<SolanaRpcApi>,
   optional?: GetCashoutEscrowsDataFilters,
): Promise<ReadonlyArray<Readonly<{ address: Address; data: CashoutEscrow }>>> {
   const filters: (GetProgramAccountsMemcmpFilter | { readonly dataSize: bigint })[] = [
      memcmp(BigInt(CASHOUT_ESCROW_WIRE_OFFSETS.discriminator), u8WireByte(CASHOUT_ESCROW_DISCRIMINATOR)),
   ];
   const segments: MemcmpSeg[] = [];
   if (optional?.owner !== undefined) {
      segments.push({
         offset: CASHOUT_ESCROW_WIRE_OFFSETS.owner,
         bytes: new Uint8Array(addressEncoder.encode(optional.owner)),
      });
   }
   if (optional?.feepayer !== undefined) {
      segments.push({
         offset: CASHOUT_ESCROW_WIRE_OFFSETS.feepayer,
         bytes: new Uint8Array(addressEncoder.encode(optional.feepayer)),
      });
   }
   if (optional?.origBetId !== undefined) {
      segments.push({ offset: CASHOUT_ESCROW_WIRE_OFFSETS.origBetId, bytes: u64Le(optional.origBetId) });
   }
   if (optional?.cashoutId !== undefined) {
      segments.push({ offset: CASHOUT_ESCROW_WIRE_OFFSETS.cashoutId, bytes: u64Le(optional.cashoutId) });
   }
   if (optional?.marketMaker !== undefined) {
      segments.push({
         offset: CASHOUT_ESCROW_WIRE_OFFSETS.marketMaker,
         bytes: new Uint8Array(addressEncoder.encode(optional.marketMaker)),
      });
   }
   if (optional?.isParlay !== undefined) {
      segments.push({
         offset: CASHOUT_ESCROW_WIRE_OFFSETS.isParlay,
         bytes: u8WireByte(optional.isParlay ? 1 : 0),
      });
   }
   const merged = mergeAdjacentMemcmpSegments(segments);
   for (const m of merged) {
      if (filters.length >= MAX_GET_PROGRAM_ACCOUNTS_FILTERS) {
         throw new RangeError(
            `getCashoutEscrowsData: at most ${MAX_GET_PROGRAM_ACCOUNTS_FILTERS} filters after merging`,
         );
      }
      filters.push(memcmp(BigInt(m.offset), m.bytes));
   }
   const rows = await readProgramAccountsRaw(rpc, AGGREGATOR_PROGRAM_ID, filters);
   return rows.map((row) => ({
      address: row.address,
      data: decodeCashoutEscrow(row.data),
   }));
}

export type GetCashoutsDataFilters = Readonly<{
   mm?: Address;
   feepayer?: Address;
   origBetId?: bigint;
   cashoutId?: bigint;
   marketId?: MarketId;
   eventId?: EventId;
   result?: CashoutAccountData['result'];
}>;

/** Single-bet cashout ticket PDAs under {@link AGGREGATOR_PROGRAM_ID}. */
export async function getCashoutsData(
   rpc: Rpc<SolanaRpcApi>,
   optional?: GetCashoutsDataFilters,
): Promise<ReadonlyArray<Readonly<{ address: Address; data: CashoutAccountData }>>> {
   const filters: (GetProgramAccountsMemcmpFilter | { readonly dataSize: bigint })[] = [
      memcmp(BigInt(CASHOUT_ACCOUNT_WIRE_OFFSETS.discriminator), u8WireByte(CASHOUT_ACCOUNT_DISCRIMINATOR)),
   ];
   const segments: MemcmpSeg[] = [];
   if (optional?.marketId !== undefined) {
      segments.push({
         offset: CASHOUT_ACCOUNT_WIRE_OFFSETS.marketId,
         bytes: encodeMarketIdWire(optional.marketId),
      });
   } else if (optional?.eventId !== undefined) {
      segments.push({
         offset: CASHOUT_ACCOUNT_WIRE_OFFSETS.marketId,
         bytes: encodeEventIdWire(optional.eventId),
      });
   }
   if (optional?.mm !== undefined) {
      segments.push({
         offset: CASHOUT_ACCOUNT_WIRE_OFFSETS.mm,
         bytes: new Uint8Array(addressEncoder.encode(optional.mm)),
      });
   }
   if (optional?.feepayer !== undefined) {
      segments.push({
         offset: CASHOUT_ACCOUNT_WIRE_OFFSETS.feepayer,
         bytes: new Uint8Array(addressEncoder.encode(optional.feepayer)),
      });
   }
   if (optional?.origBetId !== undefined) {
      segments.push({ offset: CASHOUT_ACCOUNT_WIRE_OFFSETS.origBetId, bytes: u64Le(optional.origBetId) });
   }
   if (optional?.cashoutId !== undefined) {
      segments.push({ offset: CASHOUT_ACCOUNT_WIRE_OFFSETS.cashoutId, bytes: u64Le(optional.cashoutId) });
   }
   if (optional?.result !== undefined) {
      segments.push({ offset: CASHOUT_ACCOUNT_WIRE_OFFSETS.result, bytes: u8WireByte(optional.result) });
   }
   const merged = mergeAdjacentMemcmpSegments(segments);
   for (const m of merged) {
      if (filters.length >= MAX_GET_PROGRAM_ACCOUNTS_FILTERS) {
         throw new RangeError(
            `getCashoutsData: at most ${MAX_GET_PROGRAM_ACCOUNTS_FILTERS} filters after merging`,
         );
      }
      filters.push(memcmp(BigInt(m.offset), m.bytes));
   }
   const rows = await readProgramAccountsRaw(rpc, AGGREGATOR_PROGRAM_ID, filters);
   return rows.map((row) => ({
      address: row.address,
      data: decodeCashoutAccountDataStrict(row.data),
   }));
}

export type GetCashoutParlaysDataFilters = Readonly<{
   mm?: Address;
   feepayer?: Address;
   origBetId?: bigint;
   cashoutId?: bigint;
   result?: CashoutParlayAccountData['result'];
}>;

/** Parlay cashout ticket PDAs under {@link AGGREGATOR_PROGRAM_ID}. */
export async function getCashoutParlaysData(
   rpc: Rpc<SolanaRpcApi>,
   optional?: GetCashoutParlaysDataFilters,
): Promise<ReadonlyArray<Readonly<{ address: Address; data: CashoutParlayAccountData }>>> {
   const filters: (GetProgramAccountsMemcmpFilter | { readonly dataSize: bigint })[] = [
      memcmp(
         BigInt(CASHOUT_PARLAY_ACCOUNT_WIRE_OFFSETS.discriminator),
         u8WireByte(CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR),
      ),
   ];
   const segments: MemcmpSeg[] = [];
   if (optional?.mm !== undefined) {
      segments.push({
         offset: CASHOUT_PARLAY_ACCOUNT_WIRE_OFFSETS.mm,
         bytes: new Uint8Array(addressEncoder.encode(optional.mm)),
      });
   }
   if (optional?.feepayer !== undefined) {
      segments.push({
         offset: CASHOUT_PARLAY_ACCOUNT_WIRE_OFFSETS.feepayer,
         bytes: new Uint8Array(addressEncoder.encode(optional.feepayer)),
      });
   }
   if (optional?.origBetId !== undefined) {
      segments.push({
         offset: CASHOUT_PARLAY_ACCOUNT_WIRE_OFFSETS.origBetId,
         bytes: u64Le(optional.origBetId),
      });
   }
   if (optional?.cashoutId !== undefined) {
      segments.push({
         offset: CASHOUT_PARLAY_ACCOUNT_WIRE_OFFSETS.cashoutId,
         bytes: u64Le(optional.cashoutId),
      });
   }
   if (optional?.result !== undefined) {
      segments.push({
         offset: CASHOUT_PARLAY_ACCOUNT_WIRE_OFFSETS.result,
         bytes: u8WireByte(optional.result),
      });
   }
   const merged = mergeAdjacentMemcmpSegments(segments);
   for (const m of merged) {
      if (filters.length >= MAX_GET_PROGRAM_ACCOUNTS_FILTERS) {
         throw new RangeError(
            `getCashoutParlaysData: at most ${MAX_GET_PROGRAM_ACCOUNTS_FILTERS} filters after merging`,
         );
      }
      filters.push(memcmp(BigInt(m.offset), m.bytes));
   }
   const rows = await readProgramAccountsRaw(rpc, AGGREGATOR_PROGRAM_ID, filters);
   return rows.map((row) => ({
      address: row.address,
      data: decodeCashoutParlayAccountDataStrict(row.data),
   }));
}

export type GetCashoutDataKey =
   | Address
   | Readonly<{ fillingMm: Address; cashoutId: bigint }>;

function isCashoutPdaKey(
   key: GetCashoutDataKey,
): key is Readonly<{ fillingMm: Address; cashoutId: bigint }> {
   return typeof key === 'object' && key !== null && 'fillingMm' in key && 'cashoutId' in key;
}

export async function getCashoutEscrowData(
   rpc: Rpc<SolanaRpcApi>,
   key: Address | Readonly<{ user: Address; origBetId: bigint }>,
): Promise<CashoutEscrow> {
   const address =
      typeof key === 'object' && key !== null && 'user' in key
         ? (await getCashoutEscrowPda(key.user, key.origBetId))[0]
         : key;
   const raw = await readAccountDataRaw(rpc, address);
   if (raw === null) {
      throw new Error(`Cashout escrow not found: ${String(address)}`);
   }
   return decodeCashoutEscrow(raw);
}

export async function getCashoutData(
   rpc: Rpc<SolanaRpcApi>,
   key: GetCashoutDataKey,
): Promise<CashoutAccountData> {
   const address = isCashoutPdaKey(key)
      ? (await getCashoutPda(key.fillingMm, key.cashoutId))[0]
      : key;
   const raw = await readAccountDataRaw(rpc, address);
   if (raw === null) {
      throw new Error(`Cashout account not found: ${String(address)}`);
   }
   return decodeCashoutAccountDataStrict(raw);
}

export async function getCashoutParlayData(
   rpc: Rpc<SolanaRpcApi>,
   key: GetCashoutDataKey,
): Promise<CashoutParlayAccountData> {
   const address = isCashoutPdaKey(key)
      ? (await getCashoutParlayPda(key.fillingMm, key.cashoutId))[0]
      : key;
   const raw = await readAccountDataRaw(rpc, address);
   if (raw === null) {
      throw new Error(`Cashout parlay account not found: ${String(address)}`);
   }
   return decodeCashoutParlayAccountDataStrict(raw);
}

export async function getFreebetIssuerData(
   rpc: Rpc<SolanaRpcApi>,
   auth: Address,
): Promise<FreebetIssuer> {
   const [address] = await getFreebetIssuerPda(auth);
   const raw = await readAccountDataRaw(rpc, address);
   if (raw === null) {
      throw new Error(`Freebet issuer not found: ${String(address)}`);
   }
   return decodeFreebetIssuer(raw);
}

export async function getFreebetData(
   rpc: Rpc<SolanaRpcApi>,
   auth: Address,
   freebetId: number,
): Promise<FreebetAccountData> {
   const [address] = await getFreebetPda(auth, freebetId);
   const raw = await readAccountDataRaw(rpc, address);
   if (raw === null) {
      throw new Error(`Freebet account not found: ${String(address)}`);
   }
   return decodeFreebetAccountData(raw);
}
