import { addLeague, addSport } from "./localDb";
import type { Sport, League, Event, Market } from "./types";

const sports: Sport[] = [
   // soccer, basketball, tennis, baseball, american football, ice hockey, cricket, rugby union, 
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

];


const leagues: League[] = [
   // {
   //    id: Number(`${1}${1}${827}`),
   //    name: "England Premier League",
   //    sport_id: 1,
   //    country_rank: 1,
   //    variation: 1,
   //    country_code: "827",
   //    country_name: "England",
   //    abbr: "ENG1",
   //    api_id: "eng.1",
   // },
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
      id: Number(`${2}${1}${900}`),
      name: "FIFA World Cup",
      sport_id: 1,
      country_rank: 1,
      variation: 2,
      country_code: "900",
      country_name: "World",
      abbr: "WC",
      api_id: "fifa.world",
   },
   // {
   //    id: Number(`${1}${1}${840}`),
   //    name: "Major League Baseball",
   //    sport_id: 3,
   //    country_rank: 1,
   //    variation: 1,
   //    country_code: "840",
   //    country_name: "United States",
   //    abbr: "MLB",
   //    api_id: "mlb",
   // },
   // {
   //    id: Number(`${1}${1}${840}`),
   //    name: "National Basketball Association",
   //    sport_id: 4,
   //    country_rank: 1,
   //    variation: 1,
   //    country_code: "840",
   //    country_name: "United States",
   //    abbr: "NBA",
   //    api_id: "nba",
   // },
   // {
   //    id: Number(`${1}${1}${840}`),
   //    name: "National Hockey League",
   //    sport_id: 5,
   //    country_rank: 1,
   //    variation: 1,
   //    country_code: "840",
   //    country_name: "United States",
   //    abbr: "NHL",
   //    api_id: "nhl",
   // }
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

