import { ODDS_SCALE } from './constants.js';
import {
   MAX_PARLAY_LEGS,
   BetResult,
   Sport,
   type EventGameState,
   type EventId,
   type FillBetIxData,
   type FillParlayIxData,
   type MarketId,
   type ParlayLegWire,
} from './types.js';

const U8_MAX = 255;
export const U16_MAX = 65535;
export const U32_MAX = 0xffff_ffffn;
export const U64_MAX = 2n ** 64n - 1n;
const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;

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

export function validateI64(n: bigint, label = 'value'): void {
   if (typeof n !== 'bigint') {
      throw new TypeError(`${label} must be a bigint`);
   }
   if (n < I64_MIN || n > I64_MAX) {
      throw new RangeError(`${label} must fit signed 64-bit`);
   }
}

export function validateBetSide(_side: number, _mkt: number, _label = 'side'): void {
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
   validateU16(e.league, `${label}.league`);
   validateSportEnum(e.sport, `${label}.sport`);
}

export function validateMarketId(m: MarketId, label = 'marketId'): void {
   validateEventId(m.eventId, `${label}.eventId`);
   validateU64(m.player, `${label}.player`);
   validateU16(m.mkt, `${label}.mkt`);
   validateU8(m.period, `${label}.period`);
   if (typeof m.isPregame !== 'boolean') {
      throw new TypeError(`${label}.isPregame must be a boolean`);
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

export function validateFillBetIxData(data: FillBetIxData, label = 'fillBet'): void {
   validatePositiveU64(data.betId, `${label}.betId`);
   validateMarketId(data.marketId, `${label}.marketId`);
   validateBetSide(data.side, data.marketId.mkt, `${label}.side`);
   validatePositiveU64(data.amount, `${label}.amount`);
   validateU32Bigint(data.minOddsScaled, `${label}.minOddsScaled`);
   if (data.minOddsScaled <= ODDS_SCALE) {
      throw new RangeError(`${label}.minOddsScaled must be > ODDS_SCALE (${ODDS_SCALE})`);
   }
   validateU16(data.eventStateSequence, `${label}.eventStateSequence`);
   if (data.eventStateSequence === 0) {
      throw new RangeError(`${label}.eventStateSequence must be greater than 0`);
   }
   if (data.marketId.isPregame) {
      if (data.eventStateSequence !== 1) {
         throw new RangeError(`${label}.eventStateSequence must be 1 for pregame markets`);
      }
   } else if (data.eventStateSequence < 2) {
      throw new RangeError(`${label}.eventStateSequence must be >= 2 for live markets`);
   }
   validateEventGameState(data.eventGameState, `${label}.eventGameState`);
}

export function validateParlayLegWire(leg: ParlayLegWire, label: string): void {
   validateMarketId(leg.marketId, `${label}.marketId`);
   validateBetSide(leg.side, leg.marketId.mkt, `${label}.side`);
   validateU16(leg.eventStateSequence, `${label}.eventStateSequence`);
   if (leg.eventStateSequence === 0) {
      throw new RangeError(`${label}.eventStateSequence must be greater than 0`);
   }
   if (leg.marketId.isPregame) {
      if (leg.eventStateSequence !== 1) {
         throw new RangeError(`${label}.eventStateSequence must be 1 for pregame markets`);
      }
   } else if (leg.eventStateSequence < 2) {
      throw new RangeError(`${label}.eventStateSequence must be >= 2 for live markets`);
   }
   validateEventGameState(leg.eventGameState, `${label}.eventGameState`);
}

/** Validates fields used by MM `get_quote_parlay` / CPI payload (distinct events, odds hint, legs). */
export function validateGetQuoteParlayIxData(
   ix: { amount: bigint; oddsScaled: bigint; numLegs: number; legs: readonly ParlayLegWire[] },
   label = 'getQuoteParlay',
): void {
   validatePositiveU64(ix.amount, `${label}.amount`);
   validateU32Bigint(ix.oddsScaled, `${label}.oddsScaled`);
   if (ix.oddsScaled <= ODDS_SCALE) {
      throw new RangeError(`${label}.oddsScaled must be > ODDS_SCALE (${ODDS_SCALE})`);
   }
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

export function validateFillParlayIxData(data: FillParlayIxData, label = 'fillParlay'): void {
   validatePositiveU64(data.betId, `${label}.betId`);
   validatePositiveU64(data.amount, `${label}.amount`);
   validateU32Bigint(data.minOddsScaled, `${label}.minOddsScaled`);
   if (data.minOddsScaled <= ODDS_SCALE) {
      throw new RangeError(`${label}.minOddsScaled must be > ODDS_SCALE (${ODDS_SCALE})`);
   }
   validateU8(data.numLegs, `${label}.numLegs`);
   if (data.numLegs < 2 || data.numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`${label}.numLegs must be in [2, ${MAX_PARLAY_LEGS}]`);
   }
   if (data.legs.length !== data.numLegs) {
      throw new RangeError(`${label}.legs.length must equal numLegs`);
   }
   for (let i = 0; i < data.legs.length; i++) {
      validateParlayLegWire(data.legs[i]!, `${label}.legs[${i}]`);
   }
   for (let i = 0; i < data.legs.length; i++) {
      for (let j = i + 1; j < data.legs.length; j++) {
         const ei = data.legs[i]!.marketId.eventId;
         const ej = data.legs[j]!.marketId.eventId;
         if (ei.event === ej.event && ei.league === ej.league && ei.sport === ej.sport) {
            throw new RangeError(`${label}: parlay legs must be on distinct events`);
         }
      }
   }
}

export function validateBetResultGradeByte(b: number, label = 'betResult'): void {
   validateU8(b, label);
   if (b === 0 || b > BetResult.RolledBack) {
      throw new RangeError(`${label} must be in [1, ${BetResult.RolledBack}] for grading`);
   }
}

export function validateGradeBetResults(bytes: Uint8Array, label = 'betResults'): void {
   if (bytes.length === 0) {
      throw new RangeError(`${label} must be non-empty`);
   }
   for (let i = 0; i < bytes.length; i++) {
      validateBetResultGradeByte(bytes[i]!, `${label}[${i}]`);
   }
}

export function validateChangeConfigStatus(status: 0 | 1): void {
   if (status !== 0 && status !== 1) {
      throw new RangeError('status must be 0 (paused) or 1 (unpaused)');
   }
}
