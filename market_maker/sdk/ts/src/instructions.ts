import { AccountRole, type Instruction } from '@solana/instructions';
import type { Address } from '@solana/kit';

import { MINT_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from './constants.js';
import {
   encodeFillParlayQuoteIxData,
   encodeGetQuoteIxData,
   encodeGetQuoteParlayIxData,
   encodeMarketMakerInstructionData,
   FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
   GET_QUOTE_IX_DISCRIMINATOR,
   GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
} from './codex.js';
import {
   getAta,
   getEventStatePda,
   getMmConfigPda,
   getMmMarketDataPda,
   getMmParlayQuoteBufferPda,
   getMmQuoteBufferPda,
} from './helpers.js';
import type {
   EventGameState,
   EventId,
   FillParlayQuoteIxData,
   GetQuoteIxData,
   GetQuoteParlayIxData,
   MarketId,
   ParlayLegWire,
} from './types.js';
import {
   validateEventGameState,
   validateEventId,
   validateFillParlayQuoteIxData,
   validateGetQuoteIxData,
   validateGetQuoteParlayIxData,
   validateMarketId,
   validateOdds,
   validateU16,
   validateU32Bigint,
} from './validate.js';

export {
   CLOSE_EVENT_IX_DISCRIMINATOR,
   CLOSE_MARKET_IX_DISCRIMINATOR,
   FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
   GET_QUOTE_IX_DISCRIMINATOR,
   GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
   INIT_EVENT_IX_DISCRIMINATOR,
   INIT_MARKET_IX_DISCRIMINATOR,
   INIT_PROGRAM_IX_DISCRIMINATOR,
   UPDATE_EVENT_STATE_IX_DISCRIMINATOR,
} from './codex.js';

/**
 * Payload for MM **`get_quote`** (same wire as aggregator CPI `GetQuoteIxData`).
 *
 * **Rust:** `GetQuoteIxPayload` / `GetQuoteIxData` on the MM program (`GET_QUOTE_IX_DISCRIMINATOR` = 5).
 */
export type MmGetQuote = {
   amount: bigint;
   minOddsScaled: bigint;
   side: number;
   eventGameState: EventGameState;
   eventStateSequence: number;
   marketId: MarketId;
};

/** Leg table for MM **`get_quote_parlay`** (matches aggregator `GetQuoteParlayIxData.legs`). */
export type MmGetQuoteParlay = {
   amount: bigint;
   minOddsScaled: bigint;
   legs: readonly ParlayLegWire[];
};

const ro = (address: Address) => ({ address, role: AccountRole.READONLY });
const rw = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const ws = (address: Address) => ({ address, role: AccountRole.WRITABLE_SIGNER });

/**
 * **`init_program`** — MM config PDA, single-leg quote buffer PDA, parlay quote buffer PDA, MM collateral ATA (authority = config PDA).
 *
 * **Rust:** `market_maker::instructions::init_program` (`INIT_PROGRAM_IX_DISCRIMINATOR` = 1). `admin` in data must equal `feepayer`.
 */
export async function getInitProgramIx(feepayer: Address, mmProgram: Address): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(mmProgram);
   const [quoteBuf] = await getMmQuoteBufferPda(mmProgram);
   const [parlayQuoteBuf] = await getMmParlayQuoteBufferPda(mmProgram);
   const mmTokenAta = await getAta(configPda);
   return {
      programAddress: mmProgram,
      accounts: [
         ws(feepayer),
         rw(configPda),
         rw(quoteBuf),
         rw(parlayQuoteBuf),
         rw(mmTokenAta),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      data: encodeMarketMakerInstructionData({
         kind: 'initProgram',
         data: { admin: feepayer },
      }),
   };
}

/**
 * **`update_oracle_body`** — update the oracle body for a market.
 *
 * **Rust:** `update_oracle_body::process` (discriminator 0).
 */
export async function getUpdateOracleIx(auth: Address, mmProgram: Address, marketId: MarketId, sequence: bigint, odds0: bigint, odds1: bigint, odds2?: bigint): Promise<Instruction> {
   validateMarketId(marketId, 'marketId');
   validateU32Bigint(sequence, 'sequence');
   validateOdds(odds0, 'odds0');
   validateOdds(odds1, 'odds1');
   if (odds2 !== undefined) {
      validateOdds(odds2, 'odds2');
   }
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, marketId);
   return {
      programAddress: mmProgram,
      accounts: [ws(auth), rw(marketDataPda)],
      data: encodeMarketMakerInstructionData({ kind: 'updateOracle', sequence, odds0, odds1, odds2 }),
   };
}

/**
 * **`init_event`** — create `["event_state", event_id]` PDA.
 *
 * **Rust:** `init_event::process` (discriminator 9).
 */
