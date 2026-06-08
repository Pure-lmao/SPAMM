import { AccountRole, type Instruction } from '@solana/instructions';
import {
   getProgramDerivedAddress,
   getAddressEncoder,
   getU64Encoder,
   type Address,
   type Rpc,
   type SolanaRpcApi,
} from '@solana/kit';
const u64Encoder = getU64Encoder();
const addressEncoder = getAddressEncoder();
import {
   ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
   AGGREGATOR_PROGRAM_ID,
   LOOKUP_TABLE_ID,
   MAX_NUMBER_OF_MMS,
   MAX_NUMBER_OF_MMS_PROXY,
   MAX_PARLAY_LEGS,
   MINT_ID,
   ODDS_SCALE,
   SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   SPL_TOKEN_PROGRAM_ID,
   SYSVAR_INSTRUCTIONS_ID,
   SYSTEM_PROGRAM_ID,
   CLOCK_ID,
} from './constants.js';
import { encodeAggregatorInstructionData, encodeGetQuoteIxData, encodeGetQuoteParlayIxData } from './codex.js';
import {
   getAta,
   getBetPda,
   getConfigPda,
   getEventStatePda,
   getMmConfigPda,
   getMmEncumbrancePda,
   getMmListPda,
   getMmMarketDataPda,
   getMmParlayQuoteBufferPda,
   getMmQuoteBufferPda,
   getNettingPda,
   getParlayBetPda,
   maxProxyMmsForMarketQuotes,
   numSidesForMkt,
} from './helpers.js';
import {
   BetResult,
   type BetAccountData,
   type BetFiller,
   type EventGameState,
   type EventId,
   type FillBetIxData,
   type FillParlayIxData,
   type MarketId,
   type ParlayBetAccountData,
   type ParlayLegWire,
} from './types.js';
import {
   validateBetSide,
   validateChangeConfigStatus,
   validateEventGameState,
   validateEventId,
   validateFillBetIxData,
   validateFillParlayIxData,
   validateGetQuoteParlayIxData,
   validateGradeBetResults,
   validateMarketId,
   validatePositiveU64,
   validateU16,
   validateU32Bigint,
   validateU8,
} from './validate.js';

/** Router discriminators (first byte of aggregator instruction data). */
export const INIT_PROGRAM_IX_DISCRIMINATOR = 0;
export const CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR = 1;
export const REGISTER_MM_IX_DISCRIMINATOR = 2;
export const FILL_BET_IX_DISCRIMINATOR = 3;
export const FILL_PARLAY_IX_DISCRIMINATOR = 4;
export const GRADE_BETS_IX_DISCRIMINATOR = 5;
export const SETTLE_BET_IX_DISCRIMINATOR = 6;
export const SETTLE_PARLAY_IX_DISCRIMINATOR = 7;
export const GET_QUOTE_PROXY_IX_DISCRIMINATOR = 8;
export const GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR = 9;
export const GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR = 10;
export const CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR = 50;
export const ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR = 51;
export const REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR = 52;
export const CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR = 53;
export const DEREGISTER_MM_IX_DISCRIMINATOR = 54;
export const WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR = 100;
export const WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR = 254;
export const FORCE_CLOSE_PDA_IX_DISCRIMINATOR = 255;

export const MM_GET_QUOTE_IX_DISCRIMINATOR = 5;
export const MM_FILL_QUOTE_IX_DISCRIMINATOR = 6;
export const MM_GET_QUOTE_PARLAY_IX_DISCRIMINATOR = 7;
export const MM_FILL_QUOTE_PARLAY_IX_DISCRIMINATOR = 8;

/**
 * Payload for a market-maker **`get_quote`** CPI (not the aggregator router).
 * Mirrors `GetQuoteIxData` / wire layout used by `fill_bet` when invoking the MM program.
 *
 * @remarks
 * - **TS:** `MmGetQuote` — `amount` / `minOddsScaled` as `bigint` where wire uses `u64` / `u32` odds scale.
 * - **Rust:** `spamm_aggregator::state::GetQuoteIxData` (discriminator + amount + odds_scaled + `MarketId` + side + `EventGameState` + sequence).
 */
export type MmGetQuote = {
   amount: bigint;
   minOddsScaled: bigint;
   side: number;
   eventGameState: EventGameState;
   eventStateSequence: number;
   marketId: MarketId;
};

/** Payload for MM **`get_quote_parlay`** (same leg table as `fill_parlay`). */
export type MmGetQuoteParlay = {
   amount: bigint;
   /** Minimum combined scaled odds hint; wire field `odds_scaled` on `GetQuoteParlayIxData`. */
   minOddsScaled: bigint;
   legs: readonly ParlayLegWire[];
};

const ro = (address: Address) => ({ address, role: AccountRole.READONLY });
const rw = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const rs = (address: Address) => ({ address, role: AccountRole.READONLY_SIGNER });
const ws = (address: Address) => ({ address, role: AccountRole.WRITABLE_SIGNER });

function isBlankMarketMaker(mmProgram: Address): boolean {
   return mmProgram === SYSTEM_PROGRAM_ID;
}

