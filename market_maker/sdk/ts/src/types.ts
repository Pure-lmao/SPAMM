import type { Address } from '@solana/kit';

/** Wire sizes from `spamm_aggregator` / MM program packed layouts (no padding). */
export const EVENT_ID_WIRE_SIZE = 11;
/** Packed `EventGameState` (`aggregator/program` `other.rs`): 4-byte phase + 4 scores. */
export const EVENT_GAME_STATE_LEN = 8;

/** `update_event_state` payload length (after discriminator byte). `EventId::WIRE_SIZE` + `u16` + `EventGameState`. */
export const UPDATE_EVENT_STATE_IX_PAYLOAD_LEN = EVENT_ID_WIRE_SIZE + 2 + EVENT_GAME_STATE_LEN;
/** `MarketId` wire without `operator` (legacy pre-operator layout; used as a PDA seed). */
export const MARKET_ID_BODY_WIRE_SIZE = EVENT_ID_WIRE_SIZE + 8 + 2 + 1 + 1;
export const MARKET_ID_WIRE_SIZE = MARKET_ID_BODY_WIRE_SIZE + 32;
export const CONFIG_PDA_LEN = 34;
/** `EventStateData` on-chain (`other.rs`). */
export const EVENT_STATE_LEN = 1 + 1 + EVENT_ID_WIRE_SIZE + 2 + EVENT_GAME_STATE_LEN;
export const MM_QUOTE_BUFFER_LEN = 1 + 1 + 32 + MARKET_ID_WIRE_SIZE + 1 + 8 + 4 + EVENT_GAME_STATE_LEN + 2;
export const MM_ACCOUNT_CONFIG_MIN_LEN = 66;
export const INIT_PROGRAM_IX_DATA_LEN = 64;
export const SET_RFQ_SIGNER_IX_DATA_LEN = 32;
export const FILL_RFQ_IX_WIRE_LEN = 9;
/** Full MM `get_quote` ix data (includes leading discriminator). */
export const GET_QUOTE_IX_WIRE_LEN = 1 + 8 + 4 + MARKET_ID_WIRE_SIZE + 1 + EVENT_GAME_STATE_LEN + 2;
export const MAX_PARLAY_LEGS = 5;
export const PARLAY_LEG_WIRE_LEN = MARKET_ID_WIRE_SIZE + 1 + 2 + EVENT_GAME_STATE_LEN + 4 + 1;
export const PARLAY_LEG_TABLE_LEN = MAX_PARLAY_LEGS * PARLAY_LEG_WIRE_LEN;
export const GET_QUOTE_PARLAY_IX_WIRE_LEN = 1 + 8 + 4 + 1 + PARLAY_LEG_TABLE_LEN;
export const FILL_QUOTE_PARLAY_IX_WIRE_LEN = 21;
export const MM_PARLAY_QUOTE_BUFFER_LEN = 2 + 32 + 8 + 4 + 1 + PARLAY_LEG_TABLE_LEN;

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
   None = 0,
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
export const MM_QUOTE_BUFFER_DISCRIMINATOR = 2;

/** MM parlay quote buffer account (`MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR`). */
export const MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR = 3;

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
   legs: readonly ParlayLegWire[];
};

export type GetQuoteParlayIxData = {
   instructionDiscriminator: number;
   amount: bigint;
   oddsScaled: bigint;
   numLegs: number;
   legs: readonly ParlayLegWire[];
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
export const MM_ACCOUNT_CONFIG_DISCRIMINATOR = 1;

export type MmAccountConfig = {
   discriminator: number;
   bump: number;
   admin: Address;
   rfqSigner: Address;
};

/** Event state PDA (`EVENT_STATE_DISCRIMINATOR`). */
export const EVENT_STATE_DISCRIMINATOR = 4;

export type EventStateData = {
   discriminator: number;
   bump: number;
   eventId: EventId;
   sequence: number;
   gameState: EventGameState;
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
   eventGameState: EventGameState;
   eventStateSequence: number;
};

export type InitProgramIxData = {
   admin: Address;
   rfqSigner: Address;
};

export type SetRfqSignerIxData = {
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

/** MM `get_quote_parlay` CPI return wire (`GetParlayQuoteReturnWire`). */
export const PARLAY_QUOTE_RETURN_WIRE_LEN = 8 + 4 + 1 + MAX_PARLAY_LEGS * 4;

export type GetParlayQuoteReturnWire = {
   maxAmount: bigint;
   oddsScaled: bigint;
   numLegs: number;
   legOdds: readonly bigint[];
};

export type DecodedMarketMakerInstruction =
   | { kind: 'updateOracle'; sequence: bigint; odds0: bigint; odds1: bigint; odds2?: bigint }
   | { kind: 'initProgram'; data: InitProgramIxData }
   | { kind: 'setRfqSigner'; data: SetRfqSignerIxData }
   | { kind: 'fillBetRfq'; data: FillRfqIxData }
   | { kind: 'fillParlayRfq'; data: FillRfqIxData }
   | { kind: 'getQuote'; data: GetQuoteIxData }
   | { kind: 'getQuoteParlay'; data: GetQuoteParlayIxData }
   | { kind: 'fillParlayQuote'; data: FillParlayQuoteIxData }
   | { kind: 'initEvent'; eventId: EventId }
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
