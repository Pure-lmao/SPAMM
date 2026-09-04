import type { Address, ReadonlyUint8Array } from '@solana/kit';

/**
 * Odds fields (`oddsScaled`, `minOddsScaled`, `maxOddsScaled`, leg odds, …) use `bigint` in
 * TypeScript to distinguish scaled on-chain integers from decimal odds in UI math. Wire encoding
 * for these values remains `u32` (see `ODDS_SCALE` in `constants.ts`).
 */

import { ADDRESS_LEN, MAX_NUMBER_OF_MMS, MAX_PARLAY_LEGS, MAX_RFQ_PARLAY_LEGS, U32_LEN, U64_LEN } from './constants.js';

export { MAX_PARLAY_LEGS, MAX_RFQ_PARLAY_LEGS };

/** Wire sizes from `aggregator/program` packed layouts (`state/ids.rs`, `ZeroPodFixed::SIZE`). */
export const EVENT_ID_WIRE_SIZE = 11;

/**
 * Scaled odds (`oddsScaled`, `minOddsScaled`, etc.) use `bigint` in TS for safe arithmetic;
 * on-wire encoding is always `u32` (see `getU32BigintEncoder` / `ODDS_SCALE`).
 */
/** `MarketId` wire without `operator` (legacy pre-operator layout; used as a PDA seed). */
export const MARKET_ID_BODY_WIRE_SIZE = EVENT_ID_WIRE_SIZE + U64_LEN + 2 + 1 + 1;
/** `MarketId`: `EventId` + `player: u64` + `mkt: u16` + `period: u8` + `is_pregame: u8` + `operator: Address`. */
export const MARKET_ID_WIRE_SIZE = MARKET_ID_BODY_WIRE_SIZE + ADDRESS_LEN;
/** Packed `EventGameState` (`other.rs`): 4-byte phase + 4 scores. */
export const EVENT_GAME_STATE_LEN = 8;
/** `FillBetIxData` packed wire size (see `state/ix_fill_bet.rs`). */
export const FILL_BET_IX_DATA_LEN =
   U64_LEN + MARKET_ID_WIRE_SIZE + 1 + U64_LEN + U32_LEN + 2 + EVENT_GAME_STATE_LEN;
export const PARLAY_LEG_SEL_LEN = MARKET_ID_WIRE_SIZE + 1 + 2 + EVENT_GAME_STATE_LEN;
export const PARLAY_LEG_QUOTED_LEN = PARLAY_LEG_SEL_LEN + U32_LEN;
export const PARLAY_LEG_WIRE_LEN = PARLAY_LEG_QUOTED_LEN + 1;
/** Fixed MM quote buffer table size (quoted legs, padded to MAX_PARLAY_LEGS). */
export const PARLAY_LEG_TABLE_LEN = MAX_PARLAY_LEGS * PARLAY_LEG_QUOTED_LEN;
export const FILL_PARLAY_IX_HEADER_LEN = U64_LEN + U64_LEN + U32_LEN + 1;
/** Max fill_parlay body size (header + MAX_PARLAY_LEGS live selection legs). */
export const FILL_PARLAY_IX_DATA_LEN = FILL_PARLAY_IX_HEADER_LEN + MAX_PARLAY_LEGS * PARLAY_LEG_SEL_LEN;
export const fillParlayIxDataLen = (numLegs: number): number =>
   FILL_PARLAY_IX_HEADER_LEN + numLegs * PARLAY_LEG_SEL_LEN;
export const ADD_LINE_TO_LIABILITY_NETTING_IX_LEN = EVENT_ID_WIRE_SIZE + 1 + 2;
export const REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN = ADD_LINE_TO_LIABILITY_NETTING_IX_LEN;
/** Aggregator config PDA packed size (`disc` + `status` + `authority`). */
export const CONFIG_PDA_LEN = 1 + 1 + ADDRESS_LEN;
/** `EventStateData` header on-chain (`other.rs`); `eventId` wire is 11 bytes. Account may be longer. */
export const EVENT_STATE_HEADER_LEN = 1 + 1 + EVENT_ID_WIRE_SIZE + 2 + EVENT_GAME_STATE_LEN;
export const MM_QUOTE_BUFFER_LEN =
   1 + 1 + ADDRESS_LEN + MARKET_ID_WIRE_SIZE + 1 + U64_LEN + U32_LEN + EVENT_GAME_STATE_LEN + 2;
/** `MMParlayQuoteBuffer` ZeroPod header (legs follow as trailing bytes). */
export const MM_PARLAY_QUOTE_BUFFER_HEADER_LEN = 2 + ADDRESS_LEN + U64_LEN + U32_LEN + 1;
export const MM_PARLAY_QUOTE_BUFFER_LEN = MM_PARLAY_QUOTE_BUFFER_HEADER_LEN + PARLAY_LEG_TABLE_LEN;
export const NETTING_HEADER_LEN = 1 + 1 + EVENT_ID_WIRE_SIZE + U64_LEN + U64_LEN + U64_LEN + 1;
export const NETTING_LINE_LEN = 1 + 2 + U64_LEN + U64_LEN;
/** Spare slots allocated by `create_netting_account` (`header + 10`). */
export const NETTING_CREATE_LINE_CAPACITY = 10;
/** Hard cap: on-chain `number_of_lines` is a `u8`. */
export const NETTING_MAX_LINE_CAPACITY = 255;
export const NETTING_ACCOUNT_ALLOC_LEN =
   NETTING_HEADER_LEN + NETTING_CREATE_LINE_CAPACITY * NETTING_LINE_LEN;
