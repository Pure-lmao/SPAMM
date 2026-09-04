import { ADDRESS_LEN, MAX_PARLAY_LEGS, ODDS_SCALE } from './constants.js';
import { numSidesForMkt } from './helpers.js';
import {
   Sport,
   type EventGameState,
   type EventId,
   type FillParlayQuoteIxData,
   type FillQuoteIxData,
   type FillCashoutQuoteIxData,
   type FillCashoutQuoteParlayIxData,
   type GetQuoteIxData,
   type GetQuoteParlayIxData,
   type GetCashoutQuoteIxData,
   type GetCashoutQuoteParlayIxData,
   type MarketId,
   type ParlayLegSel,
} from './types.js';

const U8_MAX = 255;
export const U16_MAX = 65535;
export const U32_MAX = 0xffff_ffffn;
export const U64_MAX = 2n ** 64n - 1n;

export function validateU8(n: number, label = 'value'): void {
   if (!Number.isInteger(n) || n < 0 || n > U8_MAX) {
      throw new RangeError(`${label} must be an integer in [0, ${U8_MAX}]`);
   }
}

export function validateU16(n: number, label = 'value'): void {
   if (!Number.isInteger(n) || n < 0 || n > U16_MAX) {
      throw new RangeError(`${label} must be an integer in [0, ${U16_MAX}]`);
   }
}

export function validateBytes32(b: Uint8Array, label = 'value'): void {
   if (b.length !== ADDRESS_LEN) {
      throw new RangeError(`${label} must be exactly ${ADDRESS_LEN} bytes`);
   }
}

export function validateEventGameState(g: EventGameState, label = 'eventGameState'): void {
   if (typeof g.gamePhase !== 'string') {
      throw new TypeError(`${label}.gamePhase must be a string`);
   }
   if (g.gamePhase.length > 4) {
      throw new RangeError(`${label}.gamePhase must be at most 4 ASCII characters`);
   }
   for (let i = 0; i < g.gamePhase.length; i++) {
      const c = g.gamePhase.charCodeAt(i)!;
      if (c > 127) {
         throw new RangeError(`${label}.gamePhase must be ASCII (code ${c} at index ${i})`);
      }
   }
   validateU8(g.homePrimary, `${label}.homePrimary`);
   validateU8(g.awayPrimary, `${label}.awayPrimary`);
   validateU8(g.homeSecondary, `${label}.homeSecondary`);
   validateU8(g.awaySecondary, `${label}.awaySecondary`);
}

export function validateU32Number(n: number, label = 'value'): void {
   if (!Number.isInteger(n) || n < 0 || n > Number(U32_MAX)) {
      throw new RangeError(`${label} must be an integer in [0, 2**32-1]`);
   }
}

export function validateU32Bigint(n: bigint, label = 'value'): void {
   if (typeof n !== 'bigint') {
      throw new TypeError(`${label} must be a bigint`);
   }
   if (n < 0n || n > U32_MAX) {
      throw new RangeError(`${label} must be in [0, 2**32-1]`);
   }
}

export function validateU64(n: bigint, label = 'value'): void {
   if (typeof n !== 'bigint') {
      throw new TypeError(`${label} must be a bigint`);
   }
   if (n < 0n || n > U64_MAX) {
      throw new RangeError(`${label} must be in [0, 2**64-1]`);
   }
}

export function validatePositiveU64(n: bigint, label = 'value'): void {
   validateU64(n, label);
   if (n === 0n) {
      throw new RangeError(`${label} must be > 0`);
   }
}

export function validateBetSide(side: number, mkt: number, label = 'side'): void {
   if (!Number.isInteger(side) || side < 0 || side > 255) {
      throw new RangeError(`${label} must be an integer in 0..=255`);
   }
   const n = numSidesForMkt(mkt);
   if (n === undefined) {
      throw new RangeError(`${label}: unknown mkt ${mkt}`);
   }
   if (side >= n) {
      throw new RangeError(`${label} must be < ${n} for mkt ${mkt}`);
   }
}

