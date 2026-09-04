import type { Address } from '@solana/kit';

import { ADDRESS_LEN, MAX_PARLAY_LEGS, MAX_RFQ_PARLAY_LEGS, U32_LEN, U64_LEN } from './constants.js';

export { MAX_PARLAY_LEGS, MAX_RFQ_PARLAY_LEGS };

/** Wire sizes from `spamm_aggregator` / MM program packed layouts (no padding). */
export const EVENT_ID_WIRE_SIZE = 11;
/** Packed `EventGameState` (`aggregator/program` `other.rs`): 4-byte phase + 4 scores. */
export const EVENT_GAME_STATE_LEN = 8;

/** `update_event_state` payload length (after discriminator byte). `EventId::WIRE_SIZE` + `u16` + `EventGameState`. */
export const UPDATE_EVENT_STATE_IX_PAYLOAD_LEN = EVENT_ID_WIRE_SIZE + 2 + EVENT_GAME_STATE_LEN;
/** `MarketId` wire without `operator` (legacy pre-operator layout; used as a PDA seed). */
export const MARKET_ID_BODY_WIRE_SIZE = EVENT_ID_WIRE_SIZE + U64_LEN + 2 + 1 + 1;
export const MARKET_ID_WIRE_SIZE = MARKET_ID_BODY_WIRE_SIZE + ADDRESS_LEN;
/** MM `["config"]` PDA header (`disc` + `bump` + `admin` + `rfq_signer`). Account may be longer. */
export const MM_CONFIG_PDA_HEADER_LEN = 1 + 1 + ADDRESS_LEN + ADDRESS_LEN;

/** `EventStateData` header on-chain (`other.rs`). Account may be longer. */
export const EVENT_STATE_HEADER_LEN = 1 + 1 + EVENT_ID_WIRE_SIZE + 2 + EVENT_GAME_STATE_LEN;
export const MM_QUOTE_BUFFER_LEN =
   1 + 1 + ADDRESS_LEN + MARKET_ID_WIRE_SIZE + 1 + U64_LEN + U32_LEN + EVENT_GAME_STATE_LEN + 2;
export const INIT_PROGRAM_IX_DATA_LEN = 2 * ADDRESS_LEN;
export const FILL_RFQ_IX_WIRE_LEN = 9;
/** Full MM `get_quote` ix data (includes leading discriminator). */
export const GET_QUOTE_IX_WIRE_LEN =
   1 + U64_LEN + U32_LEN + MARKET_ID_WIRE_SIZE + 1 + EVENT_GAME_STATE_LEN + 2;
/** Full MM `fill_quote` ix data (includes leading discriminator `121`). */
export const FILL_QUOTE_IX_WIRE_LEN =
   1 + U64_LEN + U32_LEN + MARKET_ID_WIRE_SIZE + 1 + EVENT_GAME_STATE_LEN + 2 + U64_LEN;
export const GET_CASHOUT_QUOTE_IX_WIRE_LEN =
   1 + U64_LEN + U64_LEN + U64_LEN + MARKET_ID_WIRE_SIZE + 1 + EVENT_GAME_STATE_LEN + 2;
export const FILL_CASHOUT_QUOTE_IX_WIRE_LEN =
   1 + U64_LEN + U64_LEN + MARKET_ID_WIRE_SIZE + 1 + EVENT_GAME_STATE_LEN + 2;
export const PARLAY_LEG_SEL_LEN = MARKET_ID_WIRE_SIZE + 1 + 2 + EVENT_GAME_STATE_LEN;
export const GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN = 1 + U64_LEN + U64_LEN + U64_LEN + 1;
export const getCashoutQuoteParlayIxWireLen = (numLegs: number): number =>
   GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN + numLegs * PARLAY_LEG_SEL_LEN;
export const FILL_CASHOUT_QUOTE_PARLAY_IX_WIRE_LEN = 1 + U64_LEN + U64_LEN;
export const PARLAY_LEG_QUOTED_LEN = PARLAY_LEG_SEL_LEN + U32_LEN;
export const PARLAY_LEG_WIRE_LEN = PARLAY_LEG_QUOTED_LEN + 1;
/** Fixed MM quote buffer table size (quoted legs, padded to MAX_PARLAY_LEGS). */
export const PARLAY_LEG_TABLE_LEN = MAX_PARLAY_LEGS * PARLAY_LEG_QUOTED_LEN;
export const GET_QUOTE_PARLAY_IX_HEADER_LEN = 1 + U64_LEN + U32_LEN + 1;
/** Max MM `get_quote_parlay` ix data (includes leading discriminator `122`). */
/** Max MM `get_quote_parlay` ix data (includes leading discriminator `122`). Prefer {@link getQuoteParlayIxWireLen}. */
export const GET_QUOTE_PARLAY_IX_WIRE_LEN_MAX = GET_QUOTE_PARLAY_IX_HEADER_LEN + MAX_PARLAY_LEGS * PARLAY_LEG_SEL_LEN;
/** @deprecated Use {@link GET_QUOTE_PARLAY_IX_WIRE_LEN_MAX} or {@link getQuoteParlayIxWireLen}. */
export const GET_QUOTE_PARLAY_IX_WIRE_LEN = GET_QUOTE_PARLAY_IX_WIRE_LEN_MAX;
export const getQuoteParlayIxWireLen = (numLegs: number): number =>
   GET_QUOTE_PARLAY_IX_HEADER_LEN + numLegs * PARLAY_LEG_SEL_LEN;