export const BET_FILLER_WIRE_LEN = ADDRESS_LEN + U64_LEN + U64_LEN + U32_LEN + 1;
/** Fixed header size for single bet PDA (`BetAccountHeader`), including `num_fillers`. */
export const BET_ACCOUNT_HEADER_LEN =
   1 +
   1 +
   ADDRESS_LEN +
   ADDRESS_LEN +
   U64_LEN +
   MARKET_ID_WIRE_SIZE +
   1 +
   U64_LEN +
   U64_LEN +
   U32_LEN +
   U32_LEN +
   2 +
   EVENT_GAME_STATE_LEN +
   1 +
   1;
export const BET_ACCOUNT_MIN_LEN = BET_ACCOUNT_HEADER_LEN + BET_FILLER_WIRE_LEN;
export const BET_ACCOUNT_MAX_LEN =
   BET_ACCOUNT_HEADER_LEN + MAX_NUMBER_OF_MMS * BET_FILLER_WIRE_LEN;
export const betAccountLen = (numFillers: number): number =>
   BET_ACCOUNT_HEADER_LEN + numFillers * BET_FILLER_WIRE_LEN;
export const PARLAY_BET_ACCOUNT_DISCRIMINATOR = 2;
/** Fixed header size for parlay bet PDA (`ParlayBetAccountHeader`). */
export const PARLAY_BET_HEADER_LEN =
   1 +
   1 +
   ADDRESS_LEN +
   ADDRESS_LEN +
   U64_LEN +
   U64_LEN +
   U64_LEN +
   U32_LEN +
   U32_LEN +
   ADDRESS_LEN +
   1 +
   1;
export const PARLAY_BET_ACCOUNT_MIN_LEN = PARLAY_BET_HEADER_LEN + 2 * PARLAY_LEG_WIRE_LEN;
export const PARLAY_BET_ACCOUNT_MAX_LEN =
   PARLAY_BET_HEADER_LEN + MAX_RFQ_PARLAY_LEGS * PARLAY_LEG_WIRE_LEN;
export const parlayBetAccountLen = (numLegs: number): number =>
   PARLAY_BET_HEADER_LEN + numLegs * PARLAY_LEG_WIRE_LEN;
export const MM_ENCUMBRANCE_PDA_LEN = 10;
/** MM `["config"]` PDA header (`disc` + `bump` + `admin` + `rfq_signer`). Account may be longer. */
export const MM_CONFIG_PDA_HEADER_LEN = 1 + 1 + ADDRESS_LEN + ADDRESS_LEN;
export const MM_MARKET_DATA_PDA_MIN_LEN = 2;
export const MM_LIST_HEADER_LEN = 3;
export const GET_QUOTE_IX_WIRE_LEN =
   1 + U64_LEN + U32_LEN + MARKET_ID_WIRE_SIZE + 1 + EVENT_GAME_STATE_LEN + 2;
/** Full MM `get_quote_parlay` ix data (includes leading discriminator `122`); max size. */
export const GET_QUOTE_PARLAY_IX_HEADER_LEN = 1 + U64_LEN + U32_LEN + 1;
export const GET_QUOTE_PARLAY_IX_WIRE_LEN = GET_QUOTE_PARLAY_IX_HEADER_LEN + MAX_PARLAY_LEGS * PARLAY_LEG_SEL_LEN;
export const getQuoteParlayIxWireLen = (numLegs: number): number =>
   GET_QUOTE_PARLAY_IX_HEADER_LEN + numLegs * PARLAY_LEG_SEL_LEN;
export const FILL_QUOTE_IX_WIRE_LEN =
   1 + U64_LEN + U32_LEN + MARKET_ID_WIRE_SIZE + 1 + EVENT_GAME_STATE_LEN + 2 + U64_LEN;
/** Full MM `fill_parlay_quote` ix data (includes leading discriminator `123`). */
export const FILL_QUOTE_PARLAY_IX_WIRE_LEN = 1 + U64_LEN + U32_LEN + U64_LEN;
export const MM_RETURN_DATA_LEN = U64_LEN + U32_LEN;
export const PARLAY_QUOTE_RETURN_HEADER_LEN = U64_LEN + U32_LEN + 1;
/** Max parlay quote return wire size. */
export const PARLAY_QUOTE_RETURN_WIRE_LEN = PARLAY_QUOTE_RETURN_HEADER_LEN + MAX_PARLAY_LEGS * U32_LEN;
export const parlayQuoteReturnWireLen = (numLegs: number): number =>
   PARLAY_QUOTE_RETURN_HEADER_LEN + numLegs * U32_LEN;