export function validateSportEnum(sport: Sport, label = 'sport'): void {
   switch (sport) {
      case Sport.Soccer:
      case Sport.AmericanFootball:
      case Sport.Baseball:
      case Sport.Basketball:
      case Sport.IceHockey:
      case Sport.Tennis:
      case Sport.Cs2:
      case Sport.Dota:
      case Sport.Lol:
      case Sport.Valorant:
         return;
      default:
         throw new RangeError(`${label} is not a valid Sport enum value: ${sport}`);
   }
}

export function validateEventId(e: EventId, label = 'eventId'): void {
   validateU64(e.event, `${label}.event`);
   validateU16(e.league, `${label}.league`);
   validateSportEnum(e.sport, `${label}.sport`);
}

export function validateAddress(addr: string, label = 'address'): void {
   if (typeof addr !== 'string' || addr.length === 0) {
      throw new TypeError(`${label} must be a non-empty Address string`);
   }
}

export function validateMarketId(m: MarketId, label = 'marketId'): void {
   validateEventId(m.eventId, `${label}.eventId`);
   validateAddress(m.operator, `${label}.operator`);
   validateU64(m.player, `${label}.player`);
   validateU16(m.mkt, `${label}.mkt`);
   validateU8(m.period, `${label}.period`);
   if (typeof m.isPregame !== 'boolean') {
      throw new TypeError(`${label}.isPregame must be a boolean`);
   }
}

export function validateGetQuoteIxData(data: GetQuoteIxData, label = 'getQuote'): void {
   validatePositiveU64(data.amount, `${label}.amount`);
   validateOdds(data.oddsScaled, `${label}.oddsScaled`);
   validateMarketId(data.marketId, `${label}.marketId`);
   validateBetSide(data.side, data.marketId.mkt, `${label}.side`);
   validateU16(data.eventStateSequence, `${label}.eventStateSequence`);
   if (data.eventStateSequence === 0) {
      throw new RangeError(`${label}.eventStateSequence must be > 0`);
   }
   validateEventGameState(data.eventGameState, `${label}.eventGameState`);
}

export function validateParlayLegSel(leg: ParlayLegSel, label: string): void {
   validateMarketId(leg.marketId, `${label}.marketId`);
   validateBetSide(leg.side, leg.marketId.mkt, `${label}.side`);
   validateU16(leg.eventStateSequence, `${label}.eventStateSequence`);
   if (leg.eventStateSequence === 0) {
      throw new RangeError(`${label}.eventStateSequence must be > 0`);
   }
   validateEventGameState(leg.eventGameState, `${label}.eventGameState`);
}

export function validateGetQuoteParlayIxData(ix: GetQuoteParlayIxData, label = 'getQuoteParlay'): void {
   validatePositiveU64(ix.amount, `${label}.amount`);
   validateOdds(ix.oddsScaled, `${label}.oddsScaled`);
   validateU8(ix.numLegs, `${label}.numLegs`);
   if (ix.numLegs < 2 || ix.numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`${label}.numLegs must be in [2, ${MAX_PARLAY_LEGS}]`);
   }
   if (ix.legs.length !== ix.numLegs) {
      throw new RangeError(`${label}.legs.length must equal numLegs`);
   }
   for (let i = 0; i < ix.legs.length; i++) {
      validateParlayLegSel(ix.legs[i]!, `${label}.legs[${i}]`);
   }
}

export function validateFillParlayQuoteIxData(ix: FillParlayQuoteIxData, label = 'fillParlayQuote'): void {
   validatePositiveU64(ix.amountToFill, `${label}.amountToFill`);
   validateOdds(ix.oddsScaled, `${label}.oddsScaled`);
   validateU64(ix.amountToSend, `${label}.amountToSend`);
}