async function settleFillerAccountRow(
   filler: BetFiller,
): Promise<readonly [Address, Address, Address, Address, Address]> {
   if (isBlankMarketMaker(filler.mmAddress)) {
      return [SYSTEM_PROGRAM_ID, SYSTEM_PROGRAM_ID, SYSTEM_PROGRAM_ID, SYSTEM_PROGRAM_ID, SYSTEM_PROGRAM_ID] as const;
   }
   const mmProgram = filler.mmAddress;
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram);
   const liabilityAta = await getAta(mmEncumbrancePda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const mmTokenAta = await getAta(mmConfigPda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   return [mmProgram, mmConfigPda, mmEncumbrancePda, liabilityAta, mmTokenAta] as const;
}

/**
 * **`init_program`** — one-time setup of aggregator config PDA, MM list PDA, and address lookup table (rent paid by admin).
 *
 * **Rust:** `aggregator::instructions::init_program::process` (`INIT_PROGRAM_IX_DISCRIMINATOR` = 0). Router data after discriminator: **`recent_slot: u64`** (little-endian), used for ALT PDA derivation and create CPI (must appear in `SlotHashes` when the tx runs).
 *
 * @param admin - **TS:** `Address` — writable signer, becomes config admin. **Rust:** `authority` (`AccountView`, writable signer).
 * @param recentSlot - **TS:** `bigint` — slot encoded as LE `u64` in instruction data and in ALT PDA seeds with config PDA. Use a recent slot from RPC (e.g. {@link getRecentSlot}).
 * @returns **`Promise<Instruction>`** — `programAddress` = {@link AGGREGATOR_PROGRAM_ID}; `data` = `[discriminator, ...u64(recentSlot)]`. Accounts: admin, config PDA, MM list PDA, system program, lookup table PDA.
 */
export async function getInitProgramIx(admin: Address, recentSlot: bigint): Promise<Instruction> {
   const [configPda] = await getConfigPda();
   const [mmListPda] = await getMmListPda();
   const [lookupTablePda] = await getProgramDerivedAddress({
      programAddress: ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
      seeds: [addressEncoder.encode(configPda), u64Encoder.encode(recentSlot)],
   });
   console.log("recentSlot", recentSlot);
   console.log("lookupTablePda", lookupTablePda);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(admin), rw(configPda), rw(mmListPda), 
         ro(SYSTEM_PROGRAM_ID), rw(lookupTablePda), ro(ADDRESS_LOOKUP_TABLE_PROGRAM_ID)],
      data: encodeAggregatorInstructionData({ kind: 'initProgram', recentSlot }),
   };
}

/**
 * **`change_config_status`** — pause (0) or unpause (1) the aggregator; must be config admin.
 *
 * **Rust:** `aggregator::instructions::change_config_status::process` (`CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR` = 1). Payload: one `u8` status after discriminator.
 * 
 * @param admin - **TS:** `Address` — signer matching config admin. **Rust:** `auth` (signer).
 * @param status - **TS:** `0 | 1` — 0 = paused, 1 = unpaused. **Rust:** `u8` written to config at status offset.
 * @returns **`Promise<Instruction>`** — `programAddress` = aggregator; `data` = `[discriminator, status]`.
 */
export async function getChangeConfigStatusIx(admin: Address, status: 0 | 1): Promise<Instruction> {
   validateChangeConfigStatus(status);
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [rs(admin), rw(configPda)],
      data: encodeAggregatorInstructionData({ kind: 'changeConfigStatus', status }),
   };
}

/**
 * **`register_mm`** — register a market-maker program in the aggregator MM list and set up encumbrance + liability ATA wiring.
 *
 * **Rust:** `aggregator::instructions::register_mm::process` (`REGISTER_MM_IX_DISCRIMINATOR` = 2). No payload after router discriminator.
 *
 * @param mmAdmin - **TS:** `Address` — MM admin (writable signer). **Rust:** `mm_admin` (writable signer), verified against MM config PDA.
 * @param mmProgram - **TS:** `Address` — executable MM program id. **Rust:** `mm_program` (`Pubkey` / `Address`).
 * @returns **`Promise<Instruction>`** — eleven account metas (admin, MM program, MM config, encumbrance, liability ATA, aggregator config, MM list, token + ATA programs, mint, system). Mint and token program addresses match the SDK `constants` module.
 */
export async function getRegisterMmIx(mmAdmin: Address, mmProgram: Address): Promise<Instruction> {
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram);
   const mmLiabilityAta = await getAta(
      mmEncumbrancePda,
      MINT_ID,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const [configPda] = await getConfigPda();
   const [mmListPda] = await getMmListPda();
   const mmTokenAta = await getAta(mmConfigPda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [mmQuoteBuffer] = await getMmQuoteBufferPda(mmProgram);
   const [mmParlayQuoteBuffer] = await getMmParlayQuoteBufferPda(mmProgram);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(mmAdmin),
         ro(mmProgram),
         ro(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         ro(configPda),
         rw(mmListPda),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSTEM_PROGRAM_ID),
         rw(LOOKUP_TABLE_ID),
         ro(ADDRESS_LOOKUP_TABLE_PROGRAM_ID),
         ro(mmTokenAta),
         ro(mmQuoteBuffer),
         ro(mmParlayQuoteBuffer),
      ],
      data: encodeAggregatorInstructionData({ kind: 'registerMm' }),
   };
}

/**
 * **`deregister_mm`** — admin tears down an MM registration (inverse of {@link getRegisterMmIx}).
 *
 * **Rust:** `aggregator::instructions::deregister_mm::process` (`DEREGISTER_MM_IX_DISCRIMINATOR` = 54). No payload after router discriminator.
 *
 * @param aggregatorAdmin - **TS:** `Address` — aggregator config authority (writable signer). **Rust:** `aggregator_admin`.
 * @param mmAdmin - **TS:** `Address` — MM admin (writable); receives closed-account rent. **Rust:** `mm_admin`, verified against MM config PDA.
 * @param mmProgram - **TS:** `Address` — MM program id to remove from the list and ALT.
 * @returns **`Promise<Instruction>`** — 17 account metas; liability tokens move to MM collateral ATA, then encumbrance PDA and liability ATA close.
 */
