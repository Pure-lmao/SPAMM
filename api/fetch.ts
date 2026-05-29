import { fetch, sleep } from "bun";
import type { ESPNEvent, ESPNOdds, Event } from "./types";
import { addEvent, addMarket, fetchEvents, fetchLeagues, fetchMarkets, fetchSports, fetchUngradedStartedEvents, getLeagues, updateEventScore, updateMarket } from "./localDb";
import { safeJSONStringify } from "./utils";
import {
   decodeMarketQuotesProxyReturnData,
   getEventGameState,
   getGetMarketQuotesProxyIx,
   getMmListData,
   maxProxyMmsForMarketQuotes,
   MAX_NUMBER_OF_MMS_PROXY,
   numSidesForMkt,
   ODDS_SCALE,
   type MarketId,
   type ProxyMarketMmQuotes,
} from "spamm-aggregator-sdk";
import type { Base64EncodedDataResponse } from "@solana/kit";
import { createRpcClients, simulateTransaction } from "../aggregator/client/txSend";
import { ADMIN_SIGNER } from "../aggregator/client/admin";
import { gradeBets, gradeParlays } from "solana";

/** Unused by on-chain quote proxy; must be > 0 for SDK validation. */
const QUOTE_PROBE_BET_ID = 1n;

function returnDataToBytes(raw: Base64EncodedDataResponse): Uint8Array {
   return new Uint8Array(Buffer.from(...raw));
}

/** Best odds per side index across all MMs from `get_market_quotes_proxy` return data. */
function bestOddsPerSideFromMarketQuotes(
   quotes: readonly ProxyMarketMmQuotes[],
   numSides: number,
): number[] {
   const best = Array.from({ length: numSides }, () => 0);
   for (const mm of quotes) {
      for (let side = 0; side < numSides; side++) {
         const odds = Number(mm.oddsScaled[side] ?? 0n);
         if (odds > best[side]!) {
            best[side] = odds;
         }
      }
   }
   return best;
}

async function getScoreboard(sport: string, league: string, date: string): Promise<ESPNEvent[]> {
   const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${date}`
   const response = await fetch(url);
   const data = await response.json() as {events: ESPNEvent[]};
   return data.events;
};

function getScoreFromEvent(event: ESPNEvent): {isCompleted: boolean, homeScore: number, awayScore: number} | null {
   const isCompleted = event.status.type.name === 'STATUS_FINAL' || event.status.type.name === 'STATUS_FULL_TIME';
   try {
      const homeScore = Number(event.competitions[0]!.competitors.find(c => c.homeAway === 'home')!.score);
      const awayScore = Number(event.competitions[0]!.competitors.find(c => c.homeAway === 'away')!.score);
      return {isCompleted, homeScore, awayScore};
   } catch (error) {
      return null;
   }
};

function getUpcomingEvent(event: ESPNEvent, sport_id: number, league_id: number): Event | null {
   if (event.status.type.name !== 'STATUS_SCHEDULED') {
      return null;
   }

   try {
      const homeTeam = event.competitions[0]!.competitors.find(c => c.homeAway === 'home')!.team;
      const awayTeam = event.competitions[0]!.competitors.find(c => c.homeAway === 'away')!.team;
      const eventId = event.id;

      const dbEvent: Event = {
         id: Number(eventId),
         league_id,
         sport_id,
         home_name: homeTeam.displayName,
         away_name: awayTeam.displayName,
         event_name: `${homeTeam.displayName} vs ${awayTeam.displayName}`,
         start_time: new Date(event.date).getTime(),
         api_id: eventId,
         home_score: null,
         away_score: null,
      };

      return dbEvent;
   } catch (error) {
      return null;
   }
}

async function getMarketLines(sport: string, league: string, event: string): Promise<{total: number | null, spread: number | null}> {
   const url = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${event}/competitions/${event}/odds`
   const response = await fetch(url);
   const data = await response.json() as ESPNOdds;
   try {
      let total = null;
      let spread = null;
      const totalValue = data.items[0]!.overUnder;
      const spreadValue = data.items[0]!.spread;
      if (totalValue !== null && !isNaN(Number(totalValue))) {
         total = totalValue;
      }
      if (spreadValue !== null && !isNaN(Number(spreadValue))) {
         spread = spreadValue;
      }
      return {total, spread};
   }
   catch (error) {
      return {total: null, spread: null};
   }
}

