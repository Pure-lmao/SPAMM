import { validateEventId, validateMarketId, validateU16 } from 'spamm-aggregator-sdk';

import type { EventId, MarketId } from './types.js';

export function assertEventId(eventId: EventId): void {
   validateEventId(eventId, 'eventId');
}

export function assertMarketId(marketId: MarketId): void {
   validateMarketId(marketId, 'marketId');
}

export function assertSequence(sequence: number): void {
   validateU16(sequence, 'sequence');
}

export function assertU64(amount: bigint, label: string): void {
   if (amount < 0n || amount > 0xffff_ffff_ffff_ffffn) {
      throw new RangeError(`${label} must fit in a u64`);
   }
}
