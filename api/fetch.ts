import { fetch } from "bun";
import type { ESPNEvent, ESPNOdds, DbEvent } from "./types";
import { addEvent, addMarket, fetchEvents, fetchLeagues, fetchSports, fetchUngradedStartedEvents, fetchUpcomingMarkets, updateEventScore, updateMarket } from "./localDb";
import { DEFAULT_MARKET_OPERATOR, safeJSONStringify } from "./utils";
import {
   decodeMarketQuotesProxyReturnData,
   getEventGameState,
   getGetMarketQuotesProxyIx,
   getMmListData,
   maxProxyMmsForMarketQuotes,
   MAX_NUMBER_OF_MMS_PROXY,
   numSidesForMkt,
   ODDS_SCALE,
   playerPropStatName,
   type MarketId,
   type ProxyMarketMmQuotes,
   MIN_BET_AMOUNT,
} from "spamm-aggregator-sdk";
import { address, type Base64EncodedDataResponse } from "@solana/kit";
import { createRpcClients, simulateTransaction, type RpcClients } from "../aggregator/client/txSendV1.ts";
import { ADMIN_SIGNER } from "../aggregator/client/admin.ts";
import { gradeBets, gradeParlays } from "./solana.ts";
import { getAthleteName, getProps } from "./playerProps.ts";

/** Unused by on-chain quote proxy; must be > 0 for SDK validation. */
const QUOTE_PROBE_BET_ID = 1n;

function returnDataToBytes(raw: Base64EncodedDataResponse): Uint8Array {
   return new Uint8Array(Buffer.from(...raw));
}

const headers = {
   'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
   'Content-Type': 'application/json',
   'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
   'Sec-Ch-Ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
   'Sec-Ch-Ua-Mobile': '?0',
   'Sec-Ch-Us-Platform': '"Windows"',
   'Sec-Fetch-Dest': 'document',
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
   // console.log(url);
   const response = await fetch(url, {headers});
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

function getUpcomingEvent(event: ESPNEvent, sport_id: number, league_id: number): DbEvent | null {
   if (event.status.type.name !== 'STATUS_SCHEDULED') {
      return null;
   }

   try {
      const homeTeam = event.competitions[0]!.competitors.find(c => c.homeAway === 'home')!.team;
      const awayTeam = event.competitions[0]!.competitors.find(c => c.homeAway === 'away')!.team;
      const eventId = event.id;

      const dbEvent: DbEvent = {
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
   const response = await fetch(url, {headers});
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
   const markets = fetchUpcomingMarkets();

   const marketIdSet = new Set<string>();
   for (const [marketId, market] of markets) {
      marketIdSet.add(`${market.sport_id}-${market.league_id}-${market.event_id}-${market.id}-${market.player_id}`);
   }

   for (const [id, league] of leagues) {
      const sport = sports.get(league.sport_id)!;
      if(sport.id < 100) {
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
                  if (!marketIdSet.has(`${sport.id}-${league.id}-${dbEvent.id}-1-0`)) {
                     addMarket({
                        id: 1,
                        event_id: dbEvent.id,
                        league_id: league.id,
                        sport_id: sport.id,
                        player_id: 0,
                        player_name: "",
                        last_odds: safeJSONStringify([0,0,0]),
                        last_update,
                        mkt_string: "1X2",
                        period_id: 1,
                        line_value: null,
                        operator: DEFAULT_MARKET_OPERATOR,
                     });
                  }
                  if (!marketIdSet.has(`${sport.id}-${league.id}-${dbEvent.id}-4-0`)) {
                     addMarket({
                        id: 4,
                        event_id: dbEvent.id,
                        league_id: league.id,
                        sport_id: sport.id,
                        player_id: 0,
                        player_name: "",
                        last_odds: safeJSONStringify([0,0]),
                        last_update,
                        mkt_string: "BTTS",
                        period_id: 1,
                        line_value: null,
                        operator: DEFAULT_MARKET_OPERATOR,
                     });
                  }
               } else {
                  if (!marketIdSet.has(`${sport.id}-${league.id}-${dbEvent.id}-0-0`)) {
                     addMarket({
                        id: 0,
                        event_id: dbEvent.id,
                        league_id: league.id,
                        sport_id: sport.id,
                        player_id: 0,
                        player_name: "",
                        last_odds: safeJSONStringify([0,0]),
                        last_update,
                        mkt_string: "ML",
                        period_id: 0,
                        line_value: null,
                        operator: DEFAULT_MARKET_OPERATOR,
                     });
                  }
               }  

               const lines = await getMarketLines(sport.api_id, league.api_id, event.id);

               if (lines.total !== null) {
                  let id = sport.id === 1 ? 50 : 1000;
                  id += lines.total * (sport.id === 1 ? 4 : 2);
                  if (!marketIdSet.has(`${sport.id}-${league.id}-${dbEvent.id}-${id}-0`)) {
                     addMarket({
                        id,
                        event_id: dbEvent.id,
                        league_id: league.id,
                        sport_id: sport.id,
                        player_id: 0,
                        player_name: "",
                        last_odds: safeJSONStringify([0,0]),
                        last_update,
                        mkt_string: `OU ${lines.total}`,
                        period_id: sport.id === 1 ? 1 : 0,
                        line_value: lines.total,
                        operator: DEFAULT_MARKET_OPERATOR,
                     });
                  }
               };

               if (lines.spread !== null) {
                  let id = sport.id === 1 ? 400 : 200;
                  id += lines.spread * (sport.id === 1 ? 4 : 2);
                  if (!marketIdSet.has(`${sport.id}-${league.id}-${dbEvent.id}-${id}-0`)
                  && id !== 200) {
                     addMarket({
                        id,
                        event_id: dbEvent.id,
                        league_id: league.id,
                        sport_id: sport.id,
                        player_id: 0,
                        player_name: "",
                        last_odds: safeJSONStringify([0,0]),
                        last_update,
                        mkt_string: `AH ${lines.spread > 0 ? '+' : ''}${lines.spread}`,
                        period_id: sport.id === 1 ? 1 : 0,
                        line_value: lines.spread,
                        operator: DEFAULT_MARKET_OPERATOR,
                     });
                  }
               }

               const props = await getProps(sport.api_id, league.api_id, event.id);

               for (const prop of props) {
                  if (!marketIdSet.has(`${sport.id}-${league.id}-${dbEvent.id}-${prop.mktId}-${prop.athleteId}`)) {
                     const athleteName = await getCachedAthleteName(prop.athleteId, prop.athleteRef);
                     if (athleteName) {
                        const propName = playerPropStatName(prop.mktId);
                        addMarket({
                           id: prop.mktId,
                           event_id: dbEvent.id,
                           league_id: league.id,
                           sport_id: sport.id,
                           player_id: prop.athleteId,
                           player_name: athleteName,
                           last_odds: safeJSONStringify([0,0]),
                           last_update,
                           mkt_string: prop.line != null && Number.isFinite(prop.line)
                              ? `${propName} ${prop.line}`
                              : propName,
                           period_id: sport.id === 1 ? 1 : 0,
                           line_value: prop.line,
                           operator: DEFAULT_MARKET_OPERATOR,
                        });
                     }
                  }
               }
            }
         }
      }
       else {
         console.log(`sport id ${sport.id} is not on espn`);
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
         // console.log("scoreboard event:", event.id);
         if (!events.has(`${sport.id}:${league.id}:${event.id}`)) {
            console.log("event does not exist");
            continue;
         }
         const score = getScoreFromEvent(event);
         // console.log(event)
         // console.log("score:", score);
         if (score && score.isCompleted) {
            updateEventScore(Number(event.id), league.id, sport.id, score.homeScore, score.awayScore);
         }
      }
   }
   console.log("Set finished events");
};