async function setUpcomingEvents() {
   console.log("Setting upcoming events");
   const now = new Date();
   const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0]!.replace(/-/g, '');
   const fiveDaysFromNow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5).toISOString().split('T')[0]!.replace(/-/g, '');
   
   const leagues = fetchLeagues();
   const sports = fetchSports();
   const events = fetchEvents();
   const markets = fetchMarkets();

   const marketIdSet = new Set<string>();
   for (const [marketId, market] of markets) {
      marketIdSet.add(`${market.sport_id}-${market.league_id}-${market.event_id}-${market.id}`);
   }

   for (const [id, league] of leagues) {
      const sport = sports.get(league.sport_id)!;
      const scoreboard = await getScoreboard(sport.api_id, league.api_id, `${today}-${fiveDaysFromNow}`);
      for (const event of scoreboard) {
         let eventExists = events.has(`${sport.id}:${league.id}:${event.id}`) || false;

         const dbEvent = getUpcomingEvent(event, sport.id, league.id);
         if (dbEvent) {
            if (!eventExists) {
               addEvent(dbEvent.id, dbEvent);
            }
            const last_update = new Date().getTime();
            // Create ML/FT
            if (sport.id === 1) {
               if (!marketIdSet.has(`${sport.id}-${league.id}-${dbEvent.id}-1`)) {
                  addMarket({
                     id: 1,
                     event_id: dbEvent.id,
                     league_id: league.id,
                     sport_id: sport.id,
                     last_odds: safeJSONStringify([0,0,0]),
                     last_update,
                     mkt_string: "1X2",
                     period_id: 1,
                     line_value: null,
                  });
               }
            } else {
               if (!marketIdSet.has(`${sport.id}-${league.id}-${dbEvent.id}-0`)) {
                  addMarket({
                     id: 0,
                     event_id: dbEvent.id,
                     league_id: league.id,
                     sport_id: sport.id,
                     last_odds: safeJSONStringify([0,0]),
                     last_update,
                     mkt_string: "ML",
                     period_id: 0,
                     line_value: null,
                  });
               }
            }  

            const lines = await getMarketLines(sport.api_id, league.api_id, event.id);

            if (lines.total !== null) {
               let id = sport.id === 1 ? 50 : 1000;
               id += lines.total * (sport.id === 1 ? 4 : 2);
               if (!marketIdSet.has(`${sport.id}-${league.id}-${dbEvent.id}-${id}`)) {
                  addMarket({
                     id,
                     event_id: dbEvent.id,
                     league_id: league.id,
                     sport_id: sport.id,
                     last_odds: safeJSONStringify([0,0]),
                     last_update,
                     mkt_string: `OU ${lines.total}`,
                     period_id: sport.id === 1 ? 1 : 0,
                     line_value: lines.total,
                  });
               }
            };

            if (lines.spread !== null) {
               let id = sport.id === 1 ? 400 : 200;
               id += lines.spread * (sport.id === 1 ? 4 : 2);
               if (!marketIdSet.has(`${sport.id}-${league.id}-${dbEvent.id}-${id}`)) {
                  addMarket({
                     id,
                     event_id: dbEvent.id,
                     league_id: league.id,
                     sport_id: sport.id,
                     last_odds: safeJSONStringify([0,0]),
                     last_update,
                     mkt_string: `AH ${lines.spread > 0 ? '+' : ''}${lines.spread}`,
                     period_id: sport.id === 1 ? 1 : 0,
                     line_value: lines.spread,
                  });
               }
            }
         }
      }
   }
   console.log("Set upcoming events");
};

