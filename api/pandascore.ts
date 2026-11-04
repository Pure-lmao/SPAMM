import type { DbEvent, DbEventPeriodResult, DbLeague, PandaScoreMatch, PandaScoreOpponent, PandaScoreTier } from "./types";
import { addEvent, addLeague, addMarket, fetchEvents, fetchLeagues, fetchMarket, fetchSports, fetchUngradedEventsSince, fetchUngradedStartedEvents, setEventResults, updateEventStartTime } from "./localDb";
import { DEFAULT_MARKET_OPERATOR, DEFAULT_MINT, safeJSONStringify } from "./utils";

const PANDASCORE_API_URL = "https://api.pandascore.co";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const DAY_MS = 1000 * 60 * 60 * 24;
const MAX_LEAGUE_ID = 65535;

export const PANDASCORE_DAYS_AHEAD = 3;
/** How far back `updateEsportsStartTimes` looks for unsettled events (delayed matches drop out of `/upcoming`). */
const START_TIME_LOOKBACK_MS = DAY_MS;

/** Map N is period 10 + N (`id-system.md`); period 21 is overtime, so maps stop at 10. */
export const MAP_PERIOD_BASE = 10;
export const MAX_MAP_PERIOD = 20;

type PandaScoreSportConfig = {
   sportId: number;
   /** Game prefix in PandaScore routes, e.g. `csgo` → `/csgo/matches/upcoming`. */
   path: string;
   tiers: PandaScoreTier[];
   filters?: Record<string, string>;
};

export const PANDASCORE_SPORTS: PandaScoreSportConfig[] = [
   { sportId: 101, path: "csgo", tiers: ["s", "a"], filters: { "filter[videogame_title]": "cs-2" } },
   { sportId: 102, path: "dota2", tiers: ["s", "a"] },
   { sportId: 103, path: "lol", tiers: ["s", "a"] },
   { sportId: 104, path: "valorant", tiers: ["s", "a"] },
];

export function isPandaScoreSport(sportId: number): boolean {
   return PANDASCORE_SPORTS.some((s) => s.sportId === sportId);
}

type PlannedMarket = {
   id: number;
   period_id: number;
   mkt_string: string;
   numSides: number;
};

type EsportsEventResult = {
   homeScore: number;
   awayScore: number;
   periods: DbEventPeriodResult[];
};

async function pandaScoreGet<T>(path: string, params: Record<string, string>): Promise<T> {
   const apiKey = process.env.PANDA_API_KEY;
   if (!apiKey) {
      throw new Error("PANDA_API_KEY is not set");
   }
   const url = new URL(path, PANDASCORE_API_URL);
   for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
   }
   const response = await fetch(url, {
      headers: {
         'Accept': 'application/json',
         'Authorization': `Bearer ${apiKey}`,
      },
   });
   if (!response.ok) {
      throw new Error(`PandaScore ${url.pathname} returned ${response.status}: ${await response.text()}`);
   }
   return await response.json() as T;
}

async function getUpcomingMatches(config: PandaScoreSportConfig, numberOfDays: number): Promise<PandaScoreMatch[]> {
   const now = new Date();
   const end = new Date(now.getTime() + numberOfDays * DAY_MS);
   const matches: PandaScoreMatch[] = [];
   for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await pandaScoreGet<PandaScoreMatch[]>(`/${config.path}/matches/upcoming`, {
         ...config.filters,
         "filter[opponents_filled]": "true",
         "range[scheduled_at]": `${now.toISOString()},${end.toISOString()}`,
         "sort": "scheduled_at",
         "per_page": String(PAGE_SIZE),
         "page": String(page),
      });
      matches.push(...data);
      if (data.length < PAGE_SIZE) {
         break;
      }
   }
   return matches;
}

