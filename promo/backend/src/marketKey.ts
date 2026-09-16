import type { Address } from '@solana/kit';
import type { EventId, EventGameState, MarketId } from './spammSdk';
import { getEventGameState } from './spammSdk';

/** SLEPMP-style `sport:league:event:period:mkt:player` (player may be empty). */
export type MarketKeyParts = {
   sport: number;
   league: number;
   event: bigint;
   period: number;
   mkt: number;
   player: bigint;
};

export function decodeMarketKey(key: string): MarketKeyParts | null {
   const parts = key.trim().split(':');
   if (parts.length < 5) {
      return null;
   }
   const sport = Number(parts[0]);
   const league = Number(parts[1]);
   const period = Number(parts[3]);
   const mkt = Number(parts[4]);
   if (![sport, league, period, mkt].every(Number.isFinite)) {
      return null;
   }
   try {
      const event = BigInt(parts[2]!);
      const playerRaw = parts[5]?.trim() ?? '';
      const player = playerRaw === '' ? 0n : BigInt(playerRaw);
      return { sport, league, event, period, mkt, player };
   } catch {
      return null;
   }
}

export function marketIdFromKeyParts(parts: MarketKeyParts, operator: Address): MarketId {
   return {
      eventId: { sport: parts.sport, league: parts.league, event: parts.event },
      mkt: parts.mkt,
      period: parts.period,
      isPregame: true,
      player: parts.player,
      operator,
   };
}

export function parseMarketKeyPartsFromFlags(flags: Record<string, string>): MarketKeyParts {
   const marketKey = flags['market-key'];
   if (!marketKey) {
      throw new Error('--market-key required');
   }
   const parts = decodeMarketKey(marketKey);
   if (!parts) {
      throw new Error(`invalid --market-key ${marketKey}`);
   }
   return parts;
}

export function parseEventIdFromFlags(flags: Record<string, string>): EventId {
   const sport = Number(flags.sport);
   const league = Number(flags.league);
   const eventRaw = flags.event;
   if (!Number.isFinite(sport) || !Number.isFinite(league) || eventRaw == null) {
      throw new Error('--sport --league --event required');
   }
   return { sport, league, event: BigInt(eventRaw) };
}

export function parseGameStateFromFlags(flags: Record<string, string>): EventGameState {
   return getEventGameState(
      flags['time-period'] ?? 'PG',
      Number(flags.home ?? 0),
      Number(flags.away ?? 0),
      Number(flags['home-secondary'] ?? 0),
      Number(flags['away-secondary'] ?? 0),
   );
}
