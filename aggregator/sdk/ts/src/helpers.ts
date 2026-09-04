import {
   getAddressEncoder,
   getProgramDerivedAddress,
   type ProgramDerivedAddressBump,
   type Address,
} from '@solana/kit';

import {
   AGGREGATOR_PROGRAM_ID,
   MINT_ID,
   BET_ACCOUNT_SEED,
   CASHOUT_ACCOUNT_SEED,
   CASHOUT_ESCROW_SEED,
   CASHOUT_PARLAY_ACCOUNT_SEED,
   CONFIG_PDA_SEED,
   FREEBET_ACCOUNT_SEED,
   FREEBET_ISSUER_SEED,
   EVENT_STATE_SEED,
   MM_ACCOUNT_CONFIG_SEED,
   MM_ENCUMBRANCE_PDA_SEED,
   MM_MARKET_DATA_PDA_SEED,
   MM_LIST_PDA_SEED,
   MM_PARLAY_QUOTE_BUFFER_SEED,
   MM_QUOTE_BUFFER_SEED,
   NETTING_PDA_SEED,
   PARLAY_BET_ACCOUNT_SEED,
   SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   SPL_TOKEN_PROGRAM_ID,
   ADDRESS_LEN,
   U32_LEN,
   U64_LEN,
} from './constants.js';
import { getEventIdEncoder, getMarketIdEncoder } from './codex.js';
import {
   MARKET_ID_BODY_WIRE_SIZE,
   MARKET_QUOTES_PROXY_RETURN_MAX,
   type EventGameState,
   type EventId,
   type MarketId,
} from './types.js';

const addressEncoder = getAddressEncoder();
const eventIdEncoder = getEventIdEncoder();
const marketIdEncoder = getMarketIdEncoder();

/** PDA seeds for MM market data: legacy `MarketId` body wire + `operator` address bytes. */
export function marketIdPdaSeeds(marketId: MarketId): readonly [Uint8Array, Uint8Array] {
   const wire = marketIdEncoder.encode(marketId);
   return [wire.subarray(0, MARKET_ID_BODY_WIRE_SIZE), wire.subarray(MARKET_ID_BODY_WIRE_SIZE)] as const;
}

/**
 * Encodes **`EventId`** to its **little-endian wire bytes** for PDA seeds and instruction data.
 *
 * **Rust:** `EventId::as_wire_bytes()` / codec used in `find_program_address` seeds (`EVENT_STATE_SEED`, etc.).
 *
 * @param eventId - **TS:** {@link EventId}. **Rust:** `EventId` struct (sport, league, event_id fields).
 * @returns **`Uint8Array`** — fixed-length wire encoding (same bytes the program hashes). **Note:** not Base58; raw struct bytes.
 */
export function encodeEventIdWire(eventId: EventId): Uint8Array {
   return new Uint8Array(eventIdEncoder.encode(eventId));
}


/**
 * **`u64` bet id** as **8 little-endian bytes** for bet PDA seeds (`["bet", user, bet_id]`).
 *
 * **Rust:** `bet_id.to_le_bytes()` in seed array for `BET_ACCOUNT_SEED` PDAs.
 *
 * @param betId - **TS:** `bigint` — logical bet id. **Rust:** `u64`.
 * @returns **`Uint8Array`** — length 8, LE. **Note:** does not validate range; callers should validate `u64` if needed.
 */
export function encodeBetIdLe(betId: bigint): Uint8Array {
   const out = new Uint8Array(U64_LEN);
   new DataView(out.buffer).setBigUint64(0, betId, true);
   return out;
}

/**
 * Encodes a freebet id as 4 little-endian bytes (PDA seed / ix prefix).
 */
export function encodeFreebetIdLe(freebetId: number): Uint8Array {
   if (!Number.isInteger(freebetId) || freebetId < 0 || freebetId > 0xffff_ffff) {
      throw new RangeError(`freebetId must be a u32 (${freebetId})`);
   }
   const out = new Uint8Array(U32_LEN);
   new DataView(out.buffer).setUint32(0, freebetId, true);
   return out;
}

