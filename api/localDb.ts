
import { Database } from "bun:sqlite";
import type { Sport, League, Event, Market, GroupedSport, GroupedLeague, GroupedEvent } from "./types";
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DB_PATH = path.join(__dirname, "data.db");

export const DB_BUSY_TIMEOUT_MS = 10_000;

let db: Database;

function getDb(): Database {
   if (!db) {
      db = new Database(DB_PATH, { create: true });
      db.run("PRAGMA journal_mode = WAL");
      db.run(`PRAGMA busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
   }
   return db;
}

function initSportTable(): void {
   const database = getDb();
   database.run(`
      CREATE TABLE IF NOT EXISTS sports (
         id INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         api_id TEXT NOT NULL
      )
   `);
}

function initLeagueTable(): void {
   const database = getDb();
   database.run(`
      CREATE TABLE IF NOT EXISTS leagues (
         id INTEGER NOT NULL,
         sport_id INTEGER NOT NULL,
         name TEXT NOT NULL,
         abbr TEXT NOT NULL,
         country_code TEXT NOT NULL,
         country_name TEXT NOT NULL,
         country_rank INTEGER NOT NULL,
         api_id TEXT NOT NULL,
         FOREIGN KEY (sport_id) REFERENCES sports (id),
         PRIMARY KEY (id, sport_id)
      );
   `);
}

function initEventTable(): void {
   const database = getDb();
   database.run(`
      CREATE TABLE IF NOT EXISTS events (
         id INTEGER NOT NULL,
         league_id INTEGER NOT NULL,
         sport_id INTEGER NOT NULL,
         home_name TEXT NOT NULL,
         away_name TEXT NOT NULL,
         event_name TEXT NOT NULL,
         start_time INTEGER NOT NULL,
         api_id TEXT NOT NULL,
         home_score INTEGER,
         away_score INTEGER,
         FOREIGN KEY (sport_id) REFERENCES sports (id),
         FOREIGN KEY (league_id) REFERENCES leagues (id),
         PRIMARY KEY (id, league_id, sport_id)
      );
   `);
}

function initMarketTable(): void {
   const database = getDb();
   database.run(`
      CREATE TABLE IF NOT EXISTS markets (
         id INTEGER NOT NULL,
         event_id INTEGER NOT NULL,
         league_id INTEGER NOT NULL,
         sport_id INTEGER NOT NULL,
         period_id INTEGER NOT NULL,
         line_value DECIMAL(5, 2),
         last_odds TEXT NOT NULL,
         last_update INTEGER NOT NULL,
         mkt_string TEXT NOT NULL,
         FOREIGN KEY (event_id) REFERENCES events (event_id),
         FOREIGN KEY (league_id) REFERENCES leagues (id),
         FOREIGN KEY (sport_id) REFERENCES sports (id),
         PRIMARY KEY (id, event_id, league_id, sport_id)
      );
   `);
}

function dropTables(): void {
   const database = getDb();
   database.run(`
      DROP TABLE IF EXISTS sports;
      DROP TABLE IF EXISTS leagues;
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS markets;
   `);
}

export function initTables(): void {
   dropTables();
   initSportTable();
   initLeagueTable();
   initEventTable();
   initMarketTable();
}
// initTables()

// ---- Fetch (whole table) ----

export function fetchSports(ids: number[] = []): Map<number, Sport> {
   const database = getDb();
   const rows = database.query<Sport, string[]>(
      `SELECT * FROM sports ${ids.length > 0 ? `WHERE id IN (${ids.map(() => `?`).join(",")})` : ""}`
   ).all(...ids.map((id) => id.toString()));
   const map = new Map<number, Sport>();
   for (const r of rows) {
      map.set(r.id, r);
   }
   return map;
}

export function fetchLeagues(ids: number[] = []): Map<string, League> {
   const database = getDb();
   const rows = database.query<League, string[]>(
      `SELECT * FROM leagues ${ids.length > 0 ? `WHERE id IN (${ids.map(() => `?`).join(",")})` : ""}`
   ).all(...ids.map((id) => id.toString()));
   const map = new Map<string, League>();
   for (const r of rows) {
      map.set(`${r.sport_id}:${r.id}`, r);
   }
   return map;
}

export function fetchLeaguesBySport(sportId: number): Map<number, League> {
   const database = getDb();
   const rows = database.query<League, string[]>(
      `SELECT * FROM leagues WHERE sport_id = ?`
   ).all(sportId.toString());
   const map = new Map<number, League>();
   for (const r of rows) {
      map.set(r.sport_id, r);
   }
   return map;
}

/** One row per event; `markets_json` is a JSON array of markets (SQLite json_group_array). */
const MARKETS_AGG_JOIN = `
   LEFT JOIN (
      SELECT event_id,
         json_group_array(
            json_object(
               'id', id,
               'event_id', event_id,
               'league_id', league_id,
               'sport_id', sport_id,
               'period_id', period_id,
               'line_value', line_value,
               'last_odds', last_odds,
               'last_update', last_update,
               'mkt_string', mkt_string
            )
         ) AS markets_json
      FROM markets
      GROUP BY event_id
   ) m ON m.event_id = e.id
`;

type EventMarketsRow = Event & { markets_json: string };

function rowsToEventsWithMarketsMap(rows: EventMarketsRow[]): Map<number, Event & { markets: Market[] }> {
   const map = new Map<number, Event & { markets: Market[] }>();
   for (const r of rows) {
      const { markets_json, ...event } = r;
      const markets = JSON.parse(markets_json) as Market[];
      map.set(event.id, { ...event, markets });
   }
   return map;
}

export function fetchEvents(ids: number[] = [], withMarkets: boolean = false): Map<number, Event> | Map<number, Event & { markets: Market[] }> {
   const database = getDb();
   const idFilter = ids.length > 0 ? `WHERE id IN (${ids.map(() => "?").join(",")})` : "";
   const idParams = ids.map((id) => id.toString());
   if (!withMarkets) {
      const rows = database.query<Event, string[]>(`SELECT * FROM events ${idFilter}`).all(...idParams);
      const map = new Map<number, Event>();
      for (const r of rows) {
         map.set(r.id, r);
      }
      return map;
   } else {
      const idFilterAliased = ids.length > 0 ? `WHERE e.id IN (${ids.map(() => "?").join(",")})` : "";
      const rows = database.query<EventMarketsRow, string[]>(
         `SELECT e.*, COALESCE(m.markets_json, '[]') AS markets_json FROM events e ${MARKETS_AGG_JOIN} ${idFilterAliased}`
      ).all(...idParams);
      return rowsToEventsWithMarketsMap(rows);
   }
}

function uniqueSportLeaguePairs(rows: { sport_id: number; league_id: number }[]): [number, number][] {
   const seen = new Set<string>();
   const out: [number, number][] = [];
   for (const r of rows) {
      const k = `${r.sport_id}:${r.league_id}`;
      if (seen.has(k)) {
         continue;
      }
      seen.add(k);
      out.push([r.sport_id, r.league_id]);
   }
   return out;
}

/** Full tree for UI: sports → leagues (that have events) → events; optional `markets` on each event. */
export function fetchEventsGrouped(withMarkets: boolean = false): GroupedSport[] {
   const database = getDb();
   type EvRow = { sport_id: number; league_id: number; start_time: number };
   let rawRows: (Event | EventMarketsRow)[];
   if (withMarkets) {
      rawRows = database.query<EventMarketsRow, string[]>(
         `SELECT e.*, COALESCE(m.markets_json, '[]') AS markets_json FROM events e ${MARKETS_AGG_JOIN} WHERE e.start_time > ? ORDER BY e.sport_id, e.league_id, e.start_time`
      ).all(Date.now().toString());
   } else {
      rawRows = database.query<Event, []>(
         "SELECT * FROM events ORDER BY sport_id, league_id, start_time"
      ).all();
   }

   const toGroupedEvent = (row: Event | EventMarketsRow): GroupedEvent => {
      if (!withMarkets) {
         return row as Event;
      }
      const r = row as EventMarketsRow;
      const { markets_json, ...event } = r;
      return { ...event, markets: JSON.parse(markets_json) as Market[] };
   };

   const eventsBySportLeague = new Map<string, GroupedEvent[]>();
   for (const row of rawRows) {
      const ev = toGroupedEvent(row);
      const key = `${ev.sport_id}:${ev.league_id}`;
      const list = eventsBySportLeague.get(key);
      if (list) {
         list.push(ev);
      } else {
         eventsBySportLeague.set(key, [ev]);
      }
   }

   if (rawRows.length === 0) {
      return [];
   }

   const sportIds = [...new Set((rawRows as EvRow[]).map((r) => r.sport_id))].sort((a, b) => a - b);
   const pairs = uniqueSportLeaguePairs(rawRows as EvRow[]);

   const leaguePlaceholders = pairs.map(() => "(?,?)").join(",");
   const leagueParams = pairs.flatMap(([sportId, leagueId]) => [sportId.toString(), leagueId.toString()]);
   const leagueRows =
      pairs.length === 0
         ? []
         : database.query<League, string[]>(
              `SELECT * FROM leagues WHERE (sport_id, id) IN (VALUES ${leaguePlaceholders})`
           ).all(...leagueParams);

   const leagueByKey = new Map<string, League>();
   for (const L of leagueRows) {
      leagueByKey.set(`${L.sport_id}:${L.id}`, L);
   }

   const sportPlaceholders = sportIds.map(() => "?").join(",");
   const sportRows = database.query<Sport, string[]>(
      `SELECT * FROM sports WHERE id IN (${sportPlaceholders}) ORDER BY id`
   ).all(...sportIds.map((id) => id.toString()));

   const sportById = new Map<number, Sport>();
   for (const s of sportRows) {
      sportById.set(s.id, s);
   }

   const result: GroupedSport[] = [];
   for (const sportId of sportIds) {
      const meta = sportById.get(sportId);
      if (!meta) {
         continue;
      }
      const leagueIdsForSport = [
         ...new Set(
            pairs.filter(([sid]) => sid === sportId).map(([, lid]) => lid)
         ),
      ].sort((a, b) => a - b);

      const leagues: GroupedLeague[] = [];
      for (const leagueId of leagueIdsForSport) {
         const L = leagueByKey.get(`${sportId}:${leagueId}`);
         if (!L) {
            continue;
         }
         const events = eventsBySportLeague.get(`${sportId}:${leagueId}`) ?? [];
         leagues.push({
            ...L,
            events,
         });
      }

      result.push({
         id: meta.id,
         sport: meta.name,
         name: meta.name,
         api_id: meta.api_id,
         leagues,
      });
   }

   return result;
}


export function fetchEventsBySport(sportIds: number[] = [], withMarkets: boolean = false): Map<number, Event> | Map<number, Event & { markets: Market[] }> {
   const database = getDb();
   if (!withMarkets) {
      const rows = database.query<Event, string[]>(
         `SELECT * FROM events WHERE sport_id IN (${sportIds.map(() => `?`).join(",")})`
      ).all(...sportIds.map((id) => id.toString()));
      const map = new Map<number, Event>();
      for (const r of rows) {
         map.set(r.id, r);
      }
      return map;
   } else {
      const rows = database.query<EventMarketsRow, string[]>(
         `SELECT e.*, COALESCE(m.markets_json, '[]') AS markets_json FROM events e ${MARKETS_AGG_JOIN} WHERE e.sport_id IN (${sportIds.map(() => `?`).join(",")})`
      ).all(...sportIds.map((id) => id.toString()));
      return rowsToEventsWithMarketsMap(rows);
   }
}

export function fetchEventsByLeague(sportId: number, leagueIds: number[] = [], withMarkets: boolean = false): Map<number, Event> | Map<number, Event & { markets: Market[] }> {
   const database = getDb();
   if (!withMarkets) {
      const rows = database.query<Event, string[]>(
         `SELECT * FROM events WHERE sport_id = ? AND league_id IN (${leagueIds.map(() => `?`).join(",")})`
      ).all(sportId.toString(), ...leagueIds.map((id) => id.toString()));
      const map = new Map<number, Event>();
      for (const r of rows) {
         map.set(r.id, r);
      }
      return map;
   } else {
      const rows = database.query<EventMarketsRow, string[]>(
         `SELECT e.*, COALESCE(m.markets_json, '[]') AS markets_json FROM events e ${MARKETS_AGG_JOIN} WHERE e.sport_id = ? AND e.league_id IN (${leagueIds.map(() => `?`).join(",")})`
      ).all(sportId.toString(), ...leagueIds.map((id) => id.toString()));
      return rowsToEventsWithMarketsMap(rows);
   }
}

export function fetchMarkets(): Map<string, Market> {
   const database = getDb();
   const rows = database.query<Market, []>("SELECT * FROM markets").all();
   const map = new Map<string, Market>();
   for (const r of rows) {
      map.set(`${r.sport_id}:${r.league_id}:${r.event_id}:${r.period_id}:${r.mkt_string}`, r);
   }
   return map;
}

function fetchMarket(marketId: number, eventId: number, leagueId: number, sportId: number): Market | null {
   const database = getDb();
   const row = database.query<Market, string[]>(
      "SELECT * FROM markets WHERE id = ? AND event_id = ? AND league_id = ? AND sport_id = ?"
   ).get(marketId.toString(), eventId.toString(), leagueId.toString(), sportId.toString());
   return row;
}

// ---- Add / upsert ----

export function addSport(sportId: number, meta: Sport): void {
   const database = getDb();
   database.query(
      "INSERT OR REPLACE INTO sports (id, name, api_id) VALUES (?, ?, ?)"
   ).run(sportId, meta.name, meta.api_id);
}

export function addLeague(leagueId: number, meta: League): void {
   const database = getDb();
   database.query(
      "INSERT OR REPLACE INTO leagues (id, sport_id, name, abbr, country_code, country_name, country_rank, api_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
   ).run(
      leagueId,
      meta.sport_id,
      meta.name,
      meta.abbr,
      meta.country_code,
      meta.country_name,
      meta.country_rank,
      meta.api_id
   );
}

export function addEvent(eventId: number, meta: Event): void {
   const database = getDb();
   database.query(
      "INSERT OR REPLACE INTO events (id, league_id, sport_id, home_name, away_name, event_name, start_time, api_id, home_score, away_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
   ).run(eventId, meta.league_id, meta.sport_id, meta.home_name, meta.away_name, meta.event_name, meta.start_time, meta.api_id, meta.home_score, meta.away_score);
}

export function updateEvent(eventId: number, leagueId: number, sportId: number, home_score: number, away_score: number): void {
   const database = getDb();
   database.query(
      "UPDATE events SET home_score = ?, away_score = ? WHERE id = ?, league_id = ?, sport_id = ?"
   ).run(home_score, away_score, eventId, leagueId, sportId);
}

export function addMarket(meta: Market): void {
   const database = getDb();
   database.query(
      "INSERT OR REPLACE INTO markets (id, event_id, league_id, sport_id, period_id, line_value, last_odds, last_update, mkt_string) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
   ).run(
      meta.id,
      meta.event_id,
      meta.league_id,
      meta.sport_id,
      meta.period_id,
      meta.line_value,
      meta.last_odds,
      meta.last_update,
      meta.mkt_string
   );
}
// addMarket({
//    id: 0,
//    event_id: 740963,
//    league_id: 11827,
//    sport_id: 1,
//    period_id: 0,
//    line_value: null,
//    last_odds: "[20000, 20000]",
//    last_update: 1,
//    mkt_string: "TQ",
// });
// addMarket({
//    id: 61,
//    event_id: 740963,
//    league_id: 11827,
//    sport_id: 1,
//    period_id: 1,
//    line_value: null,
//    last_odds: "[19000, 18000]",
//    last_update: 1,
//    mkt_string: "OU 2.75",
// });
// addMarket({
//    id: 396,
//    event_id: 740963,
//    league_id: 11827,
//    sport_id: 1,
//    period_id: 1,
//    line_value: null,
//    last_odds: "[21000, 18000]",
//    last_update: 1,
//    mkt_string: "AH -1.0",
// });

export function updateMarket(marketId: number, eventId: number, leagueId: number, sportId: number, odds: string, timestamp: number): void {
   const database = getDb();
   database.query(
      "UPDATE markets SET last_odds = ?, last_update = ? WHERE id = ? AND event_id = ? AND league_id = ? AND sport_id = ?"
   ).run(odds, timestamp, marketId, eventId, leagueId, sportId);
}

export function getLeagues(): { api_id: string; sport_id: number; id: number }[] {
   const database = getDb();
   const rows = database.query<{ api_id: string; sport_id: number; id: number }, []>(
      "SELECT api_id, sport_id, id FROM leagues WHERE api_id IS NOT NULL"
   ).all();
   return rows.map((r) => ({ api_id: r.api_id, sport_id: r.sport_id, id: r.id }));
}

export function getEventsByApiId(): Map<string, Event> {
   const database = getDb();
   const rows = database.query<Event, []>("SELECT * FROM events WHERE api_id IS NOT NULL").all();
   const map = new Map<string, Event>();
   for (const row of rows) {
      map.set(row.api_id, row);
   }
   return map;
}


// addEvent(2001, {
//    eventId: 2001,
//    subCategoryId: Number(`${0}${1}${827}`),
//    categoryId: 1,
//    eventName: "Arsenal vs Everton",
//    startTime: 1772978400,
//    eventSlug: "arsenal-vs-everton-2026-03-08",
//    homeName: "Arsenal",
//    awayName: "Everton",
//    homeImage: "https://upload.wikimedia.org/wikipedia/en/5/53/Arsenal_FC.svg",
//    awayImage: "https://upload.wikimedia.org/wikipedia/en/7/7c/Everton_FC_logo.svg",
// })

// deleteEvent("45df97b54d688962ca73235c4837a580")
function deleteEvent(eventId: string): void {
   const database = getDb();
   database.query("DELETE FROM events WHERE api_event_id = ?").run(eventId);
}