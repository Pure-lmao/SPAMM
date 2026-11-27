import { describe, expect, test } from "bun:test";
import { searchEvents } from "./search";
import type { UiSport } from "./types";

const tree: UiSport[] = [
   {
      id: 1,
      sport: "soccer",
      name: "Soccer",
      leagues: [
         {
            id: 10,
            sport_id: 1,
            name: "Premier League",
            events: [
               {
                  id: 1,
                  league_id: 10,
                  sport_id: 1,
                  home_name: "Manchester United",
                  away_name: "Arsenal",
                  event_name: "",
                  start_time: 0,
               },
               {
                  id: 2,
                  league_id: 10,
                  sport_id: 1,
                  home_name: "Tottenham Hotspur",
                  away_name: "Wolverhampton Wanderers",
                  event_name: "",
                  start_time: 0,
               },
            ],
         },
      ],
   },
   {
      id: 2,
      sport: "nba",
      name: "Basketball",
      leagues: [
         {
            id: 20,
            sport_id: 2,
            name: "NBA",
            events: [
               {
                  id: 3,
                  league_id: 20,
                  sport_id: 2,
                  home_name: "San Antonio Spurs",
                  away_name: "Boston Celtics",
                  event_name: "",
                  start_time: 0,
               },
               {
                  id: 4,
                  league_id: 20,
                  sport_id: 2,
                  home_name: "Seattle Seahawks",
                  away_name: "Dallas Cowboys",
                  event_name: "",
                  start_time: 0,
               },
               {
                  id: 5,
                  league_id: 20,
                  sport_id: 2,
                  home_name: "Seattle Mariners",
                  away_name: "Boston Red Sox",
                  event_name: "",
                  start_time: 0,
               },
            ],
         },
      ],
   },
];

describe("searchEvents", () => {
   test("man u finds Manchester United", () => {
      const hits = searchEvents(tree, "Man U");
      expect(hits.map((hit) => hit.eventId)).toEqual([1]);
   });

   test("spurs lists Tottenham and San Antonio", () => {
      const ids = searchEvents(tree, "spurs").map((hit) => hit.eventId).sort();
      expect(ids).toEqual([2, 3]);
   });

   test("Seahawks matches the mascot", () => {
      const hits = searchEvents(tree, "Seahawks");
      expect(hits.map((hit) => hit.eventId)).toEqual([4]);
   });

   test("Seattle lists every Seattle team", () => {
      const ids = searchEvents(tree, "Seattle").map((hit) => hit.eventId).sort();
      expect(ids).toEqual([4, 5]);
   });
});