/**
 * Derives the aggregator **config PDA** address (`["config"]` seed under {@link AGGREGATOR_PROGRAM_ID}).
 *
 * **Rust:** `verify_config_pda` / `CONFIG_PDA_SEED` with program id `aggregator::ID`.
 *
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — config PDA address and bump.
 */
export async function getConfigPda(): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [CONFIG_PDA_SEED],
   });
}

/**
 * Derives the aggregator **MM list PDA** (`["mm_list"]` under {@link AGGREGATOR_PROGRAM_ID}).
 *
 * **Rust:** `MM_LIST_PDA_SEED` / `verify_mm_list_pda` against fixed layout header + MM pubkeys.
 *
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — MM list PDA address and bump.
 */
export async function getMmListPda(): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [MM_LIST_PDA_SEED],
   });
}

/**
 * Derives a market-maker **`["config"]` PDA** on the **MM program** (MM admin authority lives in this account).
 *
 * **Rust:** `MM_ACCOUNT_CONFIG_SEED` with `program_id = mm_program_id` (`verify_mm_config_pda`).
 *
 * @param mmProgramId - **TS:** `Address` — MM program pubkey. **Rust:** `Pubkey` of the SPAMM MM program.
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — MM config PDA address and bump. **Note:** different program id from aggregator; seed string collides in name only (`"config"` on MM vs aggregator).
 */
export async function getMmConfigPda(mmProgramId: Address): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [MM_ACCOUNT_CONFIG_SEED],
   });
}

/**
 * Derives the **MM quote buffer PDA** (`["mm_quote_buffer"]` on the **MM program** — one buffer per MM).
 *
 * **Rust:** `market_maker::constants::MM_QUOTE_BUFFER_SEED` + `Address::find_program_address` in MM `init_program`.
 *
 * @param mmProgramId - **TS:** `Address` — MM program id. **Rust:** MM `program_id`.
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — quote buffer PDA address and bump. **Note:** account is owned by the MM program, not the aggregator.
 */
export async function getMmQuoteBufferPda(mmProgramId: Address): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [MM_QUOTE_BUFFER_SEED],
   });
}

/**
 * Derives the **MM parlay quote buffer PDA** (`["mm_parlay_quote_buffer"]` on the **MM program**).
 *
 * **Rust:** `MM_PARLAY_QUOTE_BUFFER_SEED` + `find_program_address` on the MM `program_id`.
 */
export async function getMmParlayQuoteBufferPda(
   mmProgramId: Address,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [MM_PARLAY_QUOTE_BUFFER_SEED],
   });
}

/**
 * Derives the **per-MM encumbrance PDA** on the **aggregator** program (`["encumbrance", mm_program_id_bytes]`).
 *
 * **Rust:** `MM_ENCUMBRANCE_PDA_SEED` + MM program address bytes under `aggregator::ID` (`verify_mm_encumbrance_pda`).
 *
 * @param mmProgramId - **TS:** `Address` — MM program whose liability is tracked. **Rust:** `mm_program` pubkey embedded in seed.
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — encumbrance PDA address and bump.
 */
export async function getMmEncumbrancePda(mmProgramId: Address): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [MM_ENCUMBRANCE_PDA_SEED, addressEncoder.encode(mmProgramId)],
   });
}

/**
 * Derives the **netting PDA** for `(mm_program, event_id)` on the **aggregator** (`["netting", mm, event_id_wire]`).
 *
 * **Rust:** `NETTING_PDA_SEED` + MM pubkey + `EventId` wire bytes (`verify_netting_pda` / `create_netting_account`).
 *
 * @param mmProgramId - **TS:** `Address` — MM program id. **Rust:** first seed pubkey after `"netting"`.
 * @param eventId - **TS:** {@link EventId}. **Rust:** `EventId` encoded into trailing seed bytes.
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — netting PDA address and bump.
 */
export async function getNettingPda(mmProgramId: Address, eventId: EventId): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [NETTING_PDA_SEED, addressEncoder.encode(mmProgramId), encodeEventIdWire(eventId)],
   });
}