export async function getDeregisterMmIx(
   aggregatorAdmin: Address,
   mmAdmin: Address,
   mmProgram: Address,
): Promise<Instruction> {
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram);
   const mmLiabilityAta = await getAta(
      mmEncumbrancePda,
      MINT_ID,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const [configPda] = await getConfigPda();
   const [mmListPda] = await getMmListPda();
   const mmTokenAta = await getAta(mmConfigPda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [mmQuoteBuffer] = await getMmQuoteBufferPda(mmProgram);
   const [mmParlayQuoteBuffer] = await getMmParlayQuoteBufferPda(mmProgram);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(aggregatorAdmin),
         rw(mmAdmin),
         ro(mmProgram),
         ro(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         ro(configPda),
         rw(mmListPda),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSTEM_PROGRAM_ID),
         rw(LOOKUP_TABLE_ID),
         ro(ADDRESS_LOOKUP_TABLE_PROGRAM_ID),
         rw(mmTokenAta),
         ro(mmQuoteBuffer),
         ro(mmParlayQuoteBuffer),
      ],
      data: encodeAggregatorInstructionData({ kind: 'deregisterMm' }),
   };
}

/**
 * **`fill_bet`** — CPI MM `get_quote` / `fill_quote`, open bet PDA + bet ATA, move collateral per best quotes (up to {@link MAX_NUMBER_OF_MMS} MMs).
 *
 * **Rust:** `aggregator::instructions::fill_bet::fill_bet` (`FILL_BET_IX_DISCRIMINATOR` = 3). Parsed body: `bet_id: u64`, `MarketId`, `side: u8`, `amount: u64`, `min_odds_scaled: u32`, `event_state_sequence: u16`, `event_game_state: EventGameState`.
 *
 * @param fill - **TS:** {@link FillBetIxData} — wire-aligned bet request. **Rust:** same fields as `parse_fill_bet_data` output.
 * @param feepayer - **TS:** `Address` — writable signer paying rent and fees. **Rust:** `feepayer` (writable signer).
 * @param user - **TS:** `Address` — bet owner (readonly signer). **Rust:** `user` (signer).
 * @param mmPrograms - **TS:** `readonly Address[]` — one MM program id per quote leg (1..=MAX_NUMBER_OF_MMS). **Rust:** repeated 9-account MM slice per program (`mm_program` … `mm_netting_pda`). Quote buffer PDA derived per MM in TS (`mm_quote_buffer` seed on MM program).
 * @returns **`Promise<Instruction>`** — base 11 accounts + 9×N MM accounts; `data` = router discriminator + encoded `fill`. **Note:** mint / token / system program addresses are taken from constants in TS builders.
 */
export async function getFillBetIx(
   fill: FillBetIxData,
   feepayer: Address,
   user: Address,
   mmPrograms: readonly Address[],
): Promise<Instruction> {
   validateFillBetIxData(fill, 'fill');
   if (mmPrograms.length === 0 || mmPrograms.length > MAX_NUMBER_OF_MMS) {
      throw new RangeError(`mmPrograms.length must be in [1, ${MAX_NUMBER_OF_MMS}]`);
   }
   const userAta = await getAta(user, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [betPda] = await getBetPda(user, fill.betId);
   const betAta = await getAta(betPda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const baseAccounts = [
      ws(feepayer),
      rs(user),
      rw(userAta),
      rw(betPda),
      rw(betAta),
      ro(configPda),
      ro(MINT_ID),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SYSTEM_PROGRAM_ID),
      ro(SYSVAR_INSTRUCTIONS_ID),
      ro(CLOCK_ID)
   ];
   const perMarketMakerAccounts: { address: Address; role: AccountRole }[] = [];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [eventStatePda] = await getEventStatePda(mmProgram, fill.marketId.eventId);
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, fill.marketId);
      const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
      const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram);
      const liabilityAta = await getAta(
         mmEncumbrancePda,
         MINT_ID,
         SPL_TOKEN_PROGRAM_ID,
         SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const mmTokenAta = await getAta(mmConfigPda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
      const [nettingPda] = await getNettingPda(mmProgram, fill.marketId.eventId);
      perMarketMakerAccounts.push(
         ro(mmProgram),
         rw(mmConfigPda),
         ro(eventStatePda),
         rw(marketDataPda),
         rw(mmQuoteBufferPda),
         rw(mmEncumbrancePda),
         rw(liabilityAta),
         rw(mmTokenAta),
         rw(nettingPda),
      );
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [...baseAccounts, ...perMarketMakerAccounts],
      data: encodeAggregatorInstructionData({
         kind: 'fillBet',
         data: fill,
      }),
   };
}

/**
 * **`get_quote_proxy`** — CPI each MM `get_quote`, return `ProxyQuoteData[]` via transaction return data (no bet accounts).
 *
 * **Rust:** `get_quote_proxy::get_quote_proxy` (`GET_QUOTE_PROXY_IX_DISCRIMINATOR` = 8). Instruction body matches `fill_bet` (`FillBetIxData`; `bet_id` unused). Per MM: 5 accounts (program, config, event state, market data, quote buffer).
 *
 * @param quote - Same fields as {@link getFillBetIx} / {@link FillBetIxData}.
 * @param user - User pubkey passed to MM `get_quote` CPI (readonly; not required to sign).
 * @param mmPrograms - One MM program id per quote source (1..={@link MAX_NUMBER_OF_MMS_PROXY}).
 */
export async function getGetQuoteProxyIx(
   quote: FillBetIxData,
   user: Address,
   mmPrograms: readonly Address[],
): Promise<Instruction> {
   validateFillBetIxData(quote, 'quote');
   if (mmPrograms.length === 0 || mmPrograms.length > MAX_NUMBER_OF_MMS_PROXY) {
      throw new RangeError(`mmPrograms.length must be in [1, ${MAX_NUMBER_OF_MMS_PROXY}]`);
   }
   const perMarketMakerAccounts: { address: Address; role: AccountRole }[] = [];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [eventStatePda] = await getEventStatePda(mmProgram, quote.marketId.eventId);
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, quote.marketId);
      const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
      perMarketMakerAccounts.push(
         ro(mmProgram),
         ro(mmConfigPda),
         ro(eventStatePda),
         ro(marketDataPda),
         rw(mmQuoteBufferPda),
      );
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ro(user), ro(CLOCK_ID),
         ...perMarketMakerAccounts],
      data: encodeAggregatorInstructionData({
         kind: 'getQuoteProxy',
         data: quote,
      }),
   };
}