export const PROXY_PARLAY_QUOTE_HEADER_LEN = ADDRESS_LEN + U64_LEN + U32_LEN + 1;
export const PROXY_PARLAY_QUOTE_DATA_LEN = PROXY_PARLAY_QUOTE_HEADER_LEN + MAX_PARLAY_LEGS * U32_LEN;
export const proxyParlayQuoteDataLen = (numLegs: number): number =>
   PROXY_PARLAY_QUOTE_HEADER_LEN + numLegs * U32_LEN;
export const GRADE_PARLAY_LEG_SKIP = 255;

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
   ModifiedWin = 8,
   CashedOut = 9,
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

export type BetFiller = {
   mmAddress: Address;
   amount: bigint;
   reservedProfit: bigint;
   oddsScaled: bigint;
   isPotentiallyNetted: boolean;
};

/**
 * On-chain bet account body (`BET_ACCOUNT_DISCRIMINATOR`).
 * Wire layout: `BetAccountHeader` + `BetFiller` × `numFillers`.
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
   timestamp: number;
   freebetId: number;
   eventStateSequence: number;
   eventGameState: EventGameState;
   result: BetResult;
   numFillers: number;
   fillers: BetFiller[];
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
   timestamp: number;
   freebetId: number;
   fillerAddress: Address;
   result: BetResult;
   numLegs: number;
   /** Live legs only (`0..numLegs-1`); wire is unpadded after the fixed header. */
   legs: ParlayLegWire[];
};

/** MM `get_quote_parlay` CPI return wire (`GetParlayQuoteReturnWire`). */
export type GetParlayQuoteReturnWire = {
   maxAmount: bigint;
   oddsScaled: bigint;
   numLegs: number;
   legOdds: bigint[];
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
   openHome: bigint;
   openAway: bigint;
   openDraw: bigint;
   numberOfLines: number;
};

export type NettingLine = {
   period: number;
   mkt: number;
   open0: bigint;
   open1: bigint;
};

export type NettingPdaAccountData = NettingPdaDataHeader & {
   lines: NettingLine[];
};

/** MM quote buffer account (`MM_QUOTE_BUFFER_DISCRIMINATOR`). */
export const MM_QUOTE_BUFFER_DISCRIMINATOR = 102;

/** MM parlay quote buffer account (`MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR`). */
export const MM_PARLAY_QUOTE_BUFFER_DISCRIMINATOR = 103;

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

/** Fill / get-quote selection: market, side, event snapshot. No per-leg odds or grade. */
export type ParlayLegSel = {
   marketId: MarketId;
   side: number;
   eventStateSequence: number;
   eventGameState: EventGameState;
};

/** Selection + per-leg odds. RFQ fill ix and MM quote buffer (result is pending until the bet PDA). */
export type ParlayLegQuoted = {
   marketId: MarketId;
   side: number;
   eventStateSequence: number;
   eventGameState: EventGameState;
   /** Per-leg odds from the MM quote (`0` = deliberate same-event companion leg). */
   oddsScaled: bigint;
};

/** Stored parlay bet-account leg (selection + odds + grade result). */
export type ParlayLegWire = {
   marketId: MarketId;
   side: number;
   eventStateSequence: number;
   eventGameState: EventGameState;
   oddsScaled: bigint;
   result: BetResult;
};

export type MmParlayQuoteBuffer = {
   discriminator: number;
   isUsed: number;
   userAddress: Address;
   maxAmount: bigint;
   oddsScaled: bigint;
   numLegs: number;
   legs: ParlayLegQuoted[];
};

/** Aggregator config PDA (`CONFIG_PDA_DISCRIMINATOR`). */
export const CONFIG_PDA_DISCRIMINATOR = 4;

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
export const EVENT_STATE_DISCRIMINATOR = 104;

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
export const MM_MARKET_DATA_PDA_DISCRIMINATOR = 100;

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
export const MM_ACCOUNT_CONFIG_DISCRIMINATOR = 101;

export type MmAccountConfig = {
   discriminator: number;
   bump: number;
   admin: Address;
   rfqSigner: Address;
};

export const RFQ_SIGNATURE_LEN = 64;
/** Byte after `networkDomain`: bet=1, parlay=2, cashout bet=3, cashout parlay=4 (`rfq_message.rs`). */
export const RFQ_BET_MESSAGE_KIND = 1;
export const RFQ_PARLAY_MESSAGE_KIND = 2;
export const RFQ_CASHOUT_MESSAGE_KIND = 3;
export const RFQ_CASHOUT_PARLAY_MESSAGE_KIND = 4;
/** Canonical RFQ bet message: `networkDomain` + `kind` + offer body + `mmProgramId`. */
export const RFQ_BET_MESSAGE_LEN =
   1 + 1 + ADDRESS_LEN + U64_LEN + MARKET_ID_WIRE_SIZE + EVENT_GAME_STATE_LEN + 2 + 1 + U64_LEN + U32_LEN + U32_LEN + ADDRESS_LEN;