async function getMatchesById(config: PandaScoreSportConfig, ids: number[]): Promise<PandaScoreMatch[]> {
   const matches: PandaScoreMatch[] = [];
   for (let i = 0; i < ids.length; i += PAGE_SIZE) {
      const batch = ids.slice(i, i + PAGE_SIZE);
      const data = await pandaScoreGet<PandaScoreMatch[]>(`/${config.path}/matches`, {
         "filter[id]": batch.join(","),
         "per_page": String(PAGE_SIZE),
      });
      matches.push(...data);
   }
   return matches;
}

function getTeams(match: PandaScoreMatch): [PandaScoreOpponent, PandaScoreOpponent] | null {
   if (match.opponents.length !== 2 || match.opponents.some((o) => o.type !== "Team")) {
      return null;
   }
   const home = match.opponents[0]!.opponent;
   const away = match.opponents[1]!.opponent;
   if (home.id === away.id || home.name === away.name) {
      return null;
   }
   return [home, away];
}

function getUpcomingEsportsEvent(match: PandaScoreMatch, sport_id: number): DbEvent | null {
   if (match.status !== "not_started" || !match.scheduled_at || match.league_id > MAX_LEAGUE_ID) {
      return null;
   }
   const teams = getTeams(match);
   if (!teams) {
      return null;
   }
   const [home, away] = teams;
   return {
      id: match.id,
      league_id: match.league_id,
      sport_id,
      home_name: home.name,
      away_name: away.name,
      event_name: `${home.name} vs ${away.name}`,
      start_time: new Date(match.scheduled_at).getTime(),
      api_id: String(match.id),
      home_score: null,
      away_score: null,
   };
}

function getEsportsLeague(match: PandaScoreMatch, sport_id: number): DbLeague {
   return {
      id: match.league.id,
      sport_id,
      name: match.league.name,
      abbr: match.league.name,
      country_code: "900",
      country_name: "International",
      country_rank: 1,
      variation: 1,
      api_id: String(match.league.id),
   };
}

/**
 * bo1/bo3/bo5: ML. bo2: 1X2. Map winners: maps 1-2 for bo2/bo3, maps 1 to N-1 for bo5+.
 * A game advantage counts as map 1 being won already, so played maps start at map 2.
 */
function getMatchMarkets(match: PandaScoreMatch): PlannedMarket[] {
   const numberOfGames = match.number_of_games;
   const isBestOf = match.match_type === "best_of" || (match.match_type === "all_games_played" && numberOfGames === 2);
   if (!isBestOf || numberOfGames < 1) {
      return [];
   }

   const markets: PlannedMarket[] = [];
   if (numberOfGames === 2) {
      markets.push({ id: 1, period_id: 0, mkt_string: "1X2", numSides: 3 });
   } else if (numberOfGames % 2 === 1) {
      markets.push({ id: 0, period_id: 0, mkt_string: "ML", numSides: 2 });
   } else {
      return [];
   }

   const advantage = match.game_advantage === null ? 0 : 1;
   const lastMap = numberOfGames === 2 ? 2 : numberOfGames - 1;
   for (let map = 1 + advantage; map <= lastMap && MAP_PERIOD_BASE + map <= MAX_MAP_PERIOD; map++) {
      markets.push({ id: 0, period_id: MAP_PERIOD_BASE + map, mkt_string: "ML", numSides: 2 });
   }
   return markets;
}

function voidPeriod(event: DbEvent, period_id: number): DbEventPeriodResult {
   return {
      event_id: event.id,
      league_id: event.league_id,
      sport_id: event.sport_id,
      period_id,
      home_score: null,
      away_score: null,
      is_void: 1,
   };
}

/**
 * Teams are matched by name, not `opponents` order, so a reordered feed can't flip home/away.
 * Returns null when the match isn't settled yet or the data doesn't add up (retried next run).
 */