/**
 * Derives the **event state PDA** on the **MM program** (`["event_state", event_id_wire]`).
 *
 * **Rust:** `EVENT_STATE_SEED` + `event_id.as_wire_bytes()` owned by MM program (`verify_event_state`).
 *
 * @param mmProgramId - **TS:** `Address` — MM program id. **Rust:** PDA owner program.
 * @param eventId - **TS:** {@link EventId}. **Rust:** `EventId` in seeds.
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — event state PDA address and bump.
 */
export async function getEventStatePda(mmProgramId: Address, eventId: EventId): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [EVENT_STATE_SEED, encodeEventIdWire(eventId)],
   });
}

/**
 * Derives **MM market data PDA** (`["market_data", market_id_body_wire, operator]` on the **MM program**).
 *
 * **Rust:** `MM_MARKET_DATA_PDA_SEED` + `MarketId` wire bytes from `to_zc` (`verify_mm_market_data_pda`).
 *
 * @param mmProgramId - **TS:** `Address` — MM program id. **Rust:** owner program for PDA.
 * @param marketId - **TS:** {@link MarketId}. **Rust:** `MarketId` (same bytes as {@link marketIdPdaSeeds} in TS).
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — MM market-data PDA address and bump.
 */
export async function getMmMarketDataPda(mmProgramId: Address, marketId: MarketId): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   const [body, operator] = marketIdPdaSeeds(marketId);
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [MM_MARKET_DATA_PDA_SEED, body, operator],
   });
}

/**
 * Derives the **user bet PDA** on the **aggregator** (`["bet", user, bet_id_le]`).
 *
 * **Rust:** `BET_ACCOUNT_SEED` + user pubkey + `bet_id.to_le_bytes()` under aggregator program id.
 *
 * @param user - **TS:** `Address` — bet owner. **Rust:** user `Pubkey` in seeds.
 * @param betId - **TS:** `bigint` — unique bet id per user. **Rust:** `u64` LE in seeds.
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — bet PDA address and bump.
 */
export async function getBetPda(user: Address, betId: bigint): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [BET_ACCOUNT_SEED, addressEncoder.encode(user), encodeBetIdLe(betId)],
   });
}

/**
 * Derives the **parlay bet PDA** on the **aggregator** (`["parlay", user, bet_id_le]`).
 *
 * **Rust:** `PARLAY_BET_ACCOUNT_SEED` + user pubkey + `bet_id.to_le_bytes()` under aggregator program id (`fill_parlay`).
 */
export async function getParlayBetPda(
   user: Address,
   betId: bigint,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [PARLAY_BET_ACCOUNT_SEED, addressEncoder.encode(user), encodeBetIdLe(betId)],
   });
}

/**
 * Derives the **cashout escrow PDA** (`["cashout_escrow", user, orig_bet_id_le]`).
 */
export async function getCashoutEscrowPda(
   user: Address,
   origBetId: bigint,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [CASHOUT_ESCROW_SEED, addressEncoder.encode(user), encodeBetIdLe(origBetId)],
   });
}

/**
 * Derives the **single-bet cashout ticket PDA** (`["cashout", filling_mm, cashout_id_le]`).
 */
export async function getCashoutPda(
   fillingMm: Address,
   cashoutId: bigint,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [CASHOUT_ACCOUNT_SEED, addressEncoder.encode(fillingMm), encodeBetIdLe(cashoutId)],
   });
}

/**
 * Derives the **parlay cashout ticket PDA** (`["cashout_parlay", filling_mm, cashout_id_le]`).
 */
export async function getCashoutParlayPda(
   fillingMm: Address,
   cashoutId: bigint,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [
         CASHOUT_PARLAY_ACCOUNT_SEED,
         addressEncoder.encode(fillingMm),
         encodeBetIdLe(cashoutId),
      ],
   });
}

/**
 * Derives the **freebet issuer PDA** (`["freebet_issuer", auth]`).
 */
export async function getFreebetIssuerPda(
   auth: Address,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [FREEBET_ISSUER_SEED, addressEncoder.encode(auth)],
   });
}

/**
 * Derives the **freebet PDA** (`["freebet", auth, freebet_id_le]`).
 */