/** Packed `RfqParlayMessageHeader` (`numLegs` last). */
export const RFQ_PARLAY_MESSAGE_HEADER_LEN =
   1 + 1 + ADDRESS_LEN + U64_LEN + U64_LEN + U32_LEN + U32_LEN + ADDRESS_LEN + 1;
/** Offset of `numLegs` (immediately before live legs). */
export const RFQ_PARLAY_NUM_LEGS_OFFSET = RFQ_PARLAY_MESSAGE_HEADER_LEN - 1;
/** Header without `numLegs`. */
export const RFQ_PARLAY_MESSAGE_FIXED_LEN = RFQ_PARLAY_NUM_LEGS_OFFSET;
export const RFQ_PARLAY_MESSAGE_LEN =
   RFQ_PARLAY_MESSAGE_HEADER_LEN + MAX_RFQ_PARLAY_LEGS * PARLAY_LEG_QUOTED_LEN;
export const rfqParlayMessageLen = (numLegs: number): number =>
   RFQ_PARLAY_MESSAGE_HEADER_LEN + numLegs * PARLAY_LEG_QUOTED_LEN;
/** RFQ body: `event_state_sequence` + `event_game_state` before `max_stake` / `odds_scaled` / `offer_expiry` (not fill_bet field order). */
export const FILL_RFQ_BET_IX_BODY_LEN =
   FILL_BET_IX_DATA_LEN - U32_LEN + U64_LEN + U32_LEN + U32_LEN;
export const FILL_RFQ_BET_IX_DATA_LEN = FILL_RFQ_BET_IX_BODY_LEN + RFQ_SIGNATURE_LEN;
/** Header: betId + amount + odds + maxStake + expiry + numLegs (numLegs last). */
export const FILL_RFQ_PARLAY_IX_HEADER_LEN = U64_LEN + U64_LEN + U32_LEN + U64_LEN + U32_LEN + 1;
export const fillRfqParlayIxBodyLen = (numLegs: number): number =>
   FILL_RFQ_PARLAY_IX_HEADER_LEN + numLegs * PARLAY_LEG_QUOTED_LEN;
export const fillRfqParlayIxDataLen = (numLegs: number): number =>
   fillRfqParlayIxBodyLen(numLegs) + RFQ_SIGNATURE_LEN;
export const FILL_RFQ_PARLAY_IX_BODY_LEN =
   FILL_RFQ_PARLAY_IX_HEADER_LEN + MAX_RFQ_PARLAY_LEGS * PARLAY_LEG_QUOTED_LEN;
export const FILL_RFQ_PARLAY_IX_DATA_LEN = FILL_RFQ_PARLAY_IX_BODY_LEN + RFQ_SIGNATURE_LEN;

/** `CashoutEscrow` packed size (`account_cashout_escrow.rs`). */
export const CASHOUT_ESCROW_DISCRIMINATOR = 7;
export const CASHOUT_ESCROW_LEN =
   1 + 1 + ADDRESS_LEN + ADDRESS_LEN + U64_LEN + U64_LEN + U32_LEN + U64_LEN + U64_LEN + U64_LEN + ADDRESS_LEN + 1;

/** `CashoutAccountHeader` + fillers (`account_cashout.rs`). */
export const CASHOUT_ACCOUNT_DISCRIMINATOR = 8;
export const CASHOUT_ACCOUNT_HEADER_LEN =
   1 +
   1 +
   ADDRESS_LEN +
   ADDRESS_LEN +
   ADDRESS_LEN +
   U64_LEN +
   U64_LEN +
   MARKET_ID_WIRE_SIZE +
   1 +
   U64_LEN +
   U64_LEN +
   U32_LEN +
   2 +
   EVENT_GAME_STATE_LEN +
   2 +
   EVENT_GAME_STATE_LEN +
   1 +
   1;
export const CASHOUT_ACCOUNT_MIN_LEN = CASHOUT_ACCOUNT_HEADER_LEN + BET_FILLER_WIRE_LEN;
export const CASHOUT_ACCOUNT_MAX_LEN =
   CASHOUT_ACCOUNT_HEADER_LEN + MAX_NUMBER_OF_MMS * BET_FILLER_WIRE_LEN;
export const cashoutAccountLen = (numFillers: number): number =>
   CASHOUT_ACCOUNT_HEADER_LEN + numFillers * BET_FILLER_WIRE_LEN;

/** `CashoutParlayHeader` + legs (`account_cashout_parlay.rs`). */
export const CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR = 9;
export const CASHOUT_PARLAY_HEADER_LEN =
   1 +
   1 +
   ADDRESS_LEN +
   ADDRESS_LEN +
   ADDRESS_LEN +
   U64_LEN +
   U64_LEN +
   U64_LEN +
   U64_LEN +
   U32_LEN +
   1 +
   ADDRESS_LEN +
   1;
export const CASHOUT_PARLAY_LEG_WIRE_LEN =
   MARKET_ID_WIRE_SIZE + 1 + 2 + EVENT_GAME_STATE_LEN + 2 + EVENT_GAME_STATE_LEN + U32_LEN + 1;