function getEsportsEventResult(match: PandaScoreMatch, event: DbEvent): EsportsEventResult | null {
   if (match.status === "canceled") {
      return { homeScore: 0, awayScore: 0, periods: [voidPeriod(event, 0)] };
   }
   if (match.status !== "finished") {
      return null;
   }

   const home = match.opponents.find((o) => o.opponent.name === event.home_name)?.opponent;
   const away = match.opponents.find((o) => o.opponent.name === event.away_name)?.opponent;
   if (!home || !away || home.id === away.id) {
      console.warn(`PandaScore match ${match.id} teams no longer match event ${event.id} (${event.event_name}); skipping`);
      return null;
   }
   const homeScore = match.results.find((r) => r.team_id === home.id)?.score;
   const awayScore = match.results.find((r) => r.team_id === away.id)?.score;
   if (homeScore === undefined || awayScore === undefined) {
      return null;
   }

   const advantage = match.game_advantage === null ? 0 : 1;
   let homeMaps = match.game_advantage === home.id ? 1 : 0;
   let awayMaps = match.game_advantage === away.id ? 1 : 0;
   const periods: DbEventPeriodResult[] = [];
   if (match.forfeit) {
      periods.push(voidPeriod(event, 0));
   }
   for (const game of match.games) {
      if (game.status !== "finished") {
         continue;
      }
      const period_id = MAP_PERIOD_BASE + game.position + advantage;
      const homeWon = game.winner.id === home.id;
      const awayWon = game.winner.id === away.id;
      if (!homeWon && !awayWon) {
         if (match.forfeit) {
            periods.push(voidPeriod(event, period_id));
            continue;
         }
         return null;
      }
      homeMaps += homeWon ? 1 : 0;
      awayMaps += awayWon ? 1 : 0;
      if (game.forfeit) {
         periods.push(voidPeriod(event, period_id));
      } else {
         periods.push({
            event_id: event.id,
            league_id: event.league_id,
            sport_id: event.sport_id,
            period_id,
            home_score: homeWon ? 1 : 0,
            away_score: awayWon ? 1 : 0,
            is_void: 0,
         });
      }
   }

   if (!match.forfeit && (homeMaps !== homeScore || awayMaps !== awayScore)) {
      console.warn(`PandaScore match ${match.id} games (${homeMaps}-${awayMaps}) don't match results (${homeScore}-${awayScore}); skipping`);
      return null;
   }
   return { homeScore, awayScore, periods };
}

export async function setUpcomingEsportsEvents() {
   console.log("Setting upcoming esports events");
   const sports = fetchSports();
   const leagues = fetchLeagues();
   const events = fetchEvents();

   for (const config of PANDASCORE_SPORTS) {
      if (!sports.has(config.sportId)) {
         console.warn(`sport id ${config.sportId} is not in the sports table; skipping PandaScore ${config.path}`);
         continue;
      }

      let matches: PandaScoreMatch[];
      try {
         matches = await getUpcomingMatches(config, PANDASCORE_DAYS_AHEAD);
      } catch (error) {
         console.error(`Failed to fetch PandaScore ${config.path} matches:`, error instanceof Error ? error.message : error);
         continue;
      }

      for (const match of matches) {
         if (!match.tournament.tier || !config.tiers.includes(match.tournament.tier)) {
            continue;
         }
         const dbEvent = getUpcomingEsportsEvent(match, config.sportId);
         if (!dbEvent) {
            continue;
         }
         const plannedMarkets = getMatchMarkets(match);
         if (plannedMarkets.length === 0) {
            continue;
         }

         const leagueKey = `${config.sportId}:${dbEvent.league_id}`;
         if (!leagues.has(leagueKey)) {
            const league = getEsportsLeague(match, config.sportId);
            addLeague(league.id, league);
            leagues.set(leagueKey, league);
         }

         const existing = events.get(`${config.sportId}:${dbEvent.league_id}:${dbEvent.id}`);
         if (!existing) {
            addEvent(dbEvent.id, dbEvent);
         } else {
            if (existing.home_name !== dbEvent.home_name || existing.away_name !== dbEvent.away_name) {
               console.warn(`PandaScore match ${match.id} is now ${dbEvent.event_name}, event has ${existing.event_name}; skipping`);
               continue;
            }
            if (existing.start_time !== dbEvent.start_time && existing.home_score === null) {
               updateEventStartTime(dbEvent.id, dbEvent.league_id, dbEvent.sport_id, dbEvent.start_time);
            }
         }

         const last_update = new Date().getTime();
         for (const planned of plannedMarkets) {
            if (fetchMarket(planned.id, dbEvent.id, dbEvent.league_id, dbEvent.sport_id, planned.period_id, 0)) {
               continue;
            }
            addMarket({
               id: planned.id,
               event_id: dbEvent.id,
               league_id: dbEvent.league_id,
               sport_id: dbEvent.sport_id,
               player_id: 0,
               player_name: "",
               last_odds: safeJSONStringify(Array.from({ length: planned.numSides }, () => 0)),
               last_update,
               mkt_string: planned.mkt_string,
               period_id: planned.period_id,
               line_value: null,
               operator: DEFAULT_MARKET_OPERATOR,
               mint: DEFAULT_MINT,
            });
         }
      }
   }
   console.log("Set upcoming esports events");
}