/**
 * **`get_market_quotes_proxy`** — CPI each MM `get_quote` for every side in the market; return packed quotes via transaction return data.
 *
 * **Rust:** `get_market_quotes_proxy::get_market_quotes_proxy` (`GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR` = 10). Body matches `fill_bet` (`bet_id` / `side` unused). Return data is odds-only per side (`decodeMarketQuotesProxyReturnData` in `codex.ts`). `N` ≤ `min(20, maxProxyMmsForMarketQuotes(numSidesForMkt(mkt)))`.
 *
 * @param quote - Same fields as {@link getFillBetIx} / {@link FillBetIxData}.
 * @param user - User pubkey for MM CPI (readonly).
 * @param mmPrograms - MM program ids to query; count must fit return-data cap for the market's side count.
 */
export async function getGetMarketQuotesProxyIx(
   quote: FillBetIxData,
   user: Address,
   mmPrograms: readonly Address[],
): Promise<Instruction> {
   validateFillBetIxData(quote, 'quote');
   const numSides = numSidesForMkt(quote.marketId.mkt);
   if (numSides === undefined) {
      throw new RangeError(`unsupported mkt ${quote.marketId.mkt} for market quotes`);
   }
   const maxMms = Math.min(MAX_NUMBER_OF_MMS_PROXY, maxProxyMmsForMarketQuotes(numSides));
   if (mmPrograms.length === 0 || mmPrograms.length > maxMms) {
      throw new RangeError(
         `mmPrograms.length must be in [1, ${maxMms}] for ${numSides}-side market (mkt=${quote.marketId.mkt})`,
      );
   }
   const perMarketMakerAccounts: { address: Address; role: AccountRole }[] = [];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [eventStatePda] = await getEventStatePda(mmProgram, quote.marketId.eventId);
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, quote.marketId);
      const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
      perMarketMakerAccounts.push(
         ro(mmProgram),
         ro(mmConfigPda),
         ro(eventStatePda),
         ro(marketDataPda),
         rw(mmQuoteBufferPda),
      );
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ro(user), ro(CLOCK_ID),
         ...perMarketMakerAccounts],
      data: encodeAggregatorInstructionData({
         kind: 'getMarketQuotesProxy',
         data: quote,
      }),
   };
}

/**
 * **`get_parlay_quote_proxy`** — CPI each MM `get_quote_parlay`, return `ProxyQuoteData[]` via transaction return data.
 *
 * **Rust:** `get_parlay_quote_proxy::get_parlay_quote_proxy` (`GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR` = 9). Body matches `fill_parlay` (`FillParlayIxData`; `bet_id` unused). Per MM: `3 + 2 × num_legs` accounts.
 *
 * @param quote - Same fields as {@link getFillParlayIx} / {@link FillParlayIxData}.
 * @param user - User pubkey for MM CPI (readonly).
 * @param mmPrograms - MM program ids to query (1..={@link MAX_NUMBER_OF_MMS_PROXY}).
 */
export async function getGetParlayQuoteProxyIx(
   quote: FillParlayIxData,
   user: Address,
   mmPrograms: readonly Address[],
): Promise<Instruction> {
   validateFillParlayIxData(quote, 'quote');
   if (mmPrograms.length === 0 || mmPrograms.length > MAX_NUMBER_OF_MMS_PROXY) {
      throw new RangeError(`mmPrograms.length must be in [1, ${MAX_NUMBER_OF_MMS_PROXY}]`);
   }
   if (quote.numLegs < 2 || quote.numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`quote.numLegs must be in [2, ${MAX_PARLAY_LEGS}]`);
   }
   const perMarketMakerAccounts: { address: Address; role: AccountRole }[] = [];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
      perMarketMakerAccounts.push(ro(mmProgram), ro(mmConfigPda), rw(mmParlayQuoteBufferPda));
      for (let legIdx = 0; legIdx < quote.numLegs; legIdx++) {
         const leg = quote.legs[legIdx]!;
         const [marketDataPda] = await getMmMarketDataPda(mmProgram, leg.marketId);
         const [eventStatePda] = await getEventStatePda(mmProgram, leg.marketId.eventId);
         perMarketMakerAccounts.push(ro(marketDataPda), ro(eventStatePda));
      }
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ro(user), ro(CLOCK_ID),
         ...perMarketMakerAccounts],
      data: encodeAggregatorInstructionData({
         kind: 'getParlayQuoteProxy',
         data: quote,
      }),
   };
}

/**
 * **`fill_parlay`** — CPI MM `get_quote_parlay` / `fill_parlay_quote`, open parlay bet PDA + ATA (no netting; **exactly one** MM).
 *
 * **Rust:** `aggregator::instructions::fill_parlay::fill_parlay` (`FILL_PARLAY_IX_DISCRIMINATOR` = 4). Fixed header matches `fill_bet`; bet PDA seeds are **`["parlay", user, bet_id]`** (not `"bet"`). Per MM: program, config, parlay quote buffer, encumbrance, liability ATA, MM token ATA, then `(market_data, event_state)` × `num_legs`.
 *
 * @param fill - **TS:** {@link FillParlayIxData}. **Rust:** `FillParlayIxData` after router discriminator.
 * @param mmProgram - **TS:** `mmProgram`. **Rust:** `6 + 2 * num_legs` accounts for MM.
 */