export const FILL_QUOTE_PARLAY_IX_WIRE_LEN = 1 + U64_LEN + U32_LEN + U64_LEN;
/** `MMParlayQuoteBuffer` ZeroPod header (legs follow as trailing bytes). */
export const MM_PARLAY_QUOTE_BUFFER_HEADER_LEN = 2 + ADDRESS_LEN + U64_LEN + U32_LEN + 1;
export const MM_PARLAY_QUOTE_BUFFER_LEN = MM_PARLAY_QUOTE_BUFFER_HEADER_LEN + PARLAY_LEG_TABLE_LEN;

/** Doppler / `Oracle::<[u32; 3]>` payload after discriminator: `u32` sequence + three `u32` odds (LE). Third odds is 0 when unused. */
export const UPDATE_ORACLE_IX_PAYLOAD_LEN = U32_LEN + U32_LEN + U32_LEN + U32_LEN;

/**
 * Oracle PDA after `init_market`: 6-byte header (`disc` + `bump` + `u32` sequence) + three `u32` odds.
 * On-chain space is `6 + max(body, 12)` = **18** bytes. The third odds word may be 0.
 */
export const MM_ORACLE_ACCOUNT_LEN = 18;

/** Wire `u8` (`state/ids.rs`). */
export enum Sport {
   Invalid = 0,
   Soccer = 1,
   AmericanFootball = 2,
   Baseball = 3,
   Basketball = 4,
   IceHockey = 5,
   Tennis = 6,
   Cs2 = 101,
   Dota = 102,
   Lol = 103,
   Valorant = 104,
}

export type EventId = {
   event: bigint;
   league: number;
   sport: Sport;
};

export type MarketId = {
   eventId: EventId;
   player: bigint;
   mkt: number;
   period: number;
   isPregame: boolean;
   operator: Address;
};

/** Packed live snapshot (`aggregator/program` `other.rs`). */
export type EventGameState = {
   gamePhase: string;
   homePrimary: number;
   awayPrimary: number;
   homeSecondary: number;
   awaySecondary: number;
};

/** MM quote buffer account (`MM_QUOTE_BUFFER_DISCRIMINATOR`). */
export const MM_QUOTE_BUFFER_DISCRIMINATOR = 102;

/** MM parlay quote buffer account (`MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR`). */
export const MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR = 103;

export type ParlayLegSel = {
   marketId: MarketId;
   side: number;
   eventStateSequence: number;
   eventGameState: EventGameState;
};

export type ParlayLegQuoted = {
   marketId: MarketId;
   side: number;
   eventStateSequence: number;
   eventGameState: EventGameState;
   oddsScaled: bigint;
};

export type ParlayLegWire = {
   marketId: MarketId;
   side: number;
   eventStateSequence: number;
   eventGameState: EventGameState;
   oddsScaled: bigint;
   result: number;
};

export type MmParlayQuoteBuffer = {
   discriminator: number;
   isUsed: number;
   userAddress: Address;
   maxAmount: bigint;
   oddsScaled: bigint;
   numLegs: number;
   legs: readonly ParlayLegQuoted[];
};

export type GetQuoteParlayIxData = {
   instructionDiscriminator: number;
   amount: bigint;
   oddsScaled: bigint;
   numLegs: number;
   legs: readonly ParlayLegSel[];
};

export type FillParlayQuoteIxData = {
   instructionDiscriminator: number;
   amountToFill: bigint;
   oddsScaled: bigint;
   amountToSend: bigint;
};

export type MmQuoteBuffer = {
   discriminator: number;
   isUsed: number;
   userAddress: Address;
   marketId: MarketId;
   side: number;
   maxAmount: bigint;
   oddsScaled: bigint;
   eventGameState: EventGameState;
   eventStateSequence: number;
};

/** MM `["config"]` PDA (`MM_ACCOUNT_CONFIG_DISCRIMINATOR`). */
export const MM_ACCOUNT_CONFIG_DISCRIMINATOR = 101;

export type MmAccountConfig = {
   discriminator: number;
   bump: number;
   admin: Address;
   rfqSigner: Address;
};

/** Event state PDA (`EVENT_STATE_DISCRIMINATOR`). */
export const EVENT_STATE_DISCRIMINATOR = 104;