async function setFinishedEvents() {
   console.log("Setting finished events");
   const now = new Date();
   const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0]!.replace(/-/g, '');
   const twoDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2).toISOString().split('T')[0]!.replace(/-/g, '');
   
   const leagues = fetchLeagues();
   const sports = fetchSports();
   const events = fetchUngradedStartedEvents();

   if (events.size === 0) {
      console.log("No ungraded started events");
      return;
   }

   for (const [id, league] of leagues) {
      const sport = sports.get(league.sport_id)!;
      const scoreboard = await getScoreboard(sport.api_id, league.api_id, `${twoDaysAgo}-${today}`);
      for (const event of scoreboard) {
         console.log("scoreboard event:", event.id);
         if (!events.has(`${sport.id}:${league.id}:${event.id}`)) {
            console.log("event does not exist");
            continue;
         }
         const score = getScoreFromEvent(event);
         console.log(event)
         console.log("score:", score);
         if (score && score.isCompleted) {
            updateEventScore(Number(event.id), league.id, sport.id, score.homeScore, score.awayScore);
         }
      }
   }
   console.log("Set finished events");
};

async function cacheOdds() {
   console.log("Caching odds");
   const markets = fetchMarkets();
   const clients = createRpcClients();
   const marketMakers = await getMmListData(clients.rpc);
   const mmPrograms = marketMakers.mmProgramAddresses.slice(0, MAX_NUMBER_OF_MMS_PROXY);
   const fakeSigner = ADMIN_SIGNER;

   if (mmPrograms.length === 0) {
      console.log("No market makers registered; skipping odds cache");
      return;
   }

   const eventGameState = getEventGameState("PG", 0, 0, 0, 0);
   const minOddsScaled = ODDS_SCALE + 1n;

   for (const [, market] of markets) {
      const numSides = numSidesForMkt(market.id);
      if (numSides === undefined) {
         console.warn(`Skipping odds cache for unsupported mkt ${market.id} (${market.mkt_string})`);
         continue;
      }

      const wireMarketId: MarketId = {
         mkt: market.id,
         period: market.period_id,
         player: 0n,
         eventId: {
            sport: market.sport_id,
            league: market.league_id,
            event: BigInt(market.event_id),
         },
         isPregame: true,
      };

      const mmProgramsForMarket = mmPrograms.slice(
         0,
         Math.min(MAX_NUMBER_OF_MMS_PROXY, maxProxyMmsForMarketQuotes(numSides)),
      );

      let odds = Array.from({ length: numSides }, () => 0);
      try {
         const quoteIx = await getGetMarketQuotesProxyIx(
            {
               betId: QUOTE_PROBE_BET_ID,
               marketId: wireMarketId,
               side: 0,
               amount: 1n,
               minOddsScaled,
               eventGameState,
               eventStateSequence: 1,
            },
            fakeSigner.address,
            mmProgramsForMarket,
         );
         const returnData = await simulateTransaction(clients.rpc, [quoteIx], [fakeSigner], true);
         if (returnData) {
            const quotes = decodeMarketQuotesProxyReturnData(returnDataToBytes(returnData), numSides);
            odds = bestOddsPerSideFromMarketQuotes(quotes, numSides);
         }
      } catch (error: unknown) {
         console.error(
            `Error simulating market quotes proxy for market ${market.id} event ${market.event_id}`,
         );
         console.error(error instanceof Error ? error.message : String(error));
      }
      await sleep(500);
      updateMarket(
         market.id,
         market.event_id,
         market.league_id,
         market.sport_id,
         safeJSONStringify(odds),
         new Date().getTime(),
      );
   }
   console.log("Cached odds");
}

async function main() {
   await setUpcomingEvents();
   await setFinishedEvents();
   await gradeBets();
   await gradeParlays();
   await cacheOdds();
   console.log("Initial done.");

   setInterval(async () => {
      await setUpcomingEvents();
   }, 1000 * 60 * 60);
   setInterval(async () => {
      await setFinishedEvents();
      await gradeBets();
      await gradeParlays();
   }, 1000 * 60 * 30);
   setInterval(async () => {
      await cacheOdds();
   }, 1000 * 60 * 5);
};

if (import.meta.main) {
   await main().catch(console.error);
}