export function validateFillQuoteIxData(ix: FillQuoteIxData, label = 'fillQuote'): void {
   validatePositiveU64(ix.amountToFill, `${label}.amountToFill`);
   validateOdds(ix.oddsScaled, `${label}.oddsScaled`);
   validateMarketId(ix.marketId, `${label}.marketId`);
   validateBetSide(ix.side, ix.marketId.mkt, `${label}.side`);
   validateU16(ix.eventStateSequence, `${label}.eventStateSequence`);
   if (ix.eventStateSequence === 0) {
      throw new RangeError(`${label}.eventStateSequence must be > 0`);
   }
   validateEventGameState(ix.eventGameState, `${label}.eventGameState`);
   validateU64(ix.amountToSend, `${label}.amountToSend`);
}

export function validateOdds(odds: bigint, label = 'odds'): void {
   validateU32Bigint(odds, label);
   if (odds <= ODDS_SCALE && odds !== 0n) {
      throw new RangeError(`${label} must be > ODDS_SCALE (${ODDS_SCALE})`);
   }
}

export function validateGetCashoutQuoteIxData(data: GetCashoutQuoteIxData, label = 'getCashoutQuote'): void {
   validatePositiveU64(data.amount, `${label}.amount`);
   validatePositiveU64(data.payout, `${label}.payout`);
   validateU64(data.minPayout, `${label}.minPayout`);
   if (data.minPayout > data.payout) {
      throw new RangeError(`${label}.minPayout must be <= payout`);
   }
   validateMarketId(data.marketId, `${label}.marketId`);
   validateBetSide(data.side, data.marketId.mkt, `${label}.side`);
   validateU16(data.eventStateSequence, `${label}.eventStateSequence`);
   if (data.eventStateSequence === 0) {
      throw new RangeError(`${label}.eventStateSequence must be > 0`);
   }
   validateEventGameState(data.eventGameState, `${label}.eventGameState`);
}

export function validateFillCashoutQuoteIxData(data: FillCashoutQuoteIxData, label = 'fillCashoutQuote'): void {
   validatePositiveU64(data.amount, `${label}.amount`);
   validateU64(data.amountToSend, `${label}.amountToSend`);
   validateMarketId(data.marketId, `${label}.marketId`);
   validateBetSide(data.side, data.marketId.mkt, `${label}.side`);
   validateU16(data.eventStateSequence, `${label}.eventStateSequence`);
   if (data.eventStateSequence === 0) {
      throw new RangeError(`${label}.eventStateSequence must be > 0`);
   }
   validateEventGameState(data.eventGameState, `${label}.eventGameState`);
}

export function validateGetCashoutQuoteParlayIxData(
   ix: GetCashoutQuoteParlayIxData,
   label = 'getCashoutQuoteParlay',
): void {
   validatePositiveU64(ix.amount, `${label}.amount`);
   validatePositiveU64(ix.payout, `${label}.payout`);
   validateU64(ix.minPayout, `${label}.minPayout`);
   if (ix.minPayout > ix.payout) {
      throw new RangeError(`${label}.minPayout must be <= payout`);
   }
   validateU8(ix.numLegs, `${label}.numLegs`);
   if (ix.numLegs < 2 || ix.numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`${label}.numLegs must be in [2, ${MAX_PARLAY_LEGS}]`);
   }
   if (ix.legs.length !== ix.numLegs) {
      throw new RangeError(`${label}.legs.length must equal numLegs`);
   }
   for (let i = 0; i < ix.legs.length; i++) {
      validateParlayLegSel(ix.legs[i]!, `${label}.legs[${i}]`);
   }
}

export function validateFillCashoutQuoteParlayIxData(
   ix: FillCashoutQuoteParlayIxData,
   label = 'fillCashoutQuoteParlay',
): void {
   validatePositiveU64(ix.amount, `${label}.amount`);
   validateU64(ix.amountToSend, `${label}.amountToSend`);
}