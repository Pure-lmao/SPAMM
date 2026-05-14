import { ODDS_SCALE } from './constants.js';
import {
   MAX_PARLAY_LEGS,
   Sport,
   type EventId,
   type FillParlayQuoteIxData,
   type GetQuoteIxData,
   type GetQuoteParlayIxData,
   type MarketId,
   type ParlayLegWire,
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
   if (b.length !== 32) {
      throw new RangeError(`${label} must be exactly 32 bytes`);
   }
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
   // SIDECHECK
   //temporary disable side validation until I can be bothered coding it
   return;
}

export function validateSportEnum(sport: Sport, label = 'sport'): void {
   switch (sport) {
      case Sport.Soccer:
      case Sport.AmericanFootball:
      case Sport.Baseball:
      case Sport.Basketball:
      case Sport.IceHockey:
         return;
      default:
         throw new RangeError(`${label} is not a valid Sport enum value: ${sport}`);
   }
}

export function validateEventId(e: EventId, label = 'eventId'): void {
   validateU64(e.event, `${label}.event`);
   validateU32Number(e.league, `${label}.league`);
   validateSportEnum(e.sport, `${label}.sport`);
}

export function validateMarketId(m: MarketId, label = 'marketId'): void {
   validateEventId(m.eventId, `${label}.eventId`);
   validateU64(m.player, `${label}.player`);
   validateU32Number(m.mkt, `${label}.mkt`);
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
   if (data.eventStateHash.byteLength !== 32) {
      throw new RangeError(`${label}.eventStateHash must be 32 bytes`);
   }
}

export function validateParlayLegWire(leg: ParlayLegWire, label: string): void {
   validateMarketId(leg.marketId, `${label}.marketId`);
   validateBetSide(leg.side, leg.marketId.mkt, `${label}.side`);
   validateU16(leg.eventStateSequence, `${label}.eventStateSequence`);
   if (leg.eventStateSequence === 0) {
      throw new RangeError(`${label}.eventStateSequence must be > 0`);
   }
   if (leg.eventStateHash.byteLength !== 32) {
      throw new RangeError(`${label}.eventStateHash must be 32 bytes`);
   }
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
      validateParlayLegWire(ix.legs[i]!, `${label}.legs[${i}]`);
   }
   for (let i = 0; i < ix.legs.length; i++) {
      for (let j = i + 1; j < ix.legs.length; j++) {
         const ei = ix.legs[i]!.marketId.eventId;
         const ej = ix.legs[j]!.marketId.eventId;
         if (ei.event === ej.event && ei.league === ej.league && ei.sport === ej.sport) {
            throw new RangeError(`${label}: parlay legs must be on distinct events`);
         }
      }
   }
}

export function validateFillParlayQuoteIxData(ix: FillParlayQuoteIxData, label = 'fillParlayQuote'): void {
   validatePositiveU64(ix.amountToFill, `${label}.amountToFill`);
   validateOdds(ix.oddsScaled, `${label}.oddsScaled`);
   validateU64(ix.amountToSend, `${label}.amountToSend`);
}

export function validateOdds(odds: bigint, label = 'odds'): void {
   validateU32Bigint(odds, label);
   if (odds <= ODDS_SCALE) {
      throw new RangeError(`${label} must be > ODDS_SCALE (${ODDS_SCALE})`);
   }
}