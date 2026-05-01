import type { Address, ReadonlyUint8Array } from '@solana/kit';

/** Wire sizes from `aggregator/program` / MM program packed layouts. */
export const EVENT_ID_WIRE_SIZE = 13;

/** `update_event_state` payload length (after discriminator byte). */
export const UPDATE_EVENT_STATE_IX_PAYLOAD_LEN = EVENT_ID_WIRE_SIZE + 2 + 32;
export const MARKET_ID_WIRE_SIZE = 27;
export const CONFIG_PDA_LEN = 34;
export const EVENT_STATE_LEN = 49;
export const MM_QUOTE_BUFFER_LEN = 108;
export const MM_ACCOUNT_CONFIG_MIN_LEN = 34;
export const INIT_PROGRAM_IX_DATA_LEN = 32;
export const GET_QUOTE_IX_WIRE_LEN = 75;

/** `update_oracle_body` ix payload after discriminator: `u32` sequence + `u32` odds (LE). */
export const UPDATE_ORACLE_IX_PAYLOAD_LEN_TWO_OUTCOME = 4 + 4 + 4;
export const UPDATE_ORACLE_IX_PAYLOAD_LEN_THREE_OUTCOME = 4 + 4 + 4 + 4;

/**
 * Oracle PDA body after `init_market`: `discriminator` + `bump` + `sequence` (`u32` LE) + `u32` odds words.
 * Two-outcome markets: **16** bytes; soccer `mkt` 1 / 5 three-way: **20** bytes (+ `odds2`).
 */
export const MM_ORACLE_ACCOUNT_LEN_TWO_OUTCOME = 14;
export const MM_ORACLE_ACCOUNT_LEN_THREE_OUTCOME = 18;

/** Wire `u8` (`state/ids.rs`). */
export enum Sport {
   Soccer = 1,
   AmericanFootball = 2,
   Baseball = 3,
   Basketball = 4,
   IceHockey = 5,
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
};

/** MM quote buffer account (`MM_QUOTE_BUFFER_DISCRIMINATOR`). */
export const MM_QUOTE_BUFFER_DISCRIMINATOR = 2;

export type MmQuoteBuffer = {
   discriminator: number;
   isUsed: number;
   userAddress: Address;
   marketId: MarketId;
   side: number;
   maxAmount: bigint;
   oddsScaled: bigint;
   eventStateHash: ReadonlyUint8Array;
   eventStateSequence: number;
};

/** MM `["config"]` PDA (`MM_ACCOUNT_CONFIG_DISCRIMINATOR`). */
export const MM_ACCOUNT_CONFIG_DISCRIMINATOR = 1;

export type MmAccountConfig = {
   discriminator: number;
   bump: number;
   admin: Address;
};

/** Event state PDA (`EVENT_STATE_DISCRIMINATOR`). */
export const EVENT_STATE_DISCRIMINATOR = 3;

export type EventStateData = {
   discriminator: number;
   bump: number;
   eventId: EventId;
   sequence: number;
   stateHash: ReadonlyUint8Array;
};

/** Oracle / market-data PDA: two `u32` odds (LE). */
export type MmOracleMarketDataTwoOutcome = {
   kind: 'twoOutcome';
   discriminator: number;
   bump: number;
   sequence: bigint;
   odds0: bigint;
   odds1: bigint;
};

/** Oracle / market-data PDA: three `u32` odds (LE). */
export type MmOracleMarketDataThreeOutcome = {
   kind: 'threeOutcome';
   discriminator: number;
   bump: number;
   sequence: bigint;
   odds0: bigint;
   odds1: bigint;
   odds2: bigint;
};

export type MmOracleMarketData = MmOracleMarketDataTwoOutcome | MmOracleMarketDataThreeOutcome;

export type GetQuoteIxData = {
   instructionDiscriminator: number;
   amount: bigint;
   oddsScaled: bigint;
   marketId: MarketId;
   side: number;
   eventStateHash: ReadonlyUint8Array;
   eventStateSequence: number;
};

export type InitProgramIxData = {
   admin: Address;
};

export type MmReturnData = {
   maxAmount: bigint;
   oddsScaled: bigint;
};

export type DecodedMarketMakerInstruction =
   | { kind: 'updateOracle'; sequence: bigint; odds0: bigint; odds1: bigint; odds2?: bigint }
   | { kind: 'initProgram'; data: InitProgramIxData }
   | { kind: 'getQuote'; data: GetQuoteIxData }
   | { kind: 'initEvent'; eventId: EventId }
   | { kind: 'initMarket'; marketId: MarketId; oracleBody: Uint8Array }
   | {
        kind: 'updateEventState';
        eventId: EventId;
        sequence: number;
        stateHash: ReadonlyUint8Array | Uint8Array;
     }
   | { kind: 'closeEvent'; eventId: EventId }
   | { kind: 'closeMarket'; marketId: MarketId }
   | { kind: 'forceClosePda'; };