/** MM market data PDA body (`MM_MARKET_DATA_PDA_DISCRIMINATOR`). */
export const MM_MARKET_DATA_PDA_DISCRIMINATOR = 100;

export type EventStateData = {
   discriminator: number;
   bump: number;
   eventId: EventId;
   sequence: number;
   gameState: EventGameState;
};

/** Oracle / market-data PDA: 6-byte header + three `u32` LE odds (third may be 0). */
export type MmOracleMarketData = {
   discriminator: number;
   bump: number;
   sequence: bigint;
   odds0: bigint;
   odds1: bigint;
   odds2: bigint;
};

export type GetQuoteIxData = {
   instructionDiscriminator: number;
   amount: bigint;
   oddsScaled: bigint;
   marketId: MarketId;
   side: number;
   eventGameState: EventGameState;
   eventStateSequence: number;
};

export type FillQuoteIxData = {
   instructionDiscriminator: number;
   amountToFill: bigint;
   oddsScaled: bigint;
   marketId: MarketId;
   side: number;
   eventGameState: EventGameState;
   eventStateSequence: number;
   amountToSend: bigint;
};

export type GetCashoutQuoteIxData = {
   instructionDiscriminator: number;
   amount: bigint;
   payout: bigint;
   minPayout: bigint;
   marketId: MarketId;
   side: number;
   eventGameState: EventGameState;
   eventStateSequence: number;
};

export type FillCashoutQuoteIxData = {
   instructionDiscriminator: number;
   amount: bigint;
   amountToSend: bigint;
   marketId: MarketId;
   side: number;
   eventGameState: EventGameState;
   eventStateSequence: number;
};

export type GetCashoutQuoteParlayIxData = {
   instructionDiscriminator: number;
   amount: bigint;
   payout: bigint;
   minPayout: bigint;
   numLegs: number;
   legs: ParlayLegSel[];
};

export type FillCashoutQuoteParlayIxData = {
   instructionDiscriminator: number;
   amount: bigint;
   amountToSend: bigint;
};

export type InitProgramIxData = {
   admin: Address;
   rfqSigner: Address;
};

export type FillRfqIxData = {
   instructionDiscriminator: number;
   amountToSend: bigint;
};

export type MmReturnData = {
   maxAmount: bigint;
   oddsScaled: bigint;
};

export const PARLAY_QUOTE_RETURN_HEADER_LEN = U64_LEN + U32_LEN + 1;
/** Max parlay quote return wire size. */
export const PARLAY_QUOTE_RETURN_WIRE_LEN = PARLAY_QUOTE_RETURN_HEADER_LEN + MAX_PARLAY_LEGS * U32_LEN;
export const parlayQuoteReturnWireLen = (numLegs: number): number =>
   PARLAY_QUOTE_RETURN_HEADER_LEN + numLegs * U32_LEN;

export type GetParlayQuoteReturnWire = {
   maxAmount: bigint;
   oddsScaled: bigint;
   numLegs: number;
   legOdds: readonly bigint[];
};

export type DecodedMarketMakerInstruction =
   | { kind: 'updateOracle'; sequence: bigint; odds0: bigint; odds1: bigint; odds2: bigint }
   | { kind: 'initProgram'; data: InitProgramIxData }
   | { kind: 'setRfqSigner' }
   | { kind: 'fillBetRfq'; data: FillRfqIxData }
   | { kind: 'fillParlayRfq'; data: FillRfqIxData }
   | { kind: 'getQuote'; data: GetQuoteIxData }
   | { kind: 'fillQuote'; data: FillQuoteIxData }
   | { kind: 'getQuoteParlay'; data: GetQuoteParlayIxData }
   | { kind: 'fillParlayQuote'; data: FillParlayQuoteIxData }
   | { kind: 'getCashoutQuote'; data: GetCashoutQuoteIxData }
   | { kind: 'fillCashoutQuote'; data: FillCashoutQuoteIxData }
   | { kind: 'getCashoutQuoteParlay'; data: GetCashoutQuoteParlayIxData }
   | { kind: 'fillCashoutQuoteParlay'; data: FillCashoutQuoteParlayIxData }
   | { kind: 'fillCashoutRfq'; data: FillRfqIxData }
   | { kind: 'fillParlayCashoutRfq'; data: FillRfqIxData }
   | { kind: 'initEvent'; eventId: EventId; eventBody?: Uint8Array }
   | { kind: 'initMarket'; marketId: MarketId; oracleBody: Uint8Array }
   | {
        kind: 'updateEventState';
        eventId: EventId;
        sequence: number;
        gameState: EventGameState;
     }
   | { kind: 'closeEvent'; eventId: EventId }
   | { kind: 'closeMarket'; marketId: MarketId }
   | { kind: 'writeArbitraryData'; data: Uint8Array }
   | { kind: 'forceClosePda' };
