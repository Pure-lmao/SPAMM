import { ODDS_SCALE, MAX_RFQ_PARLAY_LEGS, LIVE_CASHOUT_DELAY, MAX_FREEBET_ALLOWED_MMS, MAX_FREEBET_ALLOWED_OPERATORS, MIN_BET_AMOUNT } from './constants.js';
import { numSidesForMkt } from './helpers.js';
import {
   MAX_PARLAY_LEGS,
   BetResult,
   GRADE_PARLAY_LEG_SKIP,
   Sport,
   type CashoutSnapshot,
   type EventGameState,
   type EventId,
   type FillBetIxData,
   type FillCashoutIxData,
   type FillParlayCashoutIxData,
   type FillRfqBetIxData,
   type FillRfqCashoutIxData,
   type FillRfqParlayCashoutIxData,
   type FillRfqParlayIxData,
   type FillParlayIxData,
   type FillCashoutQuoteIxData,
   type FillCashoutQuoteParlayIxData,
   type GetCashoutQuoteIxData,
   type IssueFreebetIxData,
   type MarketId,
   type ParlayLegQuoted,
   type ParlayLegSel,
   type ParlayLegWire,
   RFQ_SIGNATURE_LEN,
} from './types.js';

function eventIdsEqual(a: EventId, b: EventId): boolean {
   return a.event === b.event && a.league === b.league && a.sport === b.sport;
}

function marketIdsEqual(a: MarketId, b: MarketId): boolean {
   return (
      eventIdsEqual(a.eventId, b.eventId) &&
      a.player === b.player &&
      a.mkt === b.mkt &&
      a.period === b.period &&
      a.isPregame === b.isPregame &&
      a.operator === b.operator
   );
}

/** Reject two legs that share the same `MarketId` (including opposite sides). Matches on-chain. */
export function validateUniqueParlayMarketIds(
   legs: readonly { marketId: MarketId }[],
   label = 'parlay',
): void {
   for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
         if (marketIdsEqual(legs[i]!.marketId, legs[j]!.marketId)) {
            throw new RangeError(`${label}: duplicate marketId at legs ${i} and ${j}`);
         }
      }
   }
}

/** Product of leg odds with `oddsScaled > 0` (one `/ ODDS_SCALE` per leg). Matches on-chain. */
export function productParlayOdds(legs: readonly { oddsScaled: bigint }[]): bigint {
   let prod = ODDS_SCALE;
   for (const leg of legs) {
      if (leg.oddsScaled > 0n) {
         prod = (prod * leg.oddsScaled) / ODDS_SCALE;
      }
   }
   return prod;
}

/** Same-event companion rules for active legs. Matches on-chain `validate_parlay_same_event_odds`. */
export function validateParlaySameEventOdds(
   legs: readonly { marketId: MarketId; oddsScaled: bigint }[],
   label = 'parlay',
): void {
   const n = legs.length;
   for (let i = 0; i < n; i++) {
      const legI = legs[i]!;
      if (legI.oddsScaled === 0n) {
         let hasPositive = false;
         for (let j = 0; j < n; j++) {
            const legJ = legs[j]!;
            if (eventIdsEqual(legI.marketId.eventId, legJ.marketId.eventId) && legJ.oddsScaled > 0n) {
               hasPositive = true;
               break;
            }
         }
         if (!hasPositive) {
            throw new RangeError(
               `${label}: zero-odds leg[${i}] must share event with a positive-odds leg`,
            );
         }
      }
   }

   const seen = new Array<boolean>(n).fill(false);
   for (let i = 0; i < n; i++) {
      if (seen[i]) {
         continue;
      }
      const legI = legs[i]!;
      let groupHasPositive = legI.oddsScaled > 0n;
      seen[i] = true;
      for (let j = i + 1; j < n; j++) {
         const legJ = legs[j]!;
         if (eventIdsEqual(legI.marketId.eventId, legJ.marketId.eventId)) {
            seen[j] = true;
            if (legJ.oddsScaled > 0n) {
               groupHasPositive = true;
            }
         }
      }
      if (!groupHasPositive) {
         throw new RangeError(`${label}: each event group needs at least one positive-odds leg`);
      }
   }
}

