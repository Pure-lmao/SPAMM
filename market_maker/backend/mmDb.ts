import { Database } from "bun:sqlite";
import { address, type Address } from "@solana/kit";
import type { EventId, MarketId, Sport } from "spamm-aggregator-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Market maker's own state, separate from the API db.
// `events` / `markets` rows are the accounts this MM manages; they are deleted once the event has started and
// every account for it (incl. netting) is closed. The `*onchain` flags are a cache of what has been seen onchain,
// so resetting them is always safe (they are re-verified against chain).

export const MM_DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "mm.db");

export type TrackedMarket = Readonly<{ address: Address; marketId: MarketId }>;

export type TrackedEvent = Readonly<{ eventId: EventId; marketIds: MarketId[] }>;

export type OnchainEventAccounts = Readonly<{ eventState: boolean; markets: Set<Address> }>;

type EventKey = [number, number, bigint];

let db: Database;

function getMmDb(): Database {
   if (!db) {
      db = new Database(MM_DB_PATH, { create: true });
      db.run("PRAGMA journal_mode = WAL");
   }
   return db;
}

function eventKey(eventId: EventId): EventKey {
   return [eventId.sport, eventId.league, eventId.event];
}

export function initMmDb(): void {
   const database = getMmDb();
   database.run(`
      CREATE TABLE IF NOT EXISTS events (
         sport_id INTEGER NOT NULL,
         league_id INTEGER NOT NULL,
         event_id INTEGER NOT NULL,
         start_time INTEGER NOT NULL,
         state_onchain INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (sport_id, league_id, event_id)
      )
   `);
   database.run(`
      CREATE TABLE IF NOT EXISTS markets (
         address TEXT PRIMARY KEY,
         sport_id INTEGER NOT NULL,
         league_id INTEGER NOT NULL,
         event_id INTEGER NOT NULL,
         mkt INTEGER NOT NULL,
         period_id INTEGER NOT NULL,
         player_id INTEGER NOT NULL,
         operator TEXT NOT NULL,
         mint TEXT NOT NULL,
         onchain INTEGER NOT NULL DEFAULT 0
      )
   `);
   database.run("CREATE INDEX IF NOT EXISTS markets_event ON markets (sport_id, league_id, event_id)");
}

/** Start tracking an upcoming event and its markets (idempotent; refreshes `start_time`). */
export function trackEvent(eventId: EventId, startTime: number, markets: readonly TrackedMarket[]): void {
   const database = getMmDb();
   const upsertEvent = database.query(
      `INSERT INTO events (sport_id, league_id, event_id, start_time) VALUES (?, ?, ?, ?)
      ON CONFLICT (sport_id, league_id, event_id) DO UPDATE SET start_time = excluded.start_time`
   );
   const insertMarket = database.query(
      `INSERT OR IGNORE INTO markets (address, sport_id, league_id, event_id, mkt, period_id, player_id, operator, mint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
   );
   database.transaction(() => {
      upsertEvent.run(...eventKey(eventId), startTime);
      for (const { address, marketId } of markets) {
         insertMarket.run(
            address, ...eventKey(eventId), marketId.mkt, marketId.period, marketId.player, marketId.operator, marketId.mint,
         );
      }
   })();
}

export function fetchOnchainEventAccounts(eventId: EventId): OnchainEventAccounts {
   const database = getMmDb();
   const event = database.query<{ state_onchain: number }, EventKey>(
      "SELECT state_onchain FROM events WHERE sport_id = ? AND league_id = ? AND event_id = ?"
   ).get(...eventKey(eventId));
   const markets = database.query<{ address: Address }, EventKey>(
      "SELECT address FROM markets WHERE sport_id = ? AND league_id = ? AND event_id = ? AND onchain = 1"
   ).all(...eventKey(eventId));
   return {
      eventState: event?.state_onchain === 1,
      markets: new Set(markets.map((m) => m.address)),
   };
}

export function markEventStateOnchain(eventId: EventId): void {
   getMmDb().query(
      "UPDATE events SET state_onchain = 1 WHERE sport_id = ? AND league_id = ? AND event_id = ?"
   ).run(...eventKey(eventId));
}

export function markMarketsOnchain(addresses: readonly Address[]): void {
   if (addresses.length === 0) {
      return;
   }
   const database = getMmDb();
   const update = database.query("UPDATE markets SET onchain = 1 WHERE address = ?");
   database.transaction(() => {
      for (const address of addresses) {
         update.run(address);
      }
   })();
}

/** Forget what is known onchain for this event so it is re-verified against chain. */
export function resetEventOnchain(eventId: EventId): void {
   const database = getMmDb();
   database.transaction(() => {
      database.query(
         "UPDATE events SET state_onchain = 0 WHERE sport_id = ? AND league_id = ? AND event_id = ?"
      ).run(...eventKey(eventId));
      database.query(
         "UPDATE markets SET onchain = 0 WHERE sport_id = ? AND league_id = ? AND event_id = ?"
      ).run(...eventKey(eventId));
   })();
}

export function resetAllOnchain(): void {
   const database = getMmDb();
   database.transaction(() => {
      database.run("UPDATE events SET state_onchain = 0");
      database.run("UPDATE markets SET onchain = 0");
   })();
}

/** Tracked events whose start time has passed, with every market tracked for them. */
export function fetchStartedEvents(now: number): TrackedEvent[] {
   const database = getMmDb();
   const events = database.query<{ sport_id: number; league_id: number; event_id: number }, [number]>(
      "SELECT sport_id, league_id, event_id FROM events WHERE start_time <= ?"
   ).all(now);
   const marketsQuery = database.query<
      { mkt: number; period_id: number; player_id: number; operator: string; mint: string },
      EventKey
   >(
      "SELECT mkt, period_id, player_id, operator, mint FROM markets WHERE sport_id = ? AND league_id = ? AND event_id = ?"
   );
   return events.map((e) => {
      const eventId: EventId = { sport: e.sport_id as Sport, league: e.league_id, event: BigInt(e.event_id) };
      const marketIds: MarketId[] = marketsQuery.all(...eventKey(eventId)).map((m) => ({
         eventId,
         player: BigInt(m.player_id),
         mkt: m.mkt,
         period: m.period_id,
         isPregame: true,
         operator: address(m.operator),
         mint: address(m.mint),
      }));
      return { eventId, marketIds };
   });
}

export function deleteEvent(eventId: EventId): void {
   const database = getMmDb();
   database.transaction(() => {
      database.query(
         "DELETE FROM markets WHERE sport_id = ? AND league_id = ? AND event_id = ?"
      ).run(...eventKey(eventId));
      database.query(
         "DELETE FROM events WHERE sport_id = ? AND league_id = ? AND event_id = ?"
      ).run(...eventKey(eventId));
   })();
}