export async function getInitEventIx(feepayer: Address, eventId: EventId, mmProgram: Address): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   const [configPda] = await getMmConfigPda(mmProgram);
   const [eventStatePda] = await getEventStatePda(mmProgram, eventId);
   return {
      programAddress: mmProgram,
      accounts: [ws(feepayer), ro(configPda), rw(eventStatePda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeMarketMakerInstructionData({ kind: 'initEvent', eventId }),
   };
}

/**
 * **`update_event_state`** — set `sequence` and `game_state` on the event-state PDA (admin).
 *
 * **Rust:** `update_event_state::process` (discriminator **13**).
 */
export async function getUpdateEventStateIx(
   feepayer: Address,
   mmProgram: Address,
   eventId: EventId,
   sequence: number,
   gameState: EventGameState,
): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   validateU16(sequence, 'sequence');
   validateEventGameState(gameState, 'gameState');
   const [configPda] = await getMmConfigPda(mmProgram);
   const [eventStatePda] = await getEventStatePda(mmProgram, eventId);
   return {
      programAddress: mmProgram,
      accounts: [ws(feepayer), ro(configPda), rw(eventStatePda)],
      data: encodeMarketMakerInstructionData({ kind: 'updateEventState', eventId, sequence, gameState }),
   };
}

/**
 * **`init_market`** — create market-data PDA `["market_data", market_id_wire]`; instruction tail is `market_id` + oracle odds body (8 or 12 bytes).
 *
 * **Rust:** `init_market::process` (discriminator 10).
 */