/** Sanity: product of positive leg odds equals quoted total. */
export function ensureParlayOddsProductMatches(
   legs: readonly { oddsScaled: bigint }[],
   totalOddsScaled: bigint,
   label = 'parlay',
): void {
   const product = productParlayOdds(legs);
   if (product !== totalOddsScaled) {
      throw new RangeError(`${label}: leg odds product ${product} != total ${totalOddsScaled}`);
   }
}

/**
 * Offer must not be past `offerExpiry` (unix seconds).
 * Matches on-chain: reject when `clock.unix_timestamp > offer_expiry`.
 */
export function validateOfferExpiry(
   offerExpiry: number,
   label = 'offerExpiry',
   nowUnixSecs: number = Math.floor(Date.now() / 1000),
): void {
   validateU32Number(offerExpiry, label);
   if (nowUnixSecs > offerExpiry) {
      throw new RangeError(`${label} has passed (now=${nowUnixSecs}, expiry=${offerExpiry})`);
   }
}

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

/** Fill / issue stake must be at least {@link MIN_BET_AMOUNT}. Cashout remainder is not gated. */
export function validateMinBetAmount(n: bigint, label = 'amount'): void {
   validatePositiveU64(n, label);
   if (n < MIN_BET_AMOUNT) {
      throw new RangeError(`${label} must be >= MIN_BET_AMOUNT (${MIN_BET_AMOUNT})`);
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
   validateMinBetAmount(data.amount, `${label}.amount`);
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

export function validateParlayLegSel(leg: ParlayLegSel, label: string): void {
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

export function validateParlayLegQuoted(leg: ParlayLegQuoted, label: string): void {
   validateParlayLegSel(leg, label);
   validateU32Bigint(leg.oddsScaled, `${label}.oddsScaled`);
}

export function validateParlayLegWire(leg: ParlayLegWire, label: string): void {
   validateParlayLegQuoted(leg, label);
}

/** Validates fields used by MM `get_quote` / CPI payload for a single leg. */
export function validateMmGetQuote(
   quote: {
      amount: bigint;
      minOddsScaled: bigint;
      marketId: MarketId;
      side: number;
      eventStateSequence: number;
      eventGameState: EventGameState;
   },
   label = 'quote',
): void {
   validatePositiveU64(quote.amount, `${label}.amount`);
   validateU32Bigint(quote.minOddsScaled, `${label}.minOddsScaled`);
   if (quote.minOddsScaled <= ODDS_SCALE) {
      throw new RangeError(`${label}.minOddsScaled must be > ODDS_SCALE (${ODDS_SCALE})`);
   }
   validateMarketId(quote.marketId, `${label}.marketId`);
   validateBetSide(quote.side, quote.marketId.mkt, `${label}.side`);
   validateU16(quote.eventStateSequence, `${label}.eventStateSequence`);
   if (quote.eventStateSequence === 0) {
      throw new RangeError(`${label}.eventStateSequence must be > 0`);
   }
   validateEventGameState(quote.eventGameState, `${label}.eventGameState`);
}

/** Validates fields used by MM `get_quote_parlay` / CPI payload (distinct events, odds hint, legs). */
export function validateGetQuoteParlayIxData(
   ix: { amount: bigint; oddsScaled: bigint; numLegs: number; legs: readonly ParlayLegSel[] },
   label = 'getQuoteParlay',
): void {
   validateMinBetAmount(ix.amount, `${label}.amount`);
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
      validateParlayLegSel(ix.legs[i]!, `${label}.legs[${i}]`);
   }
   validateUniqueParlayMarketIds(ix.legs, label);
}

export function validateFillParlayIxData(data: FillParlayIxData, label = 'fillParlay'): void {
   validatePositiveU64(data.betId, `${label}.betId`);
   validateMinBetAmount(data.amount, `${label}.amount`);
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
      validateParlayLegSel(data.legs[i]!, `${label}.legs[${i}]`);
   }
   validateUniqueParlayMarketIds(data.legs, label);
}

export function validateFillRfqBetIxData(
   data: FillRfqBetIxData,
   label = 'fillRfqBet',
   nowUnixSecs?: number,
): void {
   validatePositiveU64(data.betId, `${label}.betId`);
   validateMarketId(data.marketId, `${label}.marketId`);
   validateBetSide(data.side, data.marketId.mkt, `${label}.side`);
   validateMinBetAmount(data.amount, `${label}.amount`);
   validatePositiveU64(data.maxStake, `${label}.maxStake`);
   if (data.amount > data.maxStake) {
      throw new RangeError(`${label}.amount must be <= maxStake`);
   }
   validateU32Bigint(data.oddsScaled, `${label}.oddsScaled`);
   if (data.oddsScaled <= ODDS_SCALE) {
      throw new RangeError(`${label}.oddsScaled must be > ODDS_SCALE (${ODDS_SCALE})`);
   }
   validateOfferExpiry(
      data.offerExpiry,
      `${label}.offerExpiry`,
      nowUnixSecs ?? Math.floor(Date.now() / 1000),
   );
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
   if (data.signature.length !== RFQ_SIGNATURE_LEN) {
      throw new RangeError(`${label}.signature must be ${RFQ_SIGNATURE_LEN} bytes`);
   }
}

export function validateFillRfqParlayIxData(
   data: FillRfqParlayIxData,
   label = 'fillRfqParlay',
   nowUnixSecs?: number,
): void {
   validatePositiveU64(data.betId, `${label}.betId`);
   validateMinBetAmount(data.amount, `${label}.amount`);
   validatePositiveU64(data.maxStake, `${label}.maxStake`);
   if (data.amount > data.maxStake) {
      throw new RangeError(`${label}.amount must be <= maxStake`);
   }
   validateU32Bigint(data.oddsScaled, `${label}.oddsScaled`);
   if (data.oddsScaled <= ODDS_SCALE) {
      throw new RangeError(`${label}.oddsScaled must be > ODDS_SCALE (${ODDS_SCALE})`);
   }
   validateOfferExpiry(
      data.offerExpiry,
      `${label}.offerExpiry`,
      nowUnixSecs ?? Math.floor(Date.now() / 1000),
   );
   validateU8(data.numLegs, `${label}.numLegs`);
   if (data.numLegs < 2 || data.numLegs > MAX_RFQ_PARLAY_LEGS) {
      throw new RangeError(`${label}.numLegs must be in [2, ${MAX_RFQ_PARLAY_LEGS}]`);
   }
   if (data.legs.length !== data.numLegs) {
      throw new RangeError(`${label}.legs.length must equal numLegs`);
   }
   for (let i = 0; i < data.legs.length; i++) {
      const leg = data.legs[i]!;
      validateParlayLegQuoted(leg, `${label}.legs[${i}]`);
   }
   validateUniqueParlayMarketIds(data.legs, label);
   validateParlaySameEventOdds(data.legs, label);
   ensureParlayOddsProductMatches(data.legs, data.oddsScaled, label);
   if (data.signature.length !== RFQ_SIGNATURE_LEN) {
      throw new RangeError(`${label}.signature must be ${RFQ_SIGNATURE_LEN} bytes`);
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

export function validateGradeParlayMask(mask: Uint8Array, label = 'legGradeMask'): void {
   for (let b = 0; b < mask.length; b++) {
      if (b === GRADE_PARLAY_LEG_SKIP) {
         return;
      }
      if (b === 0 || b > BetResult.RolledBack) {
         throw new RangeError(`${label}, ${b} must be ${GRADE_PARLAY_LEG_SKIP} (skip) or in [1, ${BetResult.RolledBack}]`);
      }
   }
}



export function validateChangeConfigStatus(status: 0 | 1): void {
   if (status !== 0 && status !== 1) {
      throw new RangeError('status must be 0 (paused) or 1 (unpaused)');
   }
}

/**
 * Remaining stake after cashing out `cashoutAmount` from `origAmount` (A').
 * Matches on-chain `orig_amount - cashout_amount`.
 */
export function remainingCashoutStake(origAmount: bigint, cashoutAmount: bigint): bigint {
   validatePositiveU64(origAmount, 'origAmount');
   validatePositiveU64(cashoutAmount, 'cashoutAmount');
   if (cashoutAmount > origAmount) {
      throw new RangeError('cashoutAmount must be <= origAmount');
   }
   return origAmount - cashoutAmount;
}

/** Proportional payout removed for a cashout slice. Matches on-chain `proportional_payout`. */
export function proportionalCashoutPayout(
   origAmount: bigint,
   origPayout: bigint,
   cashoutAmount: bigint,
): bigint {
   validatePositiveU64(origAmount, 'origAmount');
   validateU64(origPayout, 'origPayout');
   validatePositiveU64(cashoutAmount, 'cashoutAmount');
   if (cashoutAmount > origAmount) {
      throw new RangeError('cashoutAmount must be <= origAmount');
   }
   return (origPayout * cashoutAmount) / origAmount;
}

/** Remaining payout after cashout (P'). */
export function remainingCashoutPayout(
   origAmount: bigint,
   origPayout: bigint,
   cashoutAmount: bigint,
): bigint {
   const removed = proportionalCashoutPayout(origAmount, origPayout, cashoutAmount);
   return origPayout - removed;
}

/** Matches on-chain `validate_cashout_size`. */
export function validateCashoutSize(
   origAmount: bigint,
   origPayout: bigint,
   cashoutAmount: bigint,
   minPayout: bigint,
   label = 'cashout',
): void {
   validatePositiveU64(origAmount, `${label}.origAmount`);
   validateU64(origPayout, `${label}.origPayout`);
   validatePositiveU64(cashoutAmount, `${label}.amount`);
   validateU64(minPayout, `${label}.minPayout`);
   if (cashoutAmount > origAmount) {
      throw new RangeError(`${label}.amount must be <= origAmount`);
   }
   if (minPayout > origPayout) {
      throw new RangeError(`${label}.minPayout must be <= origPayout`);
   }
}

/**
 * Escrow claim is allowed when `nowUnixSecs >= escrowTimestamp + LIVE_CASHOUT_DELAY`.
 * Matches on-chain `claim_cashout_escrow` delay check.
 */
export function validateCashoutClaimDelay(
   escrowTimestamp: number,
   label = 'cashoutClaim',
   nowUnixSecs: number = Math.floor(Date.now() / 1000),
): void {
   validateU32Number(escrowTimestamp, `${label}.escrowTimestamp`);
   const readyAt = escrowTimestamp + LIVE_CASHOUT_DELAY;
   if (nowUnixSecs < readyAt) {
      throw new RangeError(
         `${label}: delay not elapsed (now=${nowUnixSecs}, readyAt=${readyAt}, delay=${LIVE_CASHOUT_DELAY}s)`,
      );
   }
}

/** Matches on-chain `cashout_requires_delay`: escrow unless still pregame with both sequences < 2. */
export function cashoutRequiresDelay(
   isPregame: boolean,
   origSequence: number,
   quotedSequence: number,
): boolean {
   return !isPregame || origSequence >= 2 || quotedSequence >= 2;
}

/** True if any parlay leg requires live cashout delay. */
export function parlayCashoutRequiresDelay(
   legs: readonly { marketId: MarketId; eventStateSequence: number }[],
   snapshots: readonly CashoutSnapshot[],
): boolean {
   if (legs.length !== snapshots.length) {
      throw new RangeError('parlayCashoutRequiresDelay: legs.length must equal snapshots.length');
   }
   return legs.some((leg, i) =>
      cashoutRequiresDelay(
         leg.marketId.isPregame,
         leg.eventStateSequence,
         snapshots[i]!.eventStateSequence,
      ),
   );
}

function validateCashoutEventSequence(
   eventStateSequence: number,
   isPregame: boolean | undefined,
   label: string,
   origEventStateSequence?: number,
): void {
   validateU16(eventStateSequence, label);
   if (eventStateSequence === 0) {
      throw new RangeError(`${label} must be greater than 0`);
   }
   if (origEventStateSequence !== undefined) {
      validateU16(origEventStateSequence, `${label} orig`);
      if (eventStateSequence < origEventStateSequence) {
         throw new RangeError(
            `${label} must be >= ticket sequence (${origEventStateSequence})`,
         );
      }
   }
   if (isPregame === false && eventStateSequence < 2) {
      throw new RangeError(`${label} must be >= 2 for live markets`);
   }
}

function validateCashoutSnapshots(
   snapshots: readonly CashoutSnapshot[],
   numLegs: number,
   label: string,
   origLegSequences?: readonly number[],
): void {
   if (snapshots.length !== numLegs) {
      throw new RangeError(`${label}.snapshots.length must equal numLegs`);
   }
   if (origLegSequences !== undefined && origLegSequences.length !== numLegs) {
      throw new RangeError(`${label}: origLegSequences.length must equal numLegs`);
   }
   for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i]!;
      validateU16(snap.eventStateSequence, `${label}.snapshots[${i}].eventStateSequence`);
      if (snap.eventStateSequence === 0) {
         throw new RangeError(`${label}.snapshots[${i}].eventStateSequence must be greater than 0`);
      }
      if (origLegSequences !== undefined && snap.eventStateSequence < origLegSequences[i]!) {
         throw new RangeError(
            `${label}.snapshots[${i}].eventStateSequence must be >= ticket leg sequence (${origLegSequences[i]})`,
         );
      }
      validateEventGameState(snap.eventGameState, `${label}.snapshots[${i}].eventGameState`);
   }
}

export type FillCashoutValidateOpts = {
   origAmount?: bigint;
   origPayout?: bigint;
   isPregame?: boolean;
   origEventStateSequence?: number;
};

export function validateFillCashoutIxData(
   data: FillCashoutIxData,
   label = 'fillCashout',
   opts?: FillCashoutValidateOpts,
): void {
   validatePositiveU64(data.origBetId, `${label}.origBetId`);
   validatePositiveU64(data.cashoutId, `${label}.cashoutId`);
   validatePositiveU64(data.amount, `${label}.amount`);
   validateU64(data.minPayout, `${label}.minPayout`);
   if (opts?.origAmount !== undefined && opts.origPayout !== undefined) {
      validateCashoutSize(opts.origAmount, opts.origPayout, data.amount, data.minPayout, label);
   }
   validateCashoutEventSequence(
      data.eventStateSequence,
      opts?.isPregame,
      `${label}.eventStateSequence`,
      opts?.origEventStateSequence,
   );
   validateEventGameState(data.eventGameState, `${label}.eventGameState`);
}

export type FillParlayCashoutValidateOpts = {
   origAmount?: bigint;
   origPayout?: bigint;
   maxLegs?: number;
   origLegSequences?: readonly number[];
};

export function validateFillParlayCashoutIxData(
   data: FillParlayCashoutIxData,
   label = 'fillParlayCashout',
   opts?: FillParlayCashoutValidateOpts,
): void {
   validatePositiveU64(data.origBetId, `${label}.origBetId`);
   validatePositiveU64(data.cashoutId, `${label}.cashoutId`);
   validatePositiveU64(data.amount, `${label}.amount`);
   validateU64(data.minPayout, `${label}.minPayout`);
   if (opts?.origAmount !== undefined && opts.origPayout !== undefined) {
      validateCashoutSize(opts.origAmount, opts.origPayout, data.amount, data.minPayout, label);
   }
   const maxLegs = opts?.maxLegs ?? MAX_PARLAY_LEGS;
   validateU8(data.numLegs, `${label}.numLegs`);
   if (data.numLegs < 2 || data.numLegs > maxLegs) {
      throw new RangeError(`${label}.numLegs must be in [2, ${maxLegs}]`);
   }
   validateCashoutSnapshots(data.snapshots, data.numLegs, label, opts?.origLegSequences);
}

export function validateFillRfqCashoutIxData(
   data: FillRfqCashoutIxData,
   label = 'fillRfqCashout',
   nowUnixSecs?: number,
   opts?: FillCashoutValidateOpts,
): void {
   validateFillCashoutIxData(data, label, opts);
   validatePositiveU64(data.maxPayment, `${label}.maxPayment`);
   if (data.maxPayment < data.minPayout) {
      throw new RangeError(`${label}.maxPayment must be >= minPayout`);
   }
   if (opts?.origPayout !== undefined && data.maxPayment > opts.origPayout) {
      throw new RangeError(`${label}.maxPayment must be <= origPayout`);
   }
   validateOfferExpiry(
      data.offerExpiry,
      `${label}.offerExpiry`,
      nowUnixSecs ?? Math.floor(Date.now() / 1000),
   );
   if (data.signature.length !== RFQ_SIGNATURE_LEN) {
      throw new RangeError(`${label}.signature must be ${RFQ_SIGNATURE_LEN} bytes`);
   }
}

export function validateFillRfqParlayCashoutIxData(
   data: FillRfqParlayCashoutIxData,
   label = 'fillRfqParlayCashout',
   nowUnixSecs?: number,
   opts?: FillParlayCashoutValidateOpts,
): void {
   validateFillParlayCashoutIxData(data, label, {
      ...opts,
      maxLegs: MAX_RFQ_PARLAY_LEGS,
   });
   validatePositiveU64(data.maxPayment, `${label}.maxPayment`);
   if (data.maxPayment < data.minPayout) {
      throw new RangeError(`${label}.maxPayment must be >= minPayout`);
   }
   if (opts?.origPayout !== undefined && data.maxPayment > opts.origPayout) {
      throw new RangeError(`${label}.maxPayment must be <= origPayout`);
   }
   validateOfferExpiry(
      data.offerExpiry,
      `${label}.offerExpiry`,
      nowUnixSecs ?? Math.floor(Date.now() / 1000),
   );
   if (data.signature.length !== RFQ_SIGNATURE_LEN) {
      throw new RangeError(`${label}.signature must be ${RFQ_SIGNATURE_LEN} bytes`);
   }
}

export function validateIssueFreebetIxData(data: IssueFreebetIxData, label = 'issueFreebet'): void {
   validateU32Number(data.freebetId, `${label}.freebetId`);
   if (data.freebetId === 0) {
      throw new RangeError(`${label}.freebetId 0 is reserved for non-freebet tickets`);
   }
   validateU32Number(data.expiry, `${label}.expiry`);
   validateMinBetAmount(data.amount, `${label}.amount`);
   validateU32Bigint(data.minOddsScaled, `${label}.minOddsScaled`);
   validateU32Bigint(data.maxOddsScaled, `${label}.maxOddsScaled`);
   if (data.minOddsScaled === 0n) {
      throw new RangeError(`${label}.minOddsScaled must be > 0`);
   }
   if (data.maxOddsScaled < data.minOddsScaled) {
      throw new RangeError(`${label}.maxOddsScaled must be >= minOddsScaled`);
   }
   validateU8(data.minLegs, `${label}.minLegs`);
   if (data.allowedMms.length > MAX_FREEBET_ALLOWED_MMS) {
      throw new RangeError(`${label}.allowedMms length must be <= ${MAX_FREEBET_ALLOWED_MMS}`);
   }
   if (data.allowedOperators.length > MAX_FREEBET_ALLOWED_OPERATORS) {
      throw new RangeError(
         `${label}.allowedOperators length must be <= ${MAX_FREEBET_ALLOWED_OPERATORS}`,
      );
   }
}

/** Validates fields used by MM `get_cashout_quote` / CPI payload for a single ticket. */
export function validateMmGetCashoutQuote(
   quote: {
      amount: bigint;
      payout: bigint;
      minPayout: bigint;
      marketId: MarketId;
      side: number;
      eventStateSequence: number;
      eventGameState: EventGameState;
   },
   label = 'cashoutQuote',
): void {
   validatePositiveU64(quote.amount, `${label}.amount`);
   validatePositiveU64(quote.payout, `${label}.payout`);
   validateU64(quote.minPayout, `${label}.minPayout`);
   if (quote.minPayout > quote.payout) {
      throw new RangeError(`${label}.minPayout must be <= payout`);
   }
   validateMarketId(quote.marketId, `${label}.marketId`);
   validateBetSide(quote.side, quote.marketId.mkt, `${label}.side`);
   validateU16(quote.eventStateSequence, `${label}.eventStateSequence`);
   if (quote.eventStateSequence === 0) {
      throw new RangeError(`${label}.eventStateSequence must be > 0`);
   }
   validateEventGameState(quote.eventGameState, `${label}.eventGameState`);
}

export function validateGetCashoutQuoteIxData(data: GetCashoutQuoteIxData, label = 'getCashoutQuote'): void {
   validateMmGetCashoutQuote(data, label);
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

/** Validates fields used by MM `get_cashout_quote_parlay` / CPI payload. */
export function validateGetCashoutQuoteParlayIxData(
   ix: { amount: bigint; payout: bigint; minPayout: bigint; numLegs: number; legs: readonly ParlayLegSel[] },
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
   validateUniqueParlayMarketIds(ix.legs, label);
}

export function validateFillCashoutQuoteParlayIxData(
   ix: FillCashoutQuoteParlayIxData,
   label = 'fillCashoutQuoteParlay',
): void {
   validatePositiveU64(ix.amount, `${label}.amount`);
   validateU64(ix.amountToSend, `${label}.amountToSend`);
}