export async function getFillParlayIx(
   fill: FillParlayIxData,
   feepayer: Address,
   user: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validateFillParlayIxData(fill, 'fill');
   const userAta = await getAta(user, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [betPda] = await getParlayBetPda(user, fill.betId);
   const betAta = await getAta(betPda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram);
   const liabilityAta = await getAta(
      mmEncumbrancePda,
      MINT_ID,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const mmTokenAta = await getAta(mmConfigPda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const accounts = [
      ws(feepayer),
      rs(user),
      rw(userAta),
      rw(betPda),
      rw(betAta),
      ro(configPda),
      ro(MINT_ID),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SYSTEM_PROGRAM_ID),
      ro(SYSVAR_INSTRUCTIONS_ID),
      ro(CLOCK_ID),
      ro(mmProgram),
      rw(mmConfigPda),
      rw(mmParlayQuoteBufferPda),
      rw(mmEncumbrancePda),
      rw(liabilityAta),
      rw(mmTokenAta),
   ];

   for (let legIdx = 0; legIdx < fill.numLegs; legIdx++) {
      const leg = fill.legs[legIdx]!;
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, leg.marketId);
      const [eventStatePda] = await getEventStatePda(mmProgram, leg.marketId.eventId);
      accounts.push(ro(marketDataPda), ro(eventStatePda));
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts,
      data: encodeAggregatorInstructionData({
         kind: 'fillParlay',
         data: fill,
      }),
   };
}

/**
 * Build a **market-maker `get_quote_parlay`** instruction (`programAddress` = MM program).
 *
 * **Rust:** MM `get_quote_parlay::process` (`GET_QUOTE_PARLAY_IX_DISCRIMINATOR` = 7); accounts: `user`, MM config, parlay quote buffer, then `(market_data, event_state)` × L.
 */
export async function getMmGetQuoteParlayIx(
   quote: MmGetQuoteParlay,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   const numLegs = quote.legs.length;
   validateGetQuoteParlayIxData(
      {
         amount: quote.amount,
         oddsScaled: quote.minOddsScaled,
         numLegs,
         legs: quote.legs,
      },
      'quote',
   );
   const ixData = encodeGetQuoteParlayIxData({
      instructionDiscriminator: MM_GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
      amount: quote.amount,
      oddsScaled: quote.minOddsScaled,
      numLegs,
      legs: quote.legs,
   });
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const accounts: { address: Address; role: AccountRole }[] = [
      ro(user),
      ro(CLOCK_ID),
      ro(mmConfigPda),
      rw(mmParlayQuoteBufferPda),
   ];
   for (const leg of quote.legs) {
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, leg.marketId);
      const [eventStatePda] = await getEventStatePda(mmProgram, leg.marketId.eventId);
      accounts.push(ro(marketDataPda), ro(eventStatePda));
   }
   return {
      programAddress: mmProgram,
      accounts,
      data: ixData,
   };
}

/**
 * Build a **market-maker `get_quote`** instruction (invoked **on the MM program**, not the aggregator router).
 * Used to preview a quote off-chain or from a client; aggregator `fill_bet` performs the same CPI internally.
 *
 * **Rust:** MM program `get_quote` handler (`GET_QUOTE_IX_DISCRIMINATOR` = 5); accounts match CPI slice in `fill_bet.rs` (user, market data, event state, MM config, quote buffer).
 *
 * @param quote - **TS:** {@link MmGetQuote} — amount, min odds (scaled), side, `eventGameState` / sequence, `marketId`. **Rust:** `GetQuoteIxData` (includes MM ix discriminator byte + fields).
 * @param mmProgram - **TS:** `Address` — MM program id (`programAddress` of returned instruction). **Rust:** MM `program_id` for the ix.
 * @param user - **TS:** `Address` — user pubkey passed as first account. **Rust:** first CPI account (readonly).
 * @returns **`Promise<Instruction>`** — `programAddress` = `mmProgram`; five accounts; `data` = encoded MM get-quote payload. **Note:** validates odds, side, market, sequence, and game state before encoding.
 */
export async function getMmGetQuoteIx(
   quote: MmGetQuote,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   validatePositiveU64(quote.amount, 'quote.amount');
   validateU32Bigint(quote.minOddsScaled, 'quote.minOddsScaled');
   if (quote.minOddsScaled <= ODDS_SCALE) {
      throw new RangeError(`quote.minOddsScaled must be > ODDS_SCALE (${ODDS_SCALE})`);
   }
   validateMarketId(quote.marketId, 'quote.marketId');
   validateBetSide(quote.side, quote.marketId.mkt, 'quote.side');
   validateU16(quote.eventStateSequence, 'quote.eventStateSequence');
   if (quote.eventStateSequence === 0) {
      throw new RangeError('quote.eventStateSequence must be > 0');
   }
   validateEventGameState(quote.eventGameState, 'quote.eventGameState');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, quote.marketId);
   const [eventStatePda] = await getEventStatePda(mmProgram, quote.marketId.eventId);
   const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
   const ixData = encodeGetQuoteIxData({
      instructionDiscriminator: MM_GET_QUOTE_IX_DISCRIMINATOR,
      amount: quote.amount,
      oddsScaled: quote.minOddsScaled,
      marketId: quote.marketId,
      side: quote.side,
      eventGameState: quote.eventGameState,
      eventStateSequence: quote.eventStateSequence,
   });
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         ro(CLOCK_ID),
         ro(marketDataPda),
         ro(eventStatePda),
         ro(mmConfigPda),
         rw(mmQuoteBufferPda),
      ],
      data: ixData,
   };
}

/**
 * **`grade_bets`** — admin sets `BetResult` on many bet PDAs (no token movement).
 *
 * **Rust:** `aggregator::instructions::grade_bets::process` (`GRADE_BETS_IX_DISCRIMINATOR` = 5). Data: one `u8` result per bet account (`data.len() == bet_accounts.len()`).
 *
 * @param admin - **TS:** `Address` — config admin signer. **Rust:** `admin` (signer).
 * @param betResults - **TS:** `Uint8Array` — one byte per bet, valid graded `BetResult` discriminant. **Rust:** `&[u8]` same length as bet accounts.
 * @param betAccounts - **TS:** `readonly Address[]` — bet PDA addresses (writable). **Rust:** `bet_accounts @ ..` slice.
 * @returns **`Promise<Instruction>`** — `data` = discriminator + raw `betResults` bytes. Config PDA is readonly second account.
 */
