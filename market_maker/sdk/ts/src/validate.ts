import { ODDS_SCALE } from './constants.js';
import { Sport, type EventId, type GetQuoteIxData, type MarketId } from './types.js';

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
   if (!Number.isInteger(side) || side < 0 || side > 2) {
      throw new RangeError(`${label} must be 0, 1, or 2`);
   }
   if (side === 2 && mkt !== 1 && mkt !== 5) {
      throw new RangeError(`${label} may be 2 only when mkt is 1 or 5`);
   }
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

export function validateOdds(odds: bigint, label = 'odds'): void {
   validateU32Bigint(odds, label);
   if (odds <= ODDS_SCALE) {
      throw new RangeError(`${label} must be > ODDS_SCALE (${ODDS_SCALE})`);
   }
}