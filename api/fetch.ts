import { fetch } from "bun";
import type { ESPNEvent, ESPNOdds, Event } from "./types";
import { addEvent, addMarket, fetchEvents, fetchLeagues, fetchSports, getLeagues, updateEvent } from "./localDb";
import { safeJSONStringify } from "./utils";

async function getScoreboard(sport: string, league: string, date: string): Promise<ESPNEvent[]> {
   const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${date}`
   const response = await fetch(url);
   const data = await response.json() as {events: ESPNEvent[]};
   return data.events;
};

function getScoreFromEvent(event: ESPNEvent): {isCompleted: boolean, homeScore: number, awayScore: number} | null {
   const isCompleted = event.status.type.id === 'STATUS_FINAL';
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
   const FiveDaysFromNow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5).toISOString().split('T')[0]!.replace(/-/g, '');
   
   const leagues = fetchLeagues();
   const sports = fetchSports();
   const events = fetchEvents();

   for (const [id, league] of leagues) {
      const sport = sports.get(league.sport_id)!;
      const scoreboard = await getScoreboard(sport.api_id, league.api_id, `${today}-${FiveDaysFromNow}`);
      for (const event of scoreboard) {
         if (events.has(Number(event.id))) {
            continue;
         }
         const dbEvent = getUpcomingEvent(event, sport.id, league.id);
         if (dbEvent) {
            addEvent(dbEvent.id, dbEvent);
            const last_update = new Date().getTime();
            // Create ML/FT
            if (sport.id === 1) {
               addMarket({
                  id: 1,
                  event_id: dbEvent.id,
                  league_id: league.id,
                  sport_id: sport.id,
                  last_odds: safeJSONStringify([0,0,0]),
                  last_update,
                  mkt_string: "1X2",
               });
            } else {
               addMarket({
                  id: 0,
                  event_id: dbEvent.id,
                  league_id: league.id,
                  sport_id: sport.id,
                  last_odds: safeJSONStringify([0,0]),
                  last_update,
                  mkt_string: "ML",
               });
            }  

            const lines = await getMarketLines(sport.api_id, league.api_id, event.id);

            if (lines.total !== null) {
               let id = sport.id === 1 ? 50 : 1000;
               id += lines.total * (sport.id === 1 ? 4 : 2);
               addMarket({
                  id,
                  event_id: dbEvent.id,
                  league_id: league.id,
                  sport_id: sport.id,
                  last_odds: safeJSONStringify([0,0]),
                  last_update,
                  mkt_string: `OU ${lines.total}`,
               });
            };

            if (lines.spread !== null) {
               let id = sport.id === 1 ? 400 : 200;
               id += lines.spread * (sport.id === 1 ? 4 : 2);
               addMarket({
                  id,
                  event_id: dbEvent.id,
                  league_id: league.id,
                  sport_id: sport.id,
                  last_odds: safeJSONStringify([0,0]),
                  last_update,
                  mkt_string: `AH ${lines.spread > 0 ? '+' : ''}${lines.spread}`,
               });
            }
         }
      }
   }
};

async function setFinishedEvents() {
   const now = new Date();
   const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0]!.replace(/-/g, '');
   const twoDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2).toISOString().split('T')[0]!.replace(/-/g, '');
   
   const leagues = fetchLeagues();
   const sports = fetchSports();
   const events = fetchEvents();

   for (const [id, league] of leagues) {
      const sport = sports.get(league.sport_id)!;
      const scoreboard = await getScoreboard(sport.api_id, league.api_id, `${twoDaysAgo}-${today}`);
      for (const event of scoreboard) {
         if (events.has(Number(event.id))) {
            continue;
         }
         const score = getScoreFromEvent(event);
         if (score && score.isCompleted) {
            updateEvent(Number(event.id), league.id, sport.id, score.homeScore, score.awayScore);
         }
      }
   }
};

async function main() {
   await setUpcomingEvents();
   await setFinishedEvents();
   console.log("Events set");

   setInterval(async () => {
      await setUpcomingEvents();
   }, 1000 * 60 * 60);
   setInterval(async () => {
      await setFinishedEvents();
   }, 1000 * 60 * 30);
};

if (import.meta.main) {
   main().catch(console.error);
}
