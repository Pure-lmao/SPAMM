import type { Address } from '@solana/kit';

import { MAX_PARLAY_LEGS } from './constants.js';

export { MAX_PARLAY_LEGS };

/** Wire sizes from `aggregator/program` packed layouts (`state/ids.rs`, `ZeroPodFixed::SIZE`). */
export const EVENT_ID_WIRE_SIZE = 11;
/** `MarketId`: `EventId` + `player: u64` + `mkt: u16` + `period: u8` + `is_pregame: u8`. */
export const MARKET_ID_WIRE_SIZE = EVENT_ID_WIRE_SIZE + 8 + 2 + 1 + 1;
/** Packed `EventGameState` (`other.rs`): 4-byte phase + 4 scores. */
export const EVENT_GAME_STATE_LEN = 8;
/** `FillBetIxData` packed wire size (see `fill_bet.rs`). */
export const FILL_BET_IX_DATA_LEN = 8 + MARKET_ID_WIRE_SIZE + 1 + 8 + 4 + 2 + EVENT_GAME_STATE_LEN;
export const PARLAY_LEG_WIRE_LEN = MARKET_ID_WIRE_SIZE + 1 + 2 + EVENT_GAME_STATE_LEN;
export const PARLAY_LEG_TABLE_LEN = MAX_PARLAY_LEGS * PARLAY_LEG_WIRE_LEN;
export const FILL_PARLAY_IX_DATA_LEN = 8 + 8 + 4 + 1 + PARLAY_LEG_TABLE_LEN;
export const ADD_LINE_TO_LIABILITY_NETTING_IX_LEN = EVENT_ID_WIRE_SIZE + 1 + 2;
export const REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN = ADD_LINE_TO_LIABILITY_NETTING_IX_LEN;
export const CONFIG_PDA_LEN = 34;
/** `EventStateData` on-chain (`other.rs`); `eventId` wire is 11 bytes (same as `getEventIdEncoder` / Rust `EventId`). */
export const EVENT_STATE_LEN = 1 + 1 + 11 + 2 + EVENT_GAME_STATE_LEN;
export const MM_QUOTE_BUFFER_LEN =
   1 + 1 + 32 + MARKET_ID_WIRE_SIZE + 1 + 8 + 4 + EVENT_GAME_STATE_LEN + 2;
export const MM_PARLAY_QUOTE_BUFFER_LEN = 2 + 32 + 8 + 4 + 1 + PARLAY_LEG_TABLE_LEN;
export const NETTING_HEADER_LEN = 1 + 1 + EVENT_ID_WIRE_SIZE + 8 + 8 + 8 + 1;
export const NETTING_LINE_LEN = 1 + 2 + 8 + 8;
export const NETTING_DEFAULT_LINE_CAPACITY = 10;
export const NETTING_ACCOUNT_ALLOC_LEN =
   NETTING_HEADER_LEN + NETTING_DEFAULT_LINE_CAPACITY * NETTING_LINE_LEN;
export const BET_FILLER_WIRE_LEN = 53;
export const BET_ACCOUNT_LEN =
   1 +
   1 +
   32 +
   32 +
   8 +
   MARKET_ID_WIRE_SIZE +
   1 +
   8 +
   8 +
   2 +
   EVENT_GAME_STATE_LEN +
   1 +
   5 * BET_FILLER_WIRE_LEN;
export const PARLAY_BET_ACCOUNT_DISCRIMINATOR = 2;
export const PARLAY_BET_ACCOUNT_LEN = 124 + PARLAY_LEG_TABLE_LEN;
export const MM_ENCUMBRANCE_PDA_LEN = 10;
export const MM_ACCOUNT_CONFIG_MIN_LEN = 34;
export const MM_MARKET_DATA_PDA_MIN_LEN = 2;
export const MM_LIST_HEADER_LEN = 3;
export const GET_QUOTE_IX_WIRE_LEN =
   1 + 8 + 4 + MARKET_ID_WIRE_SIZE + 1 + EVENT_GAME_STATE_LEN + 2;
/** Full MM `get_quote_parlay` ix data (includes leading discriminator `7`). */
export const GET_QUOTE_PARLAY_IX_WIRE_LEN = 1 + 8 + 4 + 1 + PARLAY_LEG_TABLE_LEN;
export const FILL_QUOTE_IX_WIRE_LEN =
   1 + 8 + 4 + MARKET_ID_WIRE_SIZE + 1 + EVENT_GAME_STATE_LEN + 2 + 8;
