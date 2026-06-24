
import { Database } from "bun:sqlite";
import type {
   Sport,
   League,
   Event,
   Market,
   GroupedSport,
   GroupedLeague,
   GroupedEvent,
   PredictionContest,
   PredictionContestToday,
   PredictionContestKind,
   PredictionContestStatus,
   PromotionalMarket,
   PromotionalMarketStatus,
   PromoRelatedEvent,
} from "./types";
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sportsTodayDateString } from './sportsDay';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DB_PATH = path.join(__dirname, "data.db");

export const DB_BUSY_TIMEOUT_MS = 10_000;

let db: Database;

export function getDb(): Database {
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

// console.log(fetchLeagues())
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

function rowsToEventsWithMarketsMap(rows: EventMarketsRow[]): Map<string, Event & { markets: Market[] }> {
   const map = new Map<string, Event & { markets: Market[] }>();
   for (const r of rows) {
      const { markets_json, ...event } = r;
      const markets = JSON.parse(markets_json) as Market[];
      map.set(`${event.sport_id}:${event.league_id}:${event.id}`, { ...event, markets });
   }
   return map;
}

export function fetchEvents(ids: number[] = [], withMarkets: boolean = false): Map<string, Event> | Map<string, Event & { markets: Market[] }> {
   const database = getDb();
   const idFilter = ids.length > 0 ? `WHERE id IN (${ids.map(() => "?").join(",")})` : "";
   const idParams = ids.map((id) => id.toString());
   if (!withMarkets) {
      const rows = database.query<Event, string[]>(`SELECT * FROM events ${idFilter}`).all(...idParams);
      const map = new Map<string, Event>();
      for (const r of rows) {
         map.set(`${r.sport_id}:${r.league_id}:${r.id}`, r);
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

export function fetchUngradedStartedEvents(): Map<string, Event> {
   const database = getDb();
   const rows = database.query<Event, string[]>(`SELECT * FROM events WHERE start_time < ? AND home_score IS NULL AND away_score IS NULL`).all(Date.now().toString());
   const map = new Map<string, Event>();
   for (const r of rows) {
      map.set(`${r.sport_id}:${r.league_id}:${r.id}`, r);
   }
   return map;
}

export function fetchGradedStartedEvents(): Map<string, Event> {
   const database = getDb();
   const rows = database.query<Event, string[]>(`SELECT * FROM events WHERE start_time < ? AND home_score IS NOT NULL AND away_score IS NOT NULL`).all(Date.now().toString());
   const map = new Map<string, Event>();
   for (const r of rows) {
      map.set(`${r.sport_id}:${r.league_id}:${r.id}`, r);
   }
   return map;
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


export function fetchEventsBySport(sportIds: number[] = [], withMarkets: boolean = false): Map<string, Event> | Map<string, Event & { markets: Market[] }> {
   const database = getDb();
   if (!withMarkets) {
      const rows = database.query<Event, string[]>(
         `SELECT * FROM events WHERE sport_id IN (${sportIds.map(() => `?`).join(",")})`
      ).all(...sportIds.map((id) => id.toString()));
      const map = new Map<string, Event>();
      for (const r of rows) {
         map.set(`${r.sport_id}:${r.league_id}:${r.id}`, r);
      }
      return map;
   } else {
      const rows = database.query<EventMarketsRow, string[]>(
         `SELECT e.*, COALESCE(m.markets_json, '[]') AS markets_json FROM events e ${MARKETS_AGG_JOIN} WHERE e.sport_id IN (${sportIds.map(() => `?`).join(",")})`
      ).all(...sportIds.map((id) => id.toString()));
      return rowsToEventsWithMarketsMap(rows);
   }
}

export function fetchEventsByLeague(sportId: number, leagueIds: number[] = [], withMarkets: boolean = false): Map<string, Event> | Map<string, Event & { markets: Market[] }> {
   const database = getDb();
   if (!withMarkets) {
      const rows = database.query<Event, string[]>(
         `SELECT * FROM events WHERE sport_id = ? AND league_id IN (${leagueIds.map(() => `?`).join(",")})`
      ).all(sportId.toString(), ...leagueIds.map((id) => id.toString()));
      const map = new Map<string, Event>();
      for (const r of rows) {
         map.set(`${r.sport_id}:${r.league_id}:${r.id}`, r);
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

export function fetchUpcomingEvents(): Event[] {
   const database = getDb();
   return database.query<Event, string[]>(
      "SELECT * FROM events WHERE start_time > ? ORDER BY start_time ASC"
   ).all(Date.now().toString());
}

export function fetchEventsByEventId(eventId: number): Event[] {
   const database = getDb();
   return database.query<Event, string[]>("SELECT * FROM events WHERE id = ?").all(eventId.toString());
}

export function fetchUpcomingMarkets(): Map<string, Market> {
   const database = getDb();
   const events = database.query<Event, [string]>("SELECT DISTINCT id FROM events WHERE start_time > ?").all(Date.now().toString());
   const evenIds = events.map((e) => e.id);
   const markets = database.query<Market, string[]>(`SELECT * FROM markets WHERE event_id IN (${evenIds.map(() => `?`).join(",")})`).all(...evenIds.map((id) => id.toString()));
   const map = new Map<string, Market>();
   for (const r of markets) {
      map.set(`${r.sport_id}:${r.league_id}:${r.event_id}:${r.period_id}:${r.mkt_string}`, r);
   }
   return map;
}

export function fetchMarket(marketId: number, eventId: number, leagueId: number, sportId: number): Market | null {
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

export function updateEventScore(eventId: number, leagueId: number, sportId: number, home_score: number, away_score: number): void {
   const database = getDb();
   database.query(
      "UPDATE events SET home_score = ?, away_score = ? WHERE id = ? AND league_id = ? AND sport_id = ?"
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
   if (marketId === PROMO_MKT_ID) {
      initPromotionalMarketsTable();
      database.query(
         `UPDATE promotional_markets SET last_odds = ?, last_update = ?
          WHERE sport_id = ? AND league_id = ? AND event_id = ? AND status = 'open'`,
      ).run(odds, timestamp, sportId, leagueId, eventId);
   }
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
   database.query("DELETE FROM events WHERE league_id != 21900").run(eventId);
}

// deleteLeague(11827)
function deleteLeague(leagueId: number): void {
   const database = getDb();
   database.query("DELETE FROM leagues WHERE id = ?").run(leagueId);
}

// ---- Prediction contests (score predict) ----

export function initPredictionContestsTable(): void {
   const database = getDb();
   database.run(`
      CREATE TABLE IF NOT EXISTS prediction_contests (
         id INTEGER PRIMARY KEY,
         contest_date TEXT NOT NULL,
         deadline INTEGER NOT NULL,
         kind TEXT NOT NULL,
         title TEXT NOT NULL,
         description TEXT NOT NULL,
         tweet_template TEXT NOT NULL,
         reply_to_tweet_id TEXT,
         event_sport_id INTEGER,
         event_league_id INTEGER,
         event_id INTEGER,
         home_flag_url TEXT,
         away_flag_url TEXT,
         image_url TEXT,
         status TEXT NOT NULL,
         result_prediction BLOB,
         result_notes TEXT,
         created_at INTEGER NOT NULL,
         graded_at INTEGER
      )
   `);
   migratePredictionContestsTable();
}

function migratePredictionContestsTable(): void {
   const database = getDb();
   const cols = database
      .query<{ name: string }, []>('PRAGMA table_info(prediction_contests)')
      .all();
   if (!cols.some((c) => c.name === 'reply_to_tweet_id')) {
      database.run('ALTER TABLE prediction_contests ADD COLUMN reply_to_tweet_id TEXT');
   }
}

/** Numeric status id or extract from `https://x.com/.../status/123`. */
export function normalizeReplyToTweetId(raw: string | null | undefined): string | null {
   const s = raw?.trim();
   if (!s) {
      return null;
   }
   if (/^\d+$/.test(s)) {
      return s;
   }
   const m = s.match(/status\/(\d+)/i);
   return m?.[1] ?? null;
}

type PredictionContestRow = {
   id: number;
   contest_date: string;
   deadline: number;
   kind: string;
   title: string;
   description: string;
   tweet_template: string;
   reply_to_tweet_id: string | null;
   event_sport_id: number | null;
   event_league_id: number | null;
   event_id: number | null;
   home_flag_url: string | null;
   away_flag_url: string | null;
   image_url: string | null;
   status: string;
   result_prediction: Uint8Array | null;
   result_notes: string | null;
   created_at: number;
   graded_at: number | null;
};

function rowToPredictionContest(row: PredictionContestRow): PredictionContest {
   return {
      id: row.id,
      contest_date: row.contest_date,
      deadline: row.deadline,
      kind: row.kind as PredictionContestKind,
      title: row.title,
      description: row.description,
      tweet_template: row.tweet_template,
      reply_to_tweet_id: row.reply_to_tweet_id,
      event_sport_id: row.event_sport_id,
      event_league_id: row.event_league_id,
      event_id: row.event_id,
      home_flag_url: row.home_flag_url,
      away_flag_url: row.away_flag_url,
      image_url: row.image_url,
      status: row.status as PredictionContestStatus,
      result_prediction: row.result_prediction,
      result_notes: row.result_notes,
      created_at: row.created_at,
      graded_at: row.graded_at,
   };
}

export function contestEntryOpen(contest: PredictionContest, nowMs: number = Date.now()): boolean {
   return contest.status === 'open' && nowMs < contest.deadline;
}


export { sportsTodayDateString } from './sportsDay';

export type AddPredictionContestInput = Omit<
   PredictionContest,
   'id' | 'status' | 'result_prediction' | 'result_notes' | 'graded_at' | 'reply_to_tweet_id'
> & {
   id?: number;
   status?: PredictionContestStatus;
   reply_to_tweet_id?: string | null;
};

export function addPredictionContest(input: AddPredictionContestInput): PredictionContest {
   initPredictionContestsTable();
   const database = getDb();
   const status = input.status ?? 'open';
   const created_at = input.created_at ?? Date.now();
   const reply_to_tweet_id = input.reply_to_tweet_id ?? null;
   if (input.id != null) {
      database
         .query(
            `INSERT OR REPLACE INTO prediction_contests (
               id, contest_date, deadline, kind, title, description, tweet_template, reply_to_tweet_id,
               event_sport_id, event_league_id, event_id, home_flag_url, away_flag_url, image_url,
               status, result_prediction, result_notes, created_at, graded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
         )
         .run(
            input.id,
            input.contest_date,
            input.deadline,
            input.kind,
            input.title,
            input.description,
            input.tweet_template,
            reply_to_tweet_id,
            input.event_sport_id,
            input.event_league_id,
            input.event_id,
            input.home_flag_url,
            input.away_flag_url,
            input.image_url,
            status,
            created_at,
         );
      return fetchPredictionContest(input.id)!;
   }
   const result = database
      .query(
         `INSERT INTO prediction_contests (
            contest_date, deadline, kind, title, description, tweet_template, reply_to_tweet_id,
            event_sport_id, event_league_id, event_id, home_flag_url, away_flag_url, image_url,
            status, result_prediction, result_notes, created_at, graded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
      )
      .run(
         input.contest_date,
         input.deadline,
         input.kind,
         input.title,
         input.description,
         input.tweet_template,
         reply_to_tweet_id,
         input.event_sport_id,
         input.event_league_id,
         input.event_id,
         input.home_flag_url,
         input.away_flag_url,
         input.image_url,
         status,
         created_at,
      );
   const id = Number(result.lastInsertRowid);
   return fetchPredictionContest(id)!;
}

export function fetchPredictionContest(id: number): PredictionContest | null {
   initPredictionContestsTable();
   const database = getDb();
   const row = database
      .query<PredictionContestRow, [string]>(`SELECT * FROM prediction_contests WHERE id = ?`)
      .get(id.toString());
   return row ? rowToPredictionContest(row) : null;
}

export function fetchPredictionContestByDate(date: string): PredictionContest | null {
   initPredictionContestsTable();
   const database = getDb();
   const row = database
      .query<PredictionContestRow, [string]>(
         `SELECT * FROM prediction_contests WHERE contest_date = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(date);
   return row ? rowToPredictionContest(row) : null;
}

export function fetchPredictionContestsHistory(limit: number = 30): PredictionContest[] {
   initPredictionContestsTable();
   const database = getDb();
   const rows = database
      .query<PredictionContestRow, [string]>(
         `SELECT * FROM prediction_contests ORDER BY contest_date DESC, id DESC LIMIT ?`,
      )
      .all(limit.toString());
   return rows.map(rowToPredictionContest);
}

export function listPredictionContests(): PredictionContest[] {
   initPredictionContestsTable();
   const database = getDb();
   const rows = database
      .query<PredictionContestRow, []>(`SELECT * FROM prediction_contests ORDER BY id DESC`)
      .all();
   return rows.map(rowToPredictionContest);
}

export type UpdatePredictionContestPatch = Partial<{
   contest_date: string;
   deadline: number;
   kind: PredictionContestKind;
   title: string;
   description: string;
   tweet_template: string;
   reply_to_tweet_id: string | null;
   event_sport_id: number | null;
   event_league_id: number | null;
   event_id: number | null;
   home_flag_url: string | null;
   away_flag_url: string | null;
   image_url: string | null;
   status: PredictionContestStatus;
   result_notes: string | null;
}>;

const PREDICTION_CONTEST_UPDATE_COLUMNS: Record<keyof UpdatePredictionContestPatch, string> = {
   contest_date: 'contest_date',
   deadline: 'deadline',
   kind: 'kind',
   title: 'title',
   description: 'description',
   tweet_template: 'tweet_template',
   reply_to_tweet_id: 'reply_to_tweet_id',
   event_sport_id: 'event_sport_id',
   event_league_id: 'event_league_id',
   event_id: 'event_id',
   home_flag_url: 'home_flag_url',
   away_flag_url: 'away_flag_url',
   image_url: 'image_url',
   status: 'status',
   result_notes: 'result_notes',
};

export function updatePredictionContest(
   id: number,
   patch: UpdatePredictionContestPatch,
): PredictionContest | null {
   initPredictionContestsTable();
   if (fetchPredictionContest(id) == null) {
      return null;
   }

   const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [
      keyof UpdatePredictionContestPatch,
      UpdatePredictionContestPatch[keyof UpdatePredictionContestPatch],
   ][];
   if (entries.length === 0) {
      return fetchPredictionContest(id);
   }

   const setSql = entries.map(([key]) => `${PREDICTION_CONTEST_UPDATE_COLUMNS[key]} = ?`).join(', ');
   const values: (string | number | Uint8Array | null)[] = entries.map(([, value]) => value as string | number | null);
   getDb()
      .query(`UPDATE prediction_contests SET ${setSql} WHERE id = ?`)
      .run(...values, id);
   return fetchPredictionContest(id);
}

export function updatePredictionContestResult(
   id: number,
   resultPrediction: Uint8Array,
   notes: string | null,
): PredictionContest | null {
   initPredictionContestsTable();
   const database = getDb();
   database
      .query(
         `UPDATE prediction_contests SET
            result_prediction = ?, result_notes = ?, status = 'graded', graded_at = ?
          WHERE id = ?`,
      )
      .run(resultPrediction, notes, Date.now(), id);
   return fetchPredictionContest(id);
}

export function fetchPredictionContestToday(): PredictionContestToday | null {
   const contest = fetchPredictionContestByDate(sportsTodayDateString());
   if (!contest) {
      return null;
   }
   return {
      ...contest,
      entry_open: contestEntryOpen(contest),
   };
}

export function predictionContestToJson(contest: PredictionContest): Record<string, unknown> {
   return {
      ...contest,
      result_prediction:
         contest.result_prediction == null
            ? null
            : Array.from(contest.result_prediction),
   };
}

// ---- Promotional markets ----

export const PROMO_MKT_ID = 9;
export const PROMO_MKT_STRING = "PROMO";

type PromotionalMarketRow = {
   id: number;
   title: string;
   description: string;
   sport_id: number;
   league_id: number;
   event_id: number;
   period_id: number;
   yes_label: string;
   last_odds: string;
   last_update: number;
   status: string;
   winning_side: number | null;
   related_events: string | null;
   closes_at: number | null;
   created_at: number;
   settled_at: number | null;
   settled_notes: string | null;
};

export function initPromotionalMarketsTable(): void {
   const database = getDb();
   database.run(`
      CREATE TABLE IF NOT EXISTS promotional_markets (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         title TEXT NOT NULL,
         description TEXT NOT NULL DEFAULT '',
         sport_id INTEGER NOT NULL,
         league_id INTEGER NOT NULL,
         event_id INTEGER NOT NULL,
         period_id INTEGER NOT NULL,
         yes_label TEXT NOT NULL DEFAULT 'Yes',
         last_odds TEXT NOT NULL,
         last_update INTEGER NOT NULL,
         status TEXT NOT NULL DEFAULT 'open',
         winning_side INTEGER,
         related_events TEXT,
         closes_at INTEGER,
         created_at INTEGER NOT NULL,
         settled_at INTEGER,
         settled_notes TEXT
      )
   `);
}

function parseRelatedEventsJson(raw: string | null): PromoRelatedEvent[] {
   if (!raw) {
      return [];
   }
   const parsed = JSON.parse(raw) as PromoRelatedEvent[];
   return Array.isArray(parsed) ? parsed : [];
}

function rowToPromotionalMarket(row: PromotionalMarketRow): PromotionalMarket {
   return {
      id: row.id,
      title: row.title,
      description: row.description,
      sport_id: row.sport_id,
      league_id: row.league_id,
      event_id: row.event_id,
      period_id: row.period_id,
      yes_label: row.yes_label,
      last_odds: row.last_odds,
      last_update: row.last_update,
      status: row.status as PromotionalMarketStatus,
      winning_side: row.winning_side,
      related_events: parseRelatedEventsJson(row.related_events),
      closes_at: row.closes_at,
      created_at: row.created_at,
      settled_at: row.settled_at,
      settled_notes: row.settled_notes,
   };
}

export type AddPromotionalMarketInput = Omit<
   PromotionalMarket,
   'id' | 'last_update' | 'status' | 'winning_side' | 'settled_at' | 'settled_notes'
>;

export function addPromotionalMarket(input: AddPromotionalMarketInput): PromotionalMarket {
   initPromotionalMarketsTable();
   const database = getDb();
   const now = Date.now();
   database
      .query(
         `INSERT INTO promotional_markets (
            title, description, sport_id, league_id, event_id, period_id,
            yes_label, last_odds, last_update, status, related_events, closes_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      )
      .run(
         input.title,
         input.description,
         input.sport_id,
         input.league_id,
         input.event_id,
         input.period_id,
         input.yes_label,
         input.last_odds,
         now,
         input.related_events.length > 0 ? JSON.stringify(input.related_events) : null,
         input.closes_at,
         input.created_at,
      );
   const id = Number(database.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id);
   return fetchPromotionalMarket(id)!;
}

export function fetchPromotionalMarket(id: number): PromotionalMarket | null {
   initPromotionalMarketsTable();
   const database = getDb();
   const row = database
      .query<PromotionalMarketRow, [string]>(`SELECT * FROM promotional_markets WHERE id = ?`)
      .get(id.toString());
   return row ? rowToPromotionalMarket(row) : null;
}

export function listPromotionalMarkets(): PromotionalMarket[] {
   initPromotionalMarketsTable();
   const database = getDb();
   return database
      .query<PromotionalMarketRow, []>(`SELECT * FROM promotional_markets ORDER BY id DESC`)
      .all()
      .map(rowToPromotionalMarket);
}

export function fetchActivePromotionalMarkets(nowMs: number = Date.now()): PromotionalMarket[] {
   initPromotionalMarketsTable();
   const database = getDb();
   return database
      .query<PromotionalMarketRow, [string]>(
         `SELECT * FROM promotional_markets
          WHERE status = 'open' AND (closes_at IS NULL OR closes_at > ?)
          ORDER BY created_at DESC`,
      )
      .all(nowMs.toString())
      .map(rowToPromotionalMarket);
}

export function fetchPromotionalMarketsForEvent(
   sportId: number,
   leagueId: number,
   eventId: number,
): PromotionalMarket[] {
   initPromotionalMarketsTable();
   const database = getDb();
   return database
      .query<PromotionalMarketRow, string[]>(
         `SELECT * FROM promotional_markets
          WHERE status = 'open'
            AND (
               (sport_id = ? AND league_id = ? AND event_id = ?)
               OR (
                  related_events IS NOT NULL
                  AND EXISTS (
                     SELECT 1 FROM json_each(related_events) AS re
                     WHERE json_extract(re.value, '$.sport_id') = CAST(? AS INTEGER)
                       AND json_extract(re.value, '$.league_id') = CAST(? AS INTEGER)
                       AND json_extract(re.value, '$.event_id') = CAST(? AS INTEGER)
                  )
               )
            )
          ORDER BY created_at DESC`,
      )
      .all(
         sportId.toString(),
         leagueId.toString(),
         eventId.toString(),
         sportId.toString(),
         leagueId.toString(),
         eventId.toString(),
      )
      .map(rowToPromotionalMarket);
}

/** All promos tied to an event (open or settled) — for bet history display. */
export function fetchPromotionalMarketsForEventLookup(
   sportId: number,
   leagueId: number,
   eventId: number,
): PromotionalMarket[] {
   initPromotionalMarketsTable();
   const database = getDb();
   return database
      .query<PromotionalMarketRow, string[]>(
         `SELECT * FROM promotional_markets
          WHERE (
               (sport_id = ? AND league_id = ? AND event_id = ?)
               OR (
                  related_events IS NOT NULL
                  AND EXISTS (
                     SELECT 1 FROM json_each(related_events) AS re
                     WHERE json_extract(re.value, '$.sport_id') = CAST(? AS INTEGER)
                       AND json_extract(re.value, '$.league_id') = CAST(? AS INTEGER)
                       AND json_extract(re.value, '$.event_id') = CAST(? AS INTEGER)
                  )
               )
            )
          ORDER BY created_at DESC`,
      )
      .all(
         sportId.toString(),
         leagueId.toString(),
         eventId.toString(),
         sportId.toString(),
         leagueId.toString(),
         eventId.toString(),
      )
      .map(rowToPromotionalMarket);
}

export function settlePromotionalMarket(
   id: number,
   winningSide: number,
   notes: string | null,
): PromotionalMarket | null {
   initPromotionalMarketsTable();
   const database = getDb();
   const now = Date.now();
   const settledOdds =
      winningSide === 0 ? JSON.stringify([100_000, 0]) : JSON.stringify([0, 100_000]);
   database
      .query(
         `UPDATE promotional_markets SET
            status = 'settled', winning_side = ?, settled_at = ?, settled_notes = ?,
            last_odds = ?, last_update = ?
          WHERE id = ?`,
      )
      .run(winningSide, now, notes, settledOdds, now, id);
   const promo = fetchPromotionalMarket(id);
   if (!promo) {
      return null;
   }
   addMarket({
      id: PROMO_MKT_ID,
      event_id: promo.event_id,
      league_id: promo.league_id,
      sport_id: promo.sport_id,
      period_id: promo.period_id,
      line_value: null,
      last_odds: settledOdds,
      last_update: now,
      mkt_string: PROMO_MKT_STRING,
   });
   return promo;
}

export function promotionalMarketToJson(promo: PromotionalMarket): Record<string, unknown> {
   return { ...promo, mkt_id: PROMO_MKT_ID };
}

// deletePromotionalMarket("Home", 760463)
function deletePromotionalMarket(title: string, eventId: number): void {
   const database = getDb();
   database.query("DELETE FROM markets WHERE id = ? AND event_id = ?").run(PROMO_MKT_ID, eventId);
   // database.query("DELETE FROM promotional_markets WHERE title = ?").run(title);
}