export const CASHOUT_PARLAY_ACCOUNT_MIN_LEN =
   CASHOUT_PARLAY_HEADER_LEN + 2 * CASHOUT_PARLAY_LEG_WIRE_LEN;
export const CASHOUT_PARLAY_ACCOUNT_MAX_LEN =
   CASHOUT_PARLAY_HEADER_LEN + MAX_RFQ_PARLAY_LEGS * CASHOUT_PARLAY_LEG_WIRE_LEN;
export const cashoutParlayAccountLen = (numLegs: number): number =>
   CASHOUT_PARLAY_HEADER_LEN + numLegs * CASHOUT_PARLAY_LEG_WIRE_LEN;

/** Live snapshot in fill_parlay_cashout / RFQ parlay cashout ix (`u16` + `EventGameState`). */
export const CASHOUT_SNAPSHOT_WIRE_LEN = 2 + EVENT_GAME_STATE_LEN;

/** `FillCashoutIxData` packed body (after router disc). */
export const FILL_CASHOUT_IX_DATA_LEN = U64_LEN + U64_LEN + U64_LEN + U64_LEN + 2 + EVENT_GAME_STATE_LEN;
export const FILL_PARLAY_CASHOUT_IX_HEADER_LEN = U64_LEN + U64_LEN + U64_LEN + U64_LEN + 1;
export const fillParlayCashoutIxDataLen = (numLegs: number): number =>
   FILL_PARLAY_CASHOUT_IX_HEADER_LEN + numLegs * CASHOUT_SNAPSHOT_WIRE_LEN;

export const FILL_RFQ_CASHOUT_IX_BODY_LEN =
   U64_LEN + U64_LEN + U64_LEN + U64_LEN + U64_LEN + U32_LEN + 2 + EVENT_GAME_STATE_LEN;
export const FILL_RFQ_CASHOUT_IX_DATA_LEN = FILL_RFQ_CASHOUT_IX_BODY_LEN + RFQ_SIGNATURE_LEN;

export const FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN =
   U64_LEN + U64_LEN + U64_LEN + U64_LEN + U64_LEN + U32_LEN + 1;
export const fillRfqParlayCashoutIxBodyLen = (numLegs: number): number =>
   FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN + numLegs * CASHOUT_SNAPSHOT_WIRE_LEN;
export const fillRfqParlayCashoutIxDataLen = (numLegs: number): number =>
   fillRfqParlayCashoutIxBodyLen(numLegs) + RFQ_SIGNATURE_LEN;

export const RFQ_CASHOUT_MESSAGE_LEN =
   1 + 1 + ADDRESS_LEN + U64_LEN + U64_LEN + U64_LEN + U64_LEN + U32_LEN + 2 + EVENT_GAME_STATE_LEN + ADDRESS_LEN;
/** Packed `RfqCashoutParlayMessageHeader` (`numLegs` last). */
export const RFQ_CASHOUT_PARLAY_MESSAGE_HEADER_LEN =
   1 + 1 + ADDRESS_LEN + U64_LEN + U64_LEN + U64_LEN + U64_LEN + U32_LEN + ADDRESS_LEN + 1;
export const RFQ_CASHOUT_PARLAY_MESSAGE_FIXED_LEN = RFQ_CASHOUT_PARLAY_MESSAGE_HEADER_LEN - 1;
export const RFQ_CASHOUT_PARLAY_SNAPSHOT_LEN = CASHOUT_SNAPSHOT_WIRE_LEN;
export const rfqCashoutParlayMessageLen = (numLegs: number): number =>
   RFQ_CASHOUT_PARLAY_MESSAGE_HEADER_LEN + numLegs * CASHOUT_SNAPSHOT_WIRE_LEN;
export const RFQ_CASHOUT_PARLAY_MESSAGE_LEN = rfqCashoutParlayMessageLen(MAX_RFQ_PARLAY_LEGS);

export const GET_CASHOUT_QUOTE_IX_WIRE_LEN =
   1 + U64_LEN + U64_LEN + U64_LEN + MARKET_ID_WIRE_SIZE + 1 + EVENT_GAME_STATE_LEN + 2;
export const FILL_CASHOUT_QUOTE_IX_WIRE_LEN =
   1 + U64_LEN + U64_LEN + MARKET_ID_WIRE_SIZE + 1 + EVENT_GAME_STATE_LEN + 2;
export const GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN = 1 + U64_LEN + U64_LEN + U64_LEN + 1;
export const getCashoutQuoteParlayIxWireLen = (numLegs: number): number =>
   GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN + numLegs * PARLAY_LEG_SEL_LEN;
export const FILL_CASHOUT_QUOTE_PARLAY_IX_WIRE_LEN = 1 + U64_LEN + U64_LEN;
export const CASHOUT_QUOTE_RETURN_LEN = U64_LEN;

export const FREEBET_ISSUER_DISCRIMINATOR = 10;
export const FREEBET_ACCOUNT_DISCRIMINATOR = 11;
/** `FreebetIssuer` ZeroPod size (`u8` + `u8` + `Address` + `u32`). */
export const FREEBET_ISSUER_LEN = 1 + 1 + ADDRESS_LEN + U32_LEN;
/** `FreebetAccountHeader` ZeroPod size. */
export const FREEBET_ACCOUNT_HEADER_LEN =
   1 + 1 + 1 + 1 + 1 + 1 + U32_LEN + U32_LEN + U32_LEN + U32_LEN + U64_LEN + ADDRESS_LEN + ADDRESS_LEN;