export async function getInitMarketIx(
   feepayer: Address,
   mmProgram: Address,
   marketId: MarketId,
   oracleBody: Uint8Array,
): Promise<Instruction> {
   validateMarketId(marketId, 'marketId');
   if (oracleBody.length !== 8 && oracleBody.length !== 12) {
      throw new RangeError('oracleBody must be 8 bytes (2×u32) or 12 bytes (3×u32)');
   }
   const [configPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, marketId);
   return {
      programAddress: mmProgram,
      accounts: [ws(feepayer), ro(configPda), rw(marketDataPda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeMarketMakerInstructionData({ kind: 'initMarket', marketId, oracleBody }),
   };
}

/**
 * **`close_event`** — close event-state PDA.
 *
 * **Rust:** `close_event::process` (discriminator 11).
 */
export async function getCloseEventIx(auth: Address, mmProgram: Address, eventId: EventId): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   const [configPda] = await getMmConfigPda(mmProgram);
   const [eventStatePda] = await getEventStatePda(mmProgram, eventId);
   return {
      programAddress: mmProgram,
      accounts: [ws(auth), ro(configPda), rw(eventStatePda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeMarketMakerInstructionData({ kind: 'closeEvent', eventId }),
   };
}

/**
 * **`close_market`** — close market-data PDA for `market_id` (trailing ix bytes ignored on-chain).
 *
 * **Rust:** `close_market::process` (discriminator 12).
 */
export async function getCloseMarketIx(auth: Address, mmProgram: Address, marketId: MarketId): Promise<Instruction> {
   validateMarketId(marketId, 'marketId');
   const [configPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, marketId);
   return {
      programAddress: mmProgram,
      accounts: [ws(auth), ro(configPda), rw(marketDataPda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeMarketMakerInstructionData({ kind: 'closeMarket', marketId }),
   };
}

/**
 * **`get_quote`** — MM program entry; second account is the `market_data` PDA (matches aggregator `getMmMarketDataPda`).
 *
 * **Rust:** `get_quote::process` (`GET_QUOTE_IX_DISCRIMINATOR` = 5).
 */
export async function getMmGetQuoteIx(
   quote: MmGetQuote,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   const data: GetQuoteIxData = {
      instructionDiscriminator: GET_QUOTE_IX_DISCRIMINATOR,
      amount: quote.amount,
      oddsScaled: quote.minOddsScaled,
      marketId: quote.marketId,
      side: quote.side,
      eventGameState: quote.eventGameState,
      eventStateSequence: quote.eventStateSequence,
   };
   validateGetQuoteIxData(data, 'quote');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, quote.marketId);
   const [eventStatePda] = await getEventStatePda(mmProgram, quote.marketId.eventId);
   const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
   const ixData = encodeGetQuoteIxData(data);
   return {
      programAddress: mmProgram,
      accounts: [ro(user), ro(marketDataPda), ro(eventStatePda), ro(mmConfigPda), rw(mmQuoteBufferPda)],
      data: ixData,
   };
}

/**
 * **`get_quote_parlay`** — MM program; combined parlay quote into parlay quote buffer.
 *
 * **Rust:** `get_quote_parlay::process` (`GET_QUOTE_PARLAY_IX_DISCRIMINATOR` = 7).
 */
export async function getMmGetQuoteParlayIx(
   quote: MmGetQuoteParlay,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   const numLegs = quote.legs.length;
   const data: GetQuoteParlayIxData = {
      instructionDiscriminator: GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
      amount: quote.amount,
      oddsScaled: quote.minOddsScaled,
      numLegs,
      legs: quote.legs,
   };
   validateGetQuoteParlayIxData(data, 'quote');
   const ixData = encodeGetQuoteParlayIxData(data);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const accounts: { address: Address; role: AccountRole }[] = [
      ro(user),
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
 * **`fill_parlay_quote`** — consume parlay quote buffer (aggregator CPI order). **`liabilityAta`** is the MM liability vault ATA (typically derived with the aggregator encumbrance PDA as owner).
 *
 * **Rust:** `fill_parlay_quote::process` (`FILL_QUOTE_PARLAY_IX_DISCRIMINATOR` = 8).
 */
export async function getMmFillParlayQuoteIx(
   params: Omit<FillParlayQuoteIxData, 'instructionDiscriminator'>,
   mmProgram: Address,
   user: Address,
   liabilityAta: Address,
): Promise<Instruction> {
   const full: FillParlayQuoteIxData = {
      instructionDiscriminator: FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
      ...params,
   };
   validateFillParlayQuoteIxData(full, 'fill');
   const ixData = encodeFillParlayQuoteIxData(full);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const mmTokenAta = await getAta(mmConfigPda);
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         rw(mmConfigPda),
         rw(mmParlayQuoteBufferPda),
         rw(mmTokenAta),
         rw(liabilityAta),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      data: ixData,
   };
}

export async function getForceClosePdaIx(auth: Address, mmProgram: Address, pda: Address): Promise<Instruction> {
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   return {
      programAddress: mmProgram,
      accounts: [ws(auth), ro(mmConfigPda), rw(pda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeMarketMakerInstructionData({ kind: 'forceClosePda' }),
   };
}

export type MarketMakerInstructionInput =
   | {
        kind: 'updateOracleBody';
        auth: Address;
        mmProgram: Address;
        marketId: MarketId;
        sequence: bigint;
        odds0: bigint;
        odds1: bigint;
        odds2?: bigint;
     }
   | { kind: 'initProgram'; feepayer: Address; mmProgram: Address }
   | { kind: 'initEvent'; feepayer: Address; eventId: EventId; mmProgram: Address }
   | {
        kind: 'updateEventState';
        feepayer: Address;
        mmProgram: Address;
        eventId: EventId;
        sequence: number;
        gameState: EventGameState;
     }
   | {
        kind: 'initMarket';
        feepayer: Address;
        mmProgram: Address;
        marketId: MarketId;
        oracleBody: Uint8Array;
     }
   | { kind: 'closeEvent'; auth: Address; eventId: EventId; mmProgram: Address }
   | { kind: 'closeMarket'; auth: Address; marketId: MarketId; mmProgram: Address }
   | { kind: 'getQuote'; quote: MmGetQuote; mmProgram: Address; user: Address }
   | { kind: 'getQuoteParlay'; quote: MmGetQuoteParlay; mmProgram: Address; user: Address }
   | {
        kind: 'fillParlayQuote';
        params: Omit<FillParlayQuoteIxData, 'instructionDiscriminator'>;
        mmProgram: Address;
        user: Address;
        liabilityAta: Address;
     }
   | { kind: 'forceClosePda'; auth: Address; pda: Address; mmProgram: Address };

export type MarketMakerInstructionKind = MarketMakerInstructionInput['kind'];

/**
 * Dispatch MM program instructions by `input.kind` (excludes `fill_quote` and Doppler oracle `0`).
 */
export async function getInstructionIx(input: MarketMakerInstructionInput): Promise<Instruction> {
   switch (input.kind) {
      case 'updateOracleBody':
         return getUpdateOracleIx(
            input.auth,
            input.mmProgram,
            input.marketId,
            input.sequence,
            input.odds0,
            input.odds1,
            input.odds2,
         );
      case 'initProgram':
         return getInitProgramIx(input.feepayer, input.mmProgram);
      case 'initEvent':
         return getInitEventIx(input.feepayer, input.eventId, input.mmProgram);
      case 'updateEventState':
         return getUpdateEventStateIx(
            input.feepayer,
            input.mmProgram,
            input.eventId,
            input.sequence,
            input.gameState,
         );
      case 'initMarket':
         return getInitMarketIx(input.feepayer, input.mmProgram, input.marketId, input.oracleBody);
      case 'closeEvent':
         return getCloseEventIx(input.auth, input.mmProgram, input.eventId);
      case 'closeMarket':
         return getCloseMarketIx(input.auth, input.mmProgram, input.marketId);
      case 'getQuote':
         return getMmGetQuoteIx(input.quote, input.mmProgram, input.user);
      case 'getQuoteParlay':
         return getMmGetQuoteParlayIx(input.quote, input.mmProgram, input.user);
      case 'fillParlayQuote':
         return getMmFillParlayQuoteIx(input.params, input.mmProgram, input.user, input.liabilityAta);
      case 'forceClosePda':
         return getForceClosePdaIx(input.auth, input.mmProgram, input.pda);
      default: {
         const _exhaustive: never = input;
         throw new Error(`unknown instruction: ${String(_exhaustive)}`);
      }
   }
}