async function cacheOdds() {
   console.log("Caching odds");
   const markets = fetchUpcomingMarkets();
   const clients = [
      createRpcClients({
         httpUrl: process.env.HELIUS_RPC_URL,
      }),
      createRpcClients({
         httpUrl: process.env.CHAINSTACK_RPC_URL,
      }),
   ] as [RpcClients, RpcClients];
   const marketMakers = await getMmListData(clients[0]!.rpc);
   const mmPrograms = marketMakers.mmProgramAddresses.slice(0, MAX_NUMBER_OF_MMS_PROXY);
   const fakeSigner = ADMIN_SIGNER;

   if (mmPrograms.length === 0) {
      console.log("No market makers registered; skipping odds cache");
      return;
   }

   const eventGameState = getEventGameState("PG", 0, 0, 0, 0);
   const minOddsScaled = ODDS_SCALE + 1n;

   let clientIndex = 0;
   for (const [, market] of markets) {
      const numSides = numSidesForMkt(market.id);
      if (numSides === undefined) {
         console.warn(`Skipping odds cache for unsupported mkt ${market.id} (${market.mkt_string})`);
         continue;
      }

      const wireMarketId: MarketId = {
         mkt: market.id,
         period: market.period_id,
         player: BigInt(market.player_id),
         eventId: {
            sport: market.sport_id,
            league: market.league_id,
            event: BigInt(market.event_id),
         },
         isPregame: true,
         operator: address(market.operator),
      };

      const mmProgramsForMarket = mmPrograms.slice(
         0,
         Math.min(MAX_NUMBER_OF_MMS_PROXY, maxProxyMmsForMarketQuotes(numSides)),
      );

      try {
         const quoteIx = await getGetMarketQuotesProxyIx({
            betId: QUOTE_PROBE_BET_ID,
            marketId: wireMarketId,
            side: 0,
            amount: MIN_BET_AMOUNT,
            minOddsScaled,
            eventGameState,
            eventStateSequence: 1,
         }, fakeSigner.address, mmProgramsForMarket);
         const returnData = await simulateTransaction(clients[clientIndex]!.rpc, [quoteIx], [fakeSigner]);
         clientIndex = (clientIndex + 1) % clients.length;
         if (!returnData) {
            continue;
         }
         const quotes = decodeMarketQuotesProxyReturnData(returnDataToBytes(returnData), numSides);
         const odds = bestOddsPerSideFromMarketQuotes(quotes, numSides);
         updateMarket(
            market.id,
            market.event_id,
            market.league_id,
            market.sport_id,
            market.period_id,
            market.player_id,
            safeJSONStringify(odds),
            new Date().getTime(),
         );
      } catch (error: unknown) {
         console.error(
            `Error simulating market quotes proxy for market ${market.id} event ${market.event_id}`,
         );
         console.error(error instanceof Error ? error.message : String(error));
      }
   }
   console.log("Cached odds");
}

const cachedAthletes = new Map<number, string>();
async function getCachedAthleteName(athleteId: number, athleteRef: string): Promise<string> {
   if (cachedAthletes.has(athleteId)) {
      return cachedAthletes.get(athleteId)!;
   }
   const athleteName = await getAthleteName(athleteRef);
   cachedAthletes.set(athleteId, athleteName);
   return athleteName;
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