export const ISSUE_FREEBET_IX_HEADER_LEN =
   U32_LEN + U32_LEN + U64_LEN + U32_LEN + U32_LEN + 1 + 1 + 1;
export const freebetAccountLen = (numMms: number, numOperators: number): number =>
   FREEBET_ACCOUNT_HEADER_LEN + numMms * ADDRESS_LEN + numOperators * ADDRESS_LEN;
export const issueFreebetIxDataLen = (numMms: number, numOperators: number): number =>
   ISSUE_FREEBET_IX_HEADER_LEN + numMms * ADDRESS_LEN + numOperators * ADDRESS_LEN;
export const freebetAllowedOperatorsOffset = (numMms: number): number =>
   FREEBET_ACCOUNT_HEADER_LEN + numMms * ADDRESS_LEN;

export enum FreebetState {
   Available = 0,
   Used = 1,
}

export type FreebetIssuer = {
   discriminator: number;
   bump: number;
   auth: Address;
   openCount: number;
};

export type FreebetAccountData = {
   discriminator: number;
   bump: number;
   state: FreebetState;
   numMms: number;
   minLegs: number;
   numOperators: number;
   freebetId: number;
   expiry: number;
   minOddsScaled: bigint;
   maxOddsScaled: bigint;
   amount: bigint;
   issuerAuth: Address;
   user: Address;
   allowedMms: Address[];
   allowedOperators: Address[];
};

export type IssueFreebetIxData = {
   freebetId: number;
   expiry: number;
   amount: bigint;
   minOddsScaled: bigint;
   maxOddsScaled: bigint;
   minLegs: number;
   allowedMms: Address[];
   allowedOperators: Address[];
};

export type CashoutEscrow = {
   discriminator: number;
   bump: number;
   owner: Address;
   feepayer: Address;
   origBetId: bigint;
   cashoutId: bigint;
   timestamp: number;
   amount: bigint;
   payoutRemoved: bigint;
   payment: bigint;
   marketMaker: Address;
   isParlay: boolean;
};

export type CashoutAccountData = {
   discriminator: number;
   bump: number;
   mm: Address;
   feepayer: Address;
   origOwner: Address;
   origBetId: bigint;
   cashoutId: bigint;
   marketId: MarketId;
   side: number;
   amount: bigint;
   payout: bigint;
   timestamp: number;
   origEventStateSequence: number;
   origEventGameState: EventGameState;
   cashoutEventStateSequence: number;
   cashoutEventGameState: EventGameState;
   result: BetResult;
   numFillers: number;
   fillers: BetFiller[];
};

export type CashoutParlayLeg = {
   marketId: MarketId;
   side: number;
   origEventStateSequence: number;
   origEventGameState: EventGameState;
   cashoutEventStateSequence: number;
   cashoutEventGameState: EventGameState;
   oddsScaled: bigint;
   result: BetResult;
};

export type CashoutParlayAccountData = {
   discriminator: number;
   bump: number;
   mm: Address;
   feepayer: Address;
   origOwner: Address;
   origBetId: bigint;
   cashoutId: bigint;
   amount: bigint;
   payout: bigint;
   timestamp: number;
   result: BetResult;
   originalFillerAddress: Address;
   numLegs: number;
   legs: CashoutParlayLeg[];
};

export type CashoutSnapshot = {
   eventStateSequence: number;
   eventGameState: EventGameState;
};

export type FillCashoutIxData = {
   origBetId: bigint;
   cashoutId: bigint;
   amount: bigint;
   minPayout: bigint;
   eventStateSequence: number;
   eventGameState: EventGameState;
};

export type FillParlayCashoutIxData = {
   origBetId: bigint;
   cashoutId: bigint;
   amount: bigint;
   minPayout: bigint;
   numLegs: number;
   snapshots: CashoutSnapshot[];
};

export type FillRfqCashoutIxData = {
   origBetId: bigint;
   cashoutId: bigint;
   amount: bigint;
   minPayout: bigint;
   maxPayment: bigint;
   offerExpiry: number;
   eventStateSequence: number;
   eventGameState: EventGameState;
   signature: ReadonlyUint8Array;
};

export type FillRfqParlayCashoutIxData = {
   origBetId: bigint;
   cashoutId: bigint;
   amount: bigint;
   minPayout: bigint;
   maxPayment: bigint;
   offerExpiry: number;
   numLegs: number;
   snapshots: CashoutSnapshot[];
   signature: ReadonlyUint8Array;
};

export type FillRfqCashoutIxBody = Omit<FillRfqCashoutIxData, 'signature'>;
export type FillRfqParlayCashoutIxBody = Omit<FillRfqParlayCashoutIxData, 'signature'>;