/** Full MM `fill_parlay_quote` ix data (includes leading discriminator `8`). */
export const FILL_QUOTE_PARLAY_IX_WIRE_LEN = 21;
export const MM_RETURN_DATA_LEN = 12;

/** Wire `u8` (`state/ids.rs`). */
export enum Sport {
   None = 0,
   Soccer = 1,
   AmericanFootball = 2,
   Baseball = 3,
   Basketball = 4,
   IceHockey = 5,
}

/** Wire `u8` (`account_bet.rs` `BetResult`). */
export enum BetResult {
   Pending = 0,
   Won = 1,
   Lost = 2,
   HalfWon = 3,
   HalfLost = 4,
   Push = 5,
   Cancelled = 6,
   RolledBack = 7,
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

export type BetFiller = {
   mmAddress: Address;
   amount: bigint;
   oddsScaled: bigint;
   isPotentiallyNetted: boolean;
   encumbranceDelta: bigint;
};

/**
 * On-chain bet account body (`BET_ACCOUNT_DISCRIMINATOR`).
 * Wire layout matches `BetAccountDataZc` field order (see `account_bet.rs` `to_zc`).
 */
export const BET_ACCOUNT_DISCRIMINATOR = 1;

export type BetAccountData = {
   discriminator: number;
   bump: number;
   owner: Address;
   feepayer: Address;
   betId: bigint;
   marketId: MarketId;
   side: number;
   amount: bigint;
   payout: bigint;
   eventStateSequence: number;
   eventGameState: EventGameState;
   result: BetResult;
   filler0: BetFiller;
   filler1: BetFiller;
   filler2: BetFiller;
   filler3: BetFiller;
   filler4: BetFiller;
};

/** Wire layout matches `ParlayBetAccountData` (`account_parlay_bet.rs`). */
export type ParlayBetAccountData = {
   discriminator: number;
   bump: number;
   owner: Address;
   feepayer: Address;
   betId: bigint;
   amount: bigint;
   payout: bigint;
   fillerAddress: Address;
   result: BetResult;
   numLegs: number;
   /** Full wire table (MAX_PARLAY_LEGS slots); only indices `0..numLegs-1` are meaningful on-chain. */
   legs: readonly ParlayLegWire[];
};

/**
 * Netting PDA header (`NETTING_PDA_DISCRIMINATOR`).
 * Lines follow for `numberOfLines` rows, each `NETTING_LINE_LEN` bytes, up to account size.
 */
export const NETTING_PDA_DISCRIMINATOR = 6;

export type NettingPdaDataHeader = {
   discriminator: number;
   bump: number;
   eventId: EventId;
   home: bigint;
   away: bigint;
   draw: bigint;
   numberOfLines: number;
};

export type NettingLine = {
   period: number;
   mkt: number;
   outcome0: bigint;
   outcome1: bigint;
};

export type NettingPdaAccountData = NettingPdaDataHeader & {
   lines: NettingLine[];
};

/** MM quote buffer account (`MM_QUOTE_BUFFER_DISCRIMINATOR`). */
export const MM_QUOTE_BUFFER_DISCRIMINATOR = 2;

/** MM parlay quote buffer account (`MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR`). */
export const MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR = 3;

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

export type ParlayLegWire = {
   marketId: MarketId;
   side: number;
   eventStateSequence: number;
   eventGameState: EventGameState;
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

/** Aggregator config PDA (`CONFIG_PDA_DISCRIMINATOR`). */
export const CONFIG_PDA_DISCRIMINATOR = 2;

export type ConfigPdaData = {
   discriminator: number;
   status: number;
   authority: Address;
};

/** MM list PDA header (`MM_LIST_PDA_DISCRIMINATOR`). */
export const MM_LIST_PDA_DISCRIMINATOR = 3;

export type MmListPdaHeader = {
   discriminator: number;
   numberOfMms: number;
};

export type MmListPdaData = MmListPdaHeader & {
   mmProgramAddresses: Address[];
};

/** Event state PDA (`EVENT_STATE_DISCRIMINATOR`). */
export const EVENT_STATE_DISCRIMINATOR = 4;

export type EventGameState = {
   gamePhase: string;
   homePrimary: number;
   awayPrimary: number;
   homeSecondary: number;
   awaySecondary: number;
};

export type EventStateData = {
   discriminator: number;
   bump: number;
   eventId: EventId;
   sequence: number;
   gameState: EventGameState;
};

/** MM market data PDA body (`MM_MARKET_DATA_PDA_DISCRIMINATOR`). */
export const MM_MARKET_DATA_PDA_DISCRIMINATOR = 0;

export type MmMarketDataPdaData = {
   discriminator: number;
   bump: number;
};

/** MM encumbrance PDA (`MM_ENCUMBRANCE_PDA_DISCRIMINATOR`). */
export const MM_ENCUMBRANCE_PDA_DISCRIMINATOR = 5;

export type MmEncumbrancePdaData = {
   discriminator: number;
   bump: number;
   encumbrance: bigint;
};

/** MM `["config"]` PDA under the SPAMM program (`MM_ACCOUNT_CONFIG_DISCRIMINATOR`). */
export const MM_ACCOUNT_CONFIG_DISCRIMINATOR = 1;

export type MmAccountConfig = {
   discriminator: number;
   bump: number;
   admin: Address;
};

export type MmReturnData = {
   maxAmount: bigint;
   oddsScaled: bigint;
};

/** One MM quote from `get_quote_proxy` / `get_parlay_quote_proxy` return data (`ProxyQuoteData` on-chain). */
export type ProxyQuoteData = {
   mmAddress: Address;
   maxAmount: bigint;
   oddsScaled: bigint;
};

/** `state::mm_quote::PROXY_QUOTE_DATA_LEN` — `repr(C)` size of one `ProxyQuoteData`. */
export const PROXY_QUOTE_DATA_LEN = 44;

/** All side odds for one MM from `get_market_quotes_proxy` (index = side). */
export type ProxyMarketMmQuotes = {
   mmAddress: Address;
   oddsScaled: readonly bigint[];
};

/** `ProxyMarketSideOdds` wire size (`u32` odds per side). */
export const PROXY_MARKET_SIDE_ODDS_WIRE_LEN = 4;
export const MARKET_QUOTES_PROXY_RETURN_MAX = 1024;

export type FillBetIxData = {
   betId: bigint;
   marketId: MarketId;
   side: number;
   amount: bigint;
   minOddsScaled: bigint;
   eventStateSequence: number;
   eventGameState: EventGameState;
};

/** Router body for `fill_parlay` (after leading discriminator `4`). `legs.length` must equal `numLegs`. */
export type FillParlayIxData = {
   betId: bigint;
   amount: bigint;
   minOddsScaled: bigint;
   numLegs: number;
   legs: readonly ParlayLegWire[];
};

export type AddLineToNettingIxData = {
   eventId: EventId;
   period: number;
   mkt: number;
};

export type RemoveLineFromNettingIxData = AddLineToNettingIxData;

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

export type DecodedAggregatorInstruction =
   | { kind: 'initProgram'; recentSlot: bigint }
   | { kind: 'changeConfigStatus'; status: 0 | 1 }
   | { kind: 'registerMm' }
   | { kind: 'deregisterMm' }
   | { kind: 'fillBet'; data: FillBetIxData }
   | { kind: 'fillParlay'; data: FillParlayIxData }
   | { kind: 'getQuoteProxy'; data: FillBetIxData }
   | { kind: 'getParlayQuoteProxy'; data: FillParlayIxData }
   | { kind: 'getMarketQuotesProxy'; data: FillBetIxData }
   | { kind: 'gradeBets'; betResults: Uint8Array }
   | { kind: 'settleBet' }
   | { kind: 'settleParlay' }
   | { kind: 'createNettingAccount'; eventId: EventId }
   | { kind: 'addLineToNettingAccount'; data: AddLineToNettingIxData }
   | { kind: 'removeLineFromNettingAccount'; data: RemoveLineFromNettingIxData }
   | { kind: 'closeNettingAccount'; eventId: EventId }
   | { kind: 'withdrawFromLiabilityAccount'; amount: bigint }
   | { kind: 'writeArbitraryData'; data: Uint8Array }
   | { kind: 'forceClosePda' };
