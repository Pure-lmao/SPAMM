import { getAddressEncoder, getProgramDerivedAddress, ProgramDerivedAddressBump, Rpc, SolanaRpcApi, type Address } from '@solana/kit';

import {
   AGGREGATOR_PROGRAM_ID,
   MINT_ID,
   BET_ACCOUNT_SEED,
   CONFIG_PDA_SEED,
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
} from './constants.js';
import { getEventIdEncoder, getMarketIdEncoder } from './codex.js';
import { EventId, MarketId, Sport } from './types.js';
import { validateSportEnum } from './validate.js';

const addressEncoder = getAddressEncoder();
const eventIdEncoder = getEventIdEncoder();
const marketIdEncoder = getMarketIdEncoder();

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


export async function getRecentSlot(rpc: Rpc<SolanaRpcApi>): Promise<bigint> {
   const slot = await rpc.getSlot().send();
   return slot;
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
   const out = new Uint8Array(8);
   new DataView(out.buffer).setBigUint64(0, betId, true);
   return out;
}

/**
 * Derives the aggregator **config PDA** address (`["config"]` seed under {@link AGGREGATOR_PROGRAM_ID}).
 *
 * **Rust:** `verify_config_pda` / `CONFIG_PDA_SEED` with program id `aggregator::ID`.
 *
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — config PDA address and bump. **Note:** uses SDK {@link AGGREGATOR_PROGRAM_ID} placeholder until deployment pins the real program id.
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
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — MM list PDA address and bump. **Note:** same program-id placeholder caveat as {@link getConfigPda}.
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
 * Derives **MM market data PDA** (`["market_data", market_id_wire_for_seed]` on the **MM program**).
 *
 * **Rust:** `MM_MARKET_DATA_PDA_SEED` + `MarketId` wire bytes from `to_zc` (`verify_mm_market_data_pda`).
 *
 * @param mmProgramId - **TS:** `Address` — MM program id. **Rust:** owner program for PDA.
 * @param marketId - **TS:** {@link MarketId}. **Rust:** `MarketId` (same bytes as {@link marketIdForSeed} in TS).
 * @returns **`Promise<readonly [Address, ProgramDerivedAddressBump]>`** — MM market-data PDA address and bump.
 */
export async function getMmMarketDataPda(mmProgramId: Address, marketId: MarketId): Promise<readonly [Address, ProgramDerivedAddressBump]> {
   return await getProgramDerivedAddress({
      programAddress: mmProgramId,
      seeds: [MM_MARKET_DATA_PDA_SEED, marketIdEncoder.encode(marketId)],
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

const textEncoder = new TextEncoder();

function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
   let total = 0;
   for (const p of parts) total += p.length;
   const out = new Uint8Array(total);
   let o = 0;
   for (const p of parts) {
      out.set(p, o);
      o += p.length;
   }
   return out;
}

function requireU8Score(n: number | undefined, label: string): number {
   if (n === undefined || !Number.isInteger(n) || n < 0 || n > 255) {
      throw new RangeError(`${label} is required and must be an integer in [0, 255]`);
   }
   return n;
}

/** Web Crypto digest without requiring `"lib": ["DOM"]` in consumers. */
async function sha256(preimage: Uint8Array): Promise<Uint8Array> {
   const subtle = (globalThis as { crypto?: { subtle?: { digest(alg: string, data: ArrayBufferView): Promise<ArrayBuffer> } } })
      .crypto?.subtle;
   if (!subtle) {
      throw new TypeError('SHA-256 requires a runtime with Web Crypto (globalThis.crypto.subtle), e.g. Bun, Node 19+, or a browser');
   }
   const digest = await subtle.digest('SHA-256', preimage);
   return new Uint8Array(digest);
}

/**
 * **`event_state_hash`** preimage: `sha256(sport_u8 || time_period_utf8 || …scores…)`.
 *
 * **Basketball:** only sport + UTF-8 `timePeriod` (period label, e.g. `"PG"` / `"T1"`).
 * **Other sports:** + home/away score as `u8`. **Soccer:** + home/away red cards as `u8`.
 *
 * @returns **`Promise<Uint8Array>`** — length 32 (raw SHA-256). **Note:** async because `crypto.subtle.digest` is async in Web Crypto.
 */
export async function getEventHash(
   sport: Sport,
   timePeriod: string,
   gameInfo: {
      homeScore?: number;
      awayScore?: number;
      homeReds?: number;
      awayReds?: number;
   },
): Promise<Uint8Array> {
   validateSportEnum(sport);

   const preimage: Uint8Array[] = [new Uint8Array([sport]), textEncoder.encode(timePeriod)];

   if (sport !== Sport.Basketball) {
      const home = requireU8Score(gameInfo.homeScore, 'homeScore');
      const away = requireU8Score(gameInfo.awayScore, 'awayScore');
      preimage.push(new Uint8Array([home]), new Uint8Array([away]));

      if (sport === Sport.Soccer) {
         const homeReds = requireU8Score(gameInfo.homeReds, 'homeReds');
         const awayReds = requireU8Score(gameInfo.awayReds, 'awayReds');
         preimage.push(new Uint8Array([homeReds]), new Uint8Array([awayReds]));
      }
   }
   return sha256(concatUint8Arrays(preimage));
}