/** Canonical ed25519 message bytes for a single-bet cashout RFQ quote. */
export type RfqCashoutMessageInput = {
   networkDomain: number;
   user: Address;
   origBetId: bigint;
   cashoutId: bigint;
   amount: bigint;
   maxPayment: bigint;
   offerExpiry: number;
   eventStateSequence: number;
   eventGameState: EventGameState;
   mmProgramId: Address;
};

/** Canonical ed25519 message bytes for a parlay cashout RFQ quote. */
export type RfqCashoutParlayMessageInput = {
   networkDomain: number;
   user: Address;
   origBetId: bigint;
   cashoutId: bigint;
   amount: bigint;
   maxPayment: bigint;
   offerExpiry: number;
   mmProgramId: Address;
   numLegs: number;
   snapshots: CashoutSnapshot[];
};

/** Canonical ed25519 message bytes for a single-bet RFQ quote (`rfq_message.rs`). */
export type RfqBetMessageInput = {
   networkDomain: number;
   user: Address;
   betId: bigint;
   marketId: MarketId;
   eventGameState: EventGameState;
   eventStateSequence: number;
   side: number;
   maxStake: bigint;
   oddsScaled: bigint;
   offerExpiry: number;
   mmProgramId: Address;
};

/** Canonical ed25519 message bytes for a parlay RFQ quote (`rfq_message.rs`). */
export type RfqParlayMessageInput = {
   networkDomain: number;
   user: Address;
   betId: bigint;
   maxStake: bigint;
   oddsScaled: bigint;
   offerExpiry: number;
   mmProgramId: Address;
   numLegs: number;
   legs: ParlayLegQuoted[];
};

export type FillRfqBetIxData = {
   betId: bigint;
   marketId: MarketId;
   side: number;
   amount: bigint;
   oddsScaled: bigint;
   eventStateSequence: number;
   eventGameState: EventGameState;
   maxStake: bigint;
   offerExpiry: number;
   signature: ReadonlyUint8Array;
};

export type FillRfqParlayIxData = {
   betId: bigint;
   amount: bigint;
   oddsScaled: bigint;
   maxStake: bigint;
   offerExpiry: number;
   numLegs: number;
   legs: ParlayLegQuoted[];
   signature: ReadonlyUint8Array;
};

export type FillRfqBetIxBody = Omit<FillRfqBetIxData, 'signature'>;
export type FillRfqParlayIxBody = Omit<FillRfqParlayIxData, 'signature'>;

export type SignedRfqBetQuote = {
   message: Uint8Array;
   signature: Uint8Array;
   /** Fields needed for {@link FillRfqBetIxData} except `amount` / `signature`. */
   offer: Omit<RfqBetMessageInput, 'mmProgramId'>;
   mmProgramId: Address;
};

export type SignedRfqParlayQuote = {
   message: Uint8Array;
   signature: Uint8Array;
   offer: Omit<RfqParlayMessageInput, 'mmProgramId'>;
   mmProgramId: Address;
};

export type SignedRfqCashoutQuote = {
   message: Uint8Array;
   signature: Uint8Array;
   offer: Omit<RfqCashoutMessageInput, 'mmProgramId'>;
   mmProgramId: Address;
};

export type SignedRfqCashoutParlayQuote = {
   message: Uint8Array;
   signature: Uint8Array;
   offer: Omit<RfqCashoutParlayMessageInput, 'mmProgramId'>;
   mmProgramId: Address;
};

/** Discriminated fill payload produced from an HTTP request + MM quote. */
export type RfqFillIxFromQuote =
   | { kind: 'fillRfqBet'; data: FillRfqBetIxData; mmProgram: Address }
   | { kind: 'fillRfqParlay'; data: FillRfqParlayIxData; mmProgram: Address };