export async function getFreebetPda(
   auth: Address,
   freebetId: number,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: AGGREGATOR_PROGRAM_ID,
      seeds: [FREEBET_ACCOUNT_SEED, addressEncoder.encode(auth), encodeFreebetIdLe(freebetId)],
   });
}

/**
 * Derives the **associated token account (ATA)** address for `owner` + `mint` (classic SPL layout).
 *
 * **Rust:** Same as `spl_associated_token_account::get_associated_token_address` / `pinocchio_associated_token_account` seeds: `[owner, token_program_id, mint]` under the ATA program id.
 *
 * @param owner - **TS:** `Address` — ATA owner (often a PDA or user wallet). **Rust:** `Pubkey` first seed.
 * @param mint - **TS:** `Address` — SPL mint (default {@link MINT_ID}). **Rust:** mint `Pubkey`.
 * @param tokenProgram - **TS:** `Address` — Token program (default {@link SPL_TOKEN_PROGRAM_ID}). **Rust:** `spl_token::ID` or Token-2022 id.
 * @param associatedTokenProgram - **TS:** `Address` — ATA program (default {@link SPL_ASSOCIATED_TOKEN_PROGRAM_ID}). **Rust:** `spl_associated_token_account::ID`.
 * @returns **`Promise<Address>`** — ATA address (unchecked existence; on-chain may need `create_idempotent`). **Note:** defaults align with aggregator instruction builders in this SDK.
 */
export async function getAta(
   owner: Address,
   mint: Address = MINT_ID,
   tokenProgram: Address = SPL_TOKEN_PROGRAM_ID,
   associatedTokenProgram: Address = SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
): Promise<Address> {
   const [ata] = await getProgramDerivedAddress({
      programAddress: associatedTokenProgram,
      seeds: [
         addressEncoder.encode(owner),
         addressEncoder.encode(tokenProgram),
         addressEncoder.encode(mint),
      ],
   });
   return ata;
}

export function getEventGameState(gamePhase: string, homePrimary: number, awayPrimary: number, homeSecondary: number, awaySecondary: number): EventGameState {
   return {
      gamePhase: gamePhase,
      homePrimary: homePrimary,
      awayPrimary: awayPrimary,
      homeSecondary: homeSecondary,
      awaySecondary: awaySecondary,
   };
}

/** Side count for `mkt`, per `id-system.md` (`ids::num_sides_for_mkt`). */
export function numSidesForMkt(mkt: number): number | undefined {
   if (mkt === 0 || mkt === 4) {
      return 2;
   }
   if (mkt === 1 || mkt === 5) {
      return 3;
   }
   if (mkt === 6) {
      return 6;
   }
   if (mkt === 7) {
      return 9;
   }
   if (mkt === 9) {
      return 1;
   }
   if (mkt >= 10 && mkt <= 50) {
      return 2;
   }
   if (mkt >= 51 && mkt <= 99) {
      return 2;
   }
   if (mkt >= 100 && mkt <= 299) {
      return 2;
   }
   if (mkt >= 300 && mkt <= 499) {
      return 2;
   }
   if (mkt >= 1000 && mkt <= 1999) {
      return 2;
   }
   if (mkt >= 2000 && mkt <= 2999) {
      return 2;
   }
   if (mkt >= 3000 && mkt <= 3999) {
      return 2;
   }
   if (mkt >= 4000 && mkt <= 4999) {
      return 4;
   }
   if (mkt >= 5000 && mkt <= 5999) {
      return 6;
   }
   if (mkt >= 10000 && mkt <= 10909) {
      return 1;
   }
   if (mkt >= 11000) {
      return 2;
   }
   return undefined;
}

/** `mm_quote::proxy_market_mm_entry_wire_len` */
export function proxyMarketMmEntryWireLen(numSides: number): number {
   return ADDRESS_LEN + numSides * U32_LEN;
}

/** `mm_quote::max_proxy_mms_for_market_quotes` */
export function maxProxyMmsForMarketQuotes(numSides: number): number {
   if (numSides <= 0) {
      return 0;
   }
   return Math.floor(MARKET_QUOTES_PROXY_RETURN_MAX / proxyMarketMmEntryWireLen(numSides));
}