export async function getGradeBetsIx(
   admin: Address,
   betResults: Uint8Array,
   betAccounts: readonly Address[],
): Promise<Instruction> {
   validateGradeBetResults(betResults, 'betResults');
   if (betAccounts.length !== betResults.length) {
      throw new RangeError('betAccounts.length must match betResults.length');
   }
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [rs(admin), ro(configPda), ...betAccounts.map((address) => rw(address))],
      data: encodeAggregatorInstructionData({ kind: 'gradeBets', betResults }),
   };
}

/**
 * **`settle_bet`** — pay winner, release encumbrances to fillers, close bet PDA + bet ATA to feepayer (bet must not be `Pending`).
 *
 * **Rust:** `aggregator::instructions::settle_bet::process` (`SETTLE_BET_IX_DISCRIMINATOR` = 6). Instruction data: none after router discriminator.
 *
 * @param bet - **TS:** {@link BetAccountData} — decoded on-chain bet layout (owner, feepayer, fillers, result, etc.). **Rust:** `BetAccountData` read from `bet_account` account.
 * @param signer - **TS:** `Address` — any signer paying/authorizing the settle flow as implemented on-chain. **Rust:** `signer` (signer).
 * @param betPda - **TS:** `Address` — bet PDA address. **Rust:** `bet_account` (writable PDA owned by aggregator program).
 * @returns **`Promise<Instruction>`** — 9 fixed accounts + 5×5 filler accounts (blank filler uses system program placeholders for the five MM-related slots). **Note:** filler rows must match `bet`’s `filler0`..`filler4` for correct encumbrance/ATA metas.
 */