export type RfqCashoutFillIxFromQuote =
   | {
        kind: 'fillRfqCashout';
        data: FillRfqCashoutIxData;
        mmProgram: Address;
        marketId: MarketId;
     }
   | {
        kind: 'fillRfqParlayCashout';
        data: FillRfqParlayCashoutIxData;
        mmProgram: Address;
        origLegs: { marketId: MarketId }[];
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

/** One MM parlay quote from `get_parlay_quote_proxy` return data. */
export type ProxyParlayQuoteData = {
   mmAddress: Address;
   maxAmount: bigint;
   oddsScaled: bigint;
   numLegs: number;
   legOdds: bigint[];
};

/** One MM cashout quote from `get_cashout_quote_proxy` / `get_parlay_cashout_quote_proxy`. */
export type ProxyCashoutQuoteData = {
   mmAddress: Address;
   maxPayment: bigint;
};

/** `state::mm_quote::PROXY_QUOTE_DATA_LEN` — `repr(C)` size of one `ProxyQuoteData`. */
export const PROXY_QUOTE_DATA_LEN = ADDRESS_LEN + U64_LEN + U32_LEN;

/** `state::mm_cashout::PROXY_CASHOUT_QUOTE_DATA_LEN` — filling MM + max payment. */
export const PROXY_CASHOUT_QUOTE_DATA_LEN = ADDRESS_LEN + U64_LEN;

/** All side odds for one MM from `get_market_quotes_proxy` (index = side). */
export type ProxyMarketMmQuotes = {
   mmAddress: Address;
   oddsScaled: bigint[];
};

/** `ProxyMarketSideOdds` wire size (`u32` odds per side). */
export const PROXY_MARKET_SIDE_ODDS_WIRE_LEN = U32_LEN;
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

/** Router body for `fill_parlay` (after leading discriminator `11`). `legs.length` must equal `numLegs`. */
export type FillParlayIxData = {
   betId: bigint;
   amount: bigint;
   minOddsScaled: bigint;
   numLegs: number;
   legs: ParlayLegSel[];
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
   legs: ParlayLegSel[];
};

/** High-level MM `get_quote` payload (SDK maps `minOddsScaled` → wire `odds_scaled`). */
export type MmGetQuote = {
   amount: bigint;
   minOddsScaled: bigint;
   side: number;
   eventGameState: EventGameState;
   eventStateSequence: number;
   marketId: MarketId;
};

/** High-level MM `get_quote_parlay` payload (same legs as `fill_parlay`). */
export type MmGetQuoteParlay = {
   amount: bigint;
   /** Minimum combined scaled odds hint; wire field `odds_scaled` on `GetQuoteParlayIxData`. */
   minOddsScaled: bigint;
   legs: ParlayLegSel[];
};

export type FillParlayQuoteIxData = {
   instructionDiscriminator: number;
   amountToFill: bigint;
   oddsScaled: bigint;
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

/** High-level MM `get_cashout_quote` payload (maps to {@link GetCashoutQuoteIxData} wire). */
export type MmGetCashoutQuote = {
   amount: bigint;
   payout: bigint;
   minPayout: bigint;
   marketId: MarketId;
   side: number;
   eventGameState: EventGameState;
   eventStateSequence: number;
};

/** High-level MM `get_cashout_quote_parlay` payload (same legs as {@link FillParlayCashoutIxData}). */
export type MmGetCashoutQuoteParlay = {
   amount: bigint;
   payout: bigint;
   minPayout: bigint;
   legs: ParlayLegSel[];
};

export type DecodedAggregatorInstruction =
   | { kind: 'initProgram' }
   | { kind: 'changeConfigStatus'; status: 0 | 1 }
   | { kind: 'registerMm' }
   | { kind: 'deregisterMm' }
   | { kind: 'initFreebetIssuer' }
   | { kind: 'removeFreebetIssuer' }
   | { kind: 'withdrawFreebetFunds'; amount: bigint }
   | { kind: 'issueFreebet'; data: IssueFreebetIxData }
   | { kind: 'revokeFreebet'; freebetId: number }
   | { kind: 'fillBet'; data: FillBetIxData }
   | { kind: 'fillRfqBet'; data: FillRfqBetIxData }
   | { kind: 'fillParlay'; data: FillParlayIxData }
   | { kind: 'fillRfqParlay'; data: FillRfqParlayIxData }
   | { kind: 'freebetFillBet'; freebetId: number; data: FillBetIxData }
   | { kind: 'freebetFillParlay'; freebetId: number; data: FillParlayIxData }
   | { kind: 'freebetFillRfqBet'; freebetId: number; data: FillRfqBetIxData }
   | { kind: 'freebetFillRfqParlay'; freebetId: number; data: FillRfqParlayIxData }
   | { kind: 'fillCashout'; data: FillCashoutIxData }
   | { kind: 'fillParlayCashout'; data: FillParlayCashoutIxData }
   | { kind: 'fillRfqCashout'; data: FillRfqCashoutIxData }
   | { kind: 'fillRfqParlayCashout'; data: FillRfqParlayCashoutIxData }
   | { kind: 'claimCashoutEscrow' }
   | { kind: 'revertCashout' }
   | { kind: 'getQuoteProxy'; data: FillBetIxData }
   | { kind: 'getParlayQuoteProxy'; data: FillParlayIxData }
   | { kind: 'getMarketQuotesProxy'; data: FillBetIxData }
   | { kind: 'getCashoutQuoteProxy'; data: FillCashoutIxData }
   | { kind: 'getParlayCashoutQuoteProxy'; data: FillParlayCashoutIxData }
   | { kind: 'gradeBets'; betResults: Uint8Array }
   /** Grade mask for one parlay account; length equals `num_legs`. */
   | { kind: 'gradeParlay'; legGradeMask: Uint8Array }
   | { kind: 'settleBet' }
   | { kind: 'settleParlay' }
   | { kind: 'settleFreebet' }
   | { kind: 'settleFreebetParlay' }
   | { kind: 'createNettingAccount'; eventId: EventId }
   | { kind: 'addLineToNettingAccount'; data: AddLineToNettingIxData }
   | { kind: 'removeLineFromNettingAccount'; data: RemoveLineFromNettingIxData }
   | { kind: 'closeNettingAccount'; eventId: EventId }
   | { kind: 'withdrawFromLiabilityAccount'; amount: bigint }
   | { kind: 'writeArbitraryData'; data: Uint8Array }
   | { kind: 'forceClosePda' };
