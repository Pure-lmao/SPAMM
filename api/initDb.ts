import { addLeague, addSport } from "./localDb";
import type { DbSport, DbLeague, DbEvent, DbMarket } from "./types";

const sports: DbSport[] = [ 
   {
      id: 1,
      name: "Soccer",
      api_id: "soccer",
   },
   {
      id: 2,
      name: "American Football",
      api_id: "football",
   },
   {
      id: 3,
      name: "Baseball",
      api_id: "baseball",
   },
   {
      id: 4,
      name: "Basketball",
      api_id: "basketball",
   },

   {
      id: 5,
      name: "Ice Hockey",
      api_id: "hockey",
   },
   {
      id: 6,
      name: "Tennis",
      api_id: "tennis",
   },
   {
      id: 101,
      name: "CS2",
      api_id: "cs2",
   },
   {
      id: 102,
      name: "Dota 2",
      api_id: "dota2",
   },
   {
      id: 103,
      name: "League of Legends",
      api_id: "lol",
   },
   {
      id: 104,
      name: "Valorant",
      api_id: "valorant",
   },
];


const leagues: DbLeague[] = [
   {
      id: Number(`${1}${1}${827}`),
      name: "England Premier League",
      sport_id: 1,
      country_rank: 1,
      variation: 1,
      country_code: "827",
      country_name: "England",
      abbr: "ENG1",
      api_id: "eng.1",
   },
   // {
   //    id: Number(`${1}${2}${827}`),
   //    name: "England Championship",
   //    sport_id: 1,
   //    country_rank: 2,
   //    variation: 1,
   //    country_code: "827",
   //    country_name: "England",
   //    abbr: "ENG2",
   //    api_id: "eng.2",
   // },
   {
      id: Number(`${1}${1}${901}`),
      name: "UEFA Champions League",
      sport_id: 1,
      country_rank: 1,
      variation: 1,
      country_code: "901",
      country_name: "Europe",
      abbr: "UCL",
      api_id: "uefa.champions",
   },
   {
      id: Number(`${1}${1}${840}`),
      name: "Major League Baseball",
      sport_id: 3,
      country_rank: 1,
      variation: 1,
      country_code: "840",
      country_name: "United States",
      abbr: "MLB",
      api_id: "mlb",
   },
   {
      id: Number(`${1}${1}${840}`),
      name: "National Basketball Association",
      sport_id: 4,
      country_rank: 1,
      variation: 1,
      country_code: "840",
      country_name: "United States",
      abbr: "NBA",
      api_id: "nba",
   },
   {
      id: Number(`${1}${1}${840}`),
      name: "National Hockey League",
      sport_id: 5,
      country_rank: 1,
      variation: 1,
      country_code: "840",
      country_name: "United States",
      abbr: "NHL",
      api_id: "nhl",
   },
   {
      id: Number(`${1}${1}${840}`),
      name: "National Football League",
      sport_id: 2,
      country_rank: 1,
      variation: 1,
      country_code: "840",
      country_name: "United States",
      abbr: "NFL",
      api_id: "nfl",
   }
];

// initLocalDb()
function initLocalDb(): void {
   for (const sport of sports) {
      addSport(sport.id, sport);
   }
   for (const league of leagues) {
      addLeague(league.id, league);
   }
}