export async function getSettleBetIx(
   signer: Address,
   betPda: Address,
   bet: BetAccountData,
): Promise<Instruction> {
   validatePositiveU64(bet.betId, 'bet.betId');
   if (bet.result === BetResult.Pending) {
      throw new Error('bet.result must be not Pending');
   }
   const user = bet.owner;
   const betAta = await getAta(betPda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const userAta = await getAta(user, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const baseAccounts = [
      rs(signer),
      rw(betPda),
      rw(betAta),
      rw(bet.feepayer),
      ro(user),
      rw(userAta),
      ro(configPda),
      ro(MINT_ID),
      ro(SPL_TOKEN_PROGRAM_ID),
   ];
   const fillerAccounts: { address: Address; role: AccountRole }[] = [];
   for (const filler of [bet.filler0, bet.filler1, bet.filler2, bet.filler3, bet.filler4]) {
      const row = await settleFillerAccountRow(filler);
      fillerAccounts.push(ro(row[0]!), ro(row[1]!), rw(row[2]!), rw(row[3]!), rw(row[4]!));
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [...baseAccounts, ...fillerAccounts],
      data: encodeAggregatorInstructionData({ kind: 'settleBet' }),
   };
}

/**
 * **`settle_parlay`** — settle a graded parlay bet; same data shape as `settle_bet` (no payload after router discriminator).
 *
 * **Rust:** `aggregator::instructions::settle_parlay::process` (`SETTLE_PARLAY_IX_DISCRIMINATOR` = 7). Instruction data: none after router discriminator.
 *
 * @param parlay - **TS:** {@link ParlayBetAccountData}. **Rust:** `ParlayBetAccountData` from parlay bet PDA.
 * @param signer - **TS:** `Address`. **Rust:** `signer` (signer).
 * @param betPda - **TS:** parlay bet PDA. **Rust:** `bet_account` (writable).
 */
export async function getSettleParlayIx(
   signer: Address,
   betPda: Address,
   parlay: ParlayBetAccountData,
): Promise<Instruction> {
   validatePositiveU64(parlay.betId, 'parlay.betId');
   const user = parlay.owner;
   const betAta = await getAta(betPda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const userAta = await getAta(user, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();

   const [mmConfigPda] = await getMmConfigPda(parlay.fillerAddress);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(parlay.fillerAddress);
   const mmLiabilityTokenAccount = await getAta(mmEncumbrancePda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const mmTokenAccount = await getAta(mmConfigPda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const accounts = [
      rs(signer),
      rw(betPda),
      rw(betAta),
      rw(parlay.feepayer),
      ro(user),
      rw(userAta),
      ro(configPda),
      ro(MINT_ID),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(parlay.fillerAddress),
      ro(mmConfigPda),
      rw(mmEncumbrancePda),
      rw(mmLiabilityTokenAccount),
      rw(mmTokenAccount),
   ];
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts,
      data: encodeAggregatorInstructionData({ kind: 'settleParlay' }),
   };
}

/**
 * **`create_netting_account`** — MM admin creates per-event netting PDA under the aggregator for liability netting.
 *
 * **Rust:** `aggregator::instructions::create_netting_account::process` (`CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR` = 50). Data: `EventId` wire bytes only (after discriminator).
 *
 * @param eventId - **TS:** {@link EventId}. **Rust:** `EventId` decoded from instruction data.
 * @param mmAdmin - **TS:** `Address` — must match MM config admin. **Rust:** `mm_admin` (writable signer).
 * @param mmProgram - **TS:** `Address` — MM program id. **Rust:** `mm_program_account` (executable).
 * @returns **`Promise<Instruction>`** — five accounts (admin, mm config, mm program, netting PDA, system program).
 */
export async function getCreateNettingAccountIx(
   eventId: EventId,
   mmAdmin: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [nettingPda] = await getNettingPda(mmProgram, eventId);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(mmAdmin), ro(mmConfigPda), ro(mmProgram), rw(nettingPda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeAggregatorInstructionData({ kind: 'createNettingAccount', eventId }),
   };
}

/**
 * **`add_line_to_netting_account`** — MM admin adds `(event_id, period, mkt)` line to an existing netting account.
 *
 * **Rust:** `aggregator::instructions::add_line_to_netting_account::process` (`ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR` = 51). Payload: `EventId` + `period: u8` + `mkt: u16` (`AddLineToLiabilityNettingIxData`).
 *
 * @param eventId - **TS:** {@link EventId}. **Rust:** `event_id` in parsed ix data.
 * @param period - **TS:** `number` — `u8` market period. **Rust:** `u8` / `period`.
 * @param mkt - **TS:** `number` — `u16` market index. **Rust:** `u16` / `mkt`.
 * @param admin - **TS:** `Address` — MM admin signer. **Rust:** `admin` (signer).
 * @param mmProgram - **TS:** `Address` — MM program id. **Rust:** `mm_program`.
 * @returns **`Promise<Instruction>`** — four accounts: admin, mm program (readonly), mm config (readonly), netting PDA (writable).
 */
export async function getAddLineToNettingAccountIx(
   eventId: EventId,
   period: number,
   mkt: number,
   admin: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   validateU8(period, 'period');
   validateU16(mkt, 'mkt');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [nettingPda] = await getNettingPda(mmProgram, eventId);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [rs(admin), ro(mmProgram), ro(mmConfigPda), rw(nettingPda)],
      data: encodeAggregatorInstructionData({
         kind: 'addLineToNettingAccount',
         data: { eventId, period, mkt },
      }),
   };
}

/**
 * **`remove_line_from_netting_account`** — MM admin removes a netting line keyed by `(event_id, period, mkt)`.
 *
 * **Rust:** `aggregator::instructions::remove_line_from_netting_account::process` (`REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR` = 52). Same payload shape as add-line.
 *
 * @param eventId - **TS:** {@link EventId}. **Rust:** `event_id`.
 * @param period - **TS:** `number` — `u8`. **Rust:** `u8`.
 * @param mkt - **TS:** `number` — `u16`. **Rust:** `u16`.
 * @param admin - **TS:** `Address`. **Rust:** `admin` (signer).
 * @param mmProgram - **TS:** `Address`. **Rust:** `mm_program`.
 * @returns **`Promise<Instruction>`** — same four-account layout as add-line.
 */
export async function getRemoveLineFromNettingAccountIx(
   eventId: EventId,
   period: number,
   mkt: number,
   admin: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   validateU8(period, 'period');
   validateU16(mkt, 'mkt');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [nettingPda] = await getNettingPda(mmProgram, eventId);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [rs(admin), ro(mmProgram), ro(mmConfigPda), rw(nettingPda)],
      data: encodeAggregatorInstructionData({
         kind: 'removeLineFromNettingAccount',
         data: { eventId, period, mkt },
      }),
   };
}

/**
 * **`close_netting_account`** — MM admin closes netting PDA for an event and returns rent (requires `EventId` in data).
 *
 * **Rust:** `aggregator::instructions::close_netting_account::process` (`CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR` = 53). Data: `EventId` wire bytes after discriminator.
 *
 * @param eventId - **TS:** {@link EventId}. **Rust:** `EventId` from instruction data.
 * @param admin - **TS:** `Address` — MM admin (writable signer). **Rust:** `admin`.
 * @param mmProgram - **TS:** `Address`. **Rust:** `mm_program`.
 * @returns **`Promise<Instruction>`** — five accounts (admin, mm config, mm program, netting PDA, system program) per on-chain ordering.
 */
export async function getCloseNettingAccountIx(
   eventId: EventId,
   admin: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [nettingPda] = await getNettingPda(mmProgram, eventId);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(admin), ro(mmConfigPda), ro(mmProgram), rw(nettingPda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeAggregatorInstructionData({ kind: 'closeNettingAccount', eventId }),
   };
}

/**
 * **`withdraw_from_liability_account`** — MM admin pulls free liability vault balance to the MM collateral token account (subject to encumbrance accounting on-chain).
 *
 * **Rust:** `aggregator::instructions::withdraw_from_liability_account::process` (`WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR` = 100). Data: `amount: u64` (LE) after discriminator.
 *
 * @param amount - **TS:** `bigint` — must fit `u64` and be > 0 where enforced. **Rust:** `u64` read from ix data.
 * @param mmAdmin - **TS:** `Address` — MM admin signer. **Rust:** `mm_admin` (writable signer).
 * @param mmProgram - **TS:** `Address`. **Rust:** `mm_program_account`.
 * @returns **`Promise<Instruction>`** — seven accounts + mint + token program (see Rust module docstring). Liability and MM token ATAs are derived in TS.
 */
export async function getWithdrawFromLiabilityAccountIx(
   amount: bigint,
   mmAdmin: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validatePositiveU64(amount, 'amount');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram);
   const mmLiabilityAta = await getAta(
      mmEncumbrancePda,
      MINT_ID,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const mmTokenAta = await getAta(mmConfigPda, MINT_ID, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(mmAdmin),
         ro(mmProgram),
         rw(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         rw(mmTokenAta),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      data: encodeAggregatorInstructionData({
         kind: 'withdrawFromLiabilityAccount',
         amount,
      }),
   };
}

/**
 * **`force_close_pda`** — dev-only: admin closes an arbitrary PDA owned by the aggregator program and recovers rent.
 *
 * **Rust:** `aggregator::instructions::force_close_pda::process` (`FORCE_CLOSE_PDA_IX_DISCRIMINATOR` = 255). No instruction data after discriminator.
 *
 * @param admin - **TS:** `Address` — config admin (writable signer). **Rust:** `admin` (writable signer).
 * @param pda - **TS:** `Address` — PDA to close. **Rust:** `pda` (writable).
 * @returns **`Promise<Instruction>`** — four accounts: admin, config PDA (readonly), target PDA, system program. **Note:** production deployments should gate or omit this ix.
 */
export async function getForceClosePdaIx(admin: Address, pda: Address): Promise<Instruction> {
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(admin), ro(configPda), rw(pda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeAggregatorInstructionData({ kind: 'forceClosePda' }),
   };
}

export async function getWriteArbitraryDataIx(admin: Address, account: Address, data: Uint8Array): Promise<Instruction> {
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(admin), ro(configPda), rw(account)],
      data: encodeAggregatorInstructionData({ kind: 'writeArbitraryData', data }),
   };
}

/** Tagged router input: wire-ish fields and addresses in one object per `kind`. */
export type AggregatorInstructionInput =
   | { kind: 'initProgram'; admin: Address; recentSlot: bigint }
   | { kind: 'changeConfigStatus'; status: 0 | 1; admin: Address }
   | { kind: 'registerMm'; mmAdmin: Address; mmProgram: Address }
   | { kind: 'deregisterMm'; aggregatorAdmin: Address; mmAdmin: Address; mmProgram: Address }
   | {
        kind: 'fillBet';
        fill: FillBetIxData;
        feepayer: Address;
        user: Address;
        mmPrograms: readonly Address[];
     }
   | {
        kind: 'fillParlay';
        fill: FillParlayIxData;
        feepayer: Address;
        user: Address;
        mmProgram: Address;
     }
   | {
        kind: 'getMarketQuotesProxy';
        quote: FillBetIxData;
        user: Address;
        mmPrograms: readonly Address[];
     }
   | {
        kind: 'gradeBets';
        betResults: Uint8Array;
        admin: Address;
        betAccounts: readonly Address[];
     }
   | { kind: 'settleBet'; bet: BetAccountData; signer: Address; betPda: Address }
   | { kind: 'settleParlay'; parlay: ParlayBetAccountData; signer: Address; betPda: Address }
   | { kind: 'createNettingAccount'; eventId: EventId; mmAdmin: Address; mmProgram: Address }
   | {
        kind: 'addLineToNettingAccount';
        eventId: EventId;
        period: number;
        mkt: number;
        admin: Address;
        mmProgram: Address;
     }
   | {
        kind: 'removeLineFromNettingAccount';
        eventId: EventId;
        period: number;
        mkt: number;
        admin: Address;
        mmProgram: Address;
     }
   | { kind: 'closeNettingAccount'; eventId: EventId; admin: Address; mmProgram: Address }
   | { kind: 'withdrawFromLiabilityAccount'; amount: bigint; mmAdmin: Address; mmProgram: Address }
   | { kind: 'writeArbitraryData'; admin: Address; account: Address; data: Uint8Array }
   | { kind: 'forceClosePda'; admin: Address; pda: Address };

export type AggregatorInstructionKind = AggregatorInstructionInput['kind'];

/**
 * Dispatch **aggregator router** instructions by **`input.kind`**, delegating to the typed `get*Ix` builders.
 *
 * **Rust:** Each variant maps to the corresponding `aggregator` router arm in `lib.rs` (same discriminators as module constants).
 *
 * @param input - **TS:** {@link AggregatorInstructionInput} — discriminated union: `kind` plus the same fields as the matching `get*Ix` function. **Rust:** N/A (client-only helper).
 * @returns **`Promise<Instruction>`** — always `programAddress` = {@link AGGREGATOR_PROGRAM_ID} for router variants. **Note:** does **not** handle {@link getMmGetQuoteIx} (MM program, not router).
 */
export async function getInstructionIx(input: AggregatorInstructionInput, _rpc: Rpc<SolanaRpcApi>): Promise<Instruction> {
   switch (input.kind) {
      case 'initProgram':
         return getInitProgramIx(input.admin, input.recentSlot);
      case 'changeConfigStatus':
         return getChangeConfigStatusIx(input.admin, input.status);
      case 'registerMm':
         return getRegisterMmIx(input.mmAdmin, input.mmProgram);
      case 'deregisterMm':
         return getDeregisterMmIx(input.aggregatorAdmin, input.mmAdmin, input.mmProgram);
      case 'fillBet':
         return getFillBetIx(input.fill, input.feepayer, input.user, input.mmPrograms);
      case 'fillParlay':
         return getFillParlayIx(input.fill, input.feepayer, input.user, input.mmProgram);
      case 'getMarketQuotesProxy':
         return getGetMarketQuotesProxyIx(input.quote, input.user, input.mmPrograms);
      case 'gradeBets':
         return getGradeBetsIx(input.admin, input.betResults, input.betAccounts);
      case 'settleBet':
         return getSettleBetIx(input.signer, input.betPda, input.bet);
      case 'settleParlay':
         return getSettleParlayIx(input.signer, input.betPda, input.parlay);
      case 'createNettingAccount':
         return getCreateNettingAccountIx(input.eventId, input.mmAdmin, input.mmProgram);
      case 'addLineToNettingAccount':
         return getAddLineToNettingAccountIx(
            input.eventId,
            input.period,
            input.mkt,
            input.admin,
            input.mmProgram,
         );
      case 'removeLineFromNettingAccount':
         return getRemoveLineFromNettingAccountIx(
            input.eventId,
            input.period,
            input.mkt,
            input.admin,
            input.mmProgram,
         );
      case 'closeNettingAccount':
         return getCloseNettingAccountIx(input.eventId, input.admin, input.mmProgram);
      case 'withdrawFromLiabilityAccount':
         return getWithdrawFromLiabilityAccountIx(input.amount, input.mmAdmin, input.mmProgram);
      case 'writeArbitraryData':
         return getWriteArbitraryDataIx(input.admin, input.account, input.data);
      case 'forceClosePda':
         return getForceClosePdaIx(input.admin, input.pda);
      default: {
         const _exhaustive: never = input;
         throw new Error(`unknown instruction: ${String(_exhaustive)}`);
      }
   }
}