/** Not started: latest `scheduled_at`. Running/finished: actual `begin_at`, which can be before `scheduled_at`. */
function getMatchStartTime(match: PandaScoreMatch): number | null {
   if (match.status === "not_started" || match.status === "postponed") {
      return match.scheduled_at ? new Date(match.scheduled_at).getTime() : null;
   }
   if (match.status === "running" || match.status === "finished") {
      return match.begin_at ? new Date(match.begin_at).getTime() : null;
   }
   return null;
}

export async function updateEsportsStartTimes() {
   const events = fetchUngradedEventsSince(PANDASCORE_SPORTS.map((s) => s.sportId), Date.now() - START_TIME_LOOKBACK_MS);
   let updated = 0;

   for (const config of PANDASCORE_SPORTS) {
      const eventsByMatchId = new Map<number, DbEvent>();
      for (const event of events) {
         if (event.sport_id === config.sportId) {
            eventsByMatchId.set(Number(event.api_id), event);
         }
      }
      if (eventsByMatchId.size === 0) {
         continue;
      }

      let matches: PandaScoreMatch[];
      try {
         matches = await getMatchesById(config, [...eventsByMatchId.keys()]);
      } catch (error) {
         console.error(`Failed to fetch PandaScore ${config.path} start times:`, error instanceof Error ? error.message : error);
         continue;
      }

      for (const match of matches) {
         const event = eventsByMatchId.get(match.id);
         const start_time = getMatchStartTime(match);
         if (!event || start_time === null || start_time === event.start_time) {
            continue;
         }
         updateEventStartTime(event.id, event.league_id, event.sport_id, start_time);
         updated++;
      }
   }
   if (updated > 0) {
      console.log(`Updated ${updated} esports start times`);
   }
}

export async function setFinishedEsportsEvents() {
   console.log("Setting finished esports events");
   const events = fetchUngradedStartedEvents();

   for (const config of PANDASCORE_SPORTS) {
      const eventsByMatchId = new Map<number, DbEvent>();
      for (const [, event] of events) {
         if (event.sport_id === config.sportId) {
            eventsByMatchId.set(Number(event.api_id), event);
         }
      }
      if (eventsByMatchId.size === 0) {
         continue;
      }

      let matches: PandaScoreMatch[];
      try {
         matches = await getMatchesById(config, [...eventsByMatchId.keys()]);
      } catch (error) {
         console.error(`Failed to fetch PandaScore ${config.path} results:`, error instanceof Error ? error.message : error);
         continue;
      }

      for (const match of matches) {
         const event = eventsByMatchId.get(match.id);
         if (!event) {
            continue;
         }
         const result = getEsportsEventResult(match, event);
         if (result) {
            setEventResults(event.id, event.league_id, event.sport_id, result.homeScore, result.awayScore, result.periods);
         }
      }
   }
   console.log("Set finished esports events");
}
