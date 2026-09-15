import type { ESPNProps, ESPNPropsResponse } from "./types";
import { round } from "./utils";


const headers = {
   'Accept': 'application/json',
   'Content-Type': 'application/json',
   'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
}

export const ESPNtoMktId = new Map<string, number>([
   // soccer
   ["First Goalscorer", 11101],
   ["Last Goalscorer", 11199],
   ["To Score 2+ Goals", 11203],
   ["To Score 3+ Goals", 11205],
   ["Tackles Milestones", 11700],
   ["Assists Milestones", 12100],
   ["Anytime Goalscorer", 11201],
   ["To Receive a Card", 11801],
   ["To Receive a Red Card", 11801],
   ["Shots Milestones", 11400],
   ["Shots on Target Milestones", 11300],
   ["Fouls Committed Milestones", 11600],
   ["Fouls Milestones", 11500],
   ["Goalkeeper Saves Milestones", 12000],
   // american football
   ["Total Passing Yards (incl. overtime)", 20000],
   ["Total Pass Completions (incl. overtime)", 22500],
   ["Total Passing Touchdowns (incl. overtime)", 13100],
   ["Total Carries (incl. overtime)", 13300],
   ["Total Rushing Yards (incl. overtime)", 23500],
   ["Total Receiving Yards (incl. overtime)", 25000],
   ["Total Receptions (incl. overtime)", 13400],
   ["Total Passing Interceptions (incl. overtime)", 13200],
   ["Total Passing Attempts (incl. overtime)", 22000],
   ["Longest Passing Completion (incl. overtime)", 22500],
   ["Total Passing Plus Rushing Yards (incl. overtime)", 21000],
   ["Longest Reception (incl. overtime)", 25500],
   ["Total Rushing Plus Receiving Yards (incl. overtime)", 24000],
   ["Longest Rush (incl. overtime)", 24500],
   ["Total Kicking Points (incl. overtime)", 13600],
   ["Total Extra Points Made (incl. overtime)", 13900],
   ["Total Field Goals Made (incl. overtime)", 13800],
   ["Total Assists (incl. overtime)", 12100],
   ["Total Tackles (incl. overtime)", 11700],
   ["Total Sacks (incl. overtime)", 13500],
   ["First Touchdown Scorer", 11101],
   ["Last Touchdown Scorer", 11199],
   ["Anytime Touchdown Scorer", 13001],
   ["Player to score 2 or more touchdowns", 13003],
   ["Player to score 3 or more touchdowns", 13005],
   // baseball
   ["Total Strikeouts", 14000],
   ["Total Singles Hit", 15800],
   ["Total Doubles Hit", 15900],
   ["Total Bases", 15300],
   ["Total Hits", 15200],
   ["Total Hits Allowed", 14300],
   ["Earned Runs Allowed", 14100],
   ["Total Hits + Runs + RBIs", 16100],
   ["Total Outs Recorded", 14200],
   ["Total Runs Scored", 15100],
   ["Total RBIs", 15400],
   ["Total Stolen Bases", 15600],
   ["Total Walks Allowed", 14400],
]);

// getProps("soccer", "eng.1", "401879275").then(console.log);
export async function getProps(sport: string, league: string, event: string): Promise<{mktId: number, line: number | null, athleteId: number, athleteRef: string, odds: number[]}[]> {
   let page = 1;
   let pageCount = Infinity;
   const url = (page: number) => `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${event}/competitions/${event}/odds/100/propBets?page=${page}`
   const props: ESPNProps[] = [];
   const typeSet = new Set<string>();
   while (page <= pageCount) {
      const response = await fetch(url(page), {headers});
      const data = await response.json() as ESPNPropsResponse | {error: any};
      if ("error" in data) {
         break;
      }
      pageCount = data.pageCount;
      page += 1;
      if (data.items.length > 0) {
         props.push(...data.items);
         for (const prop of data.items) {
            typeSet.add(prop.type.name);
         }
      } else {
         break;
      }
   }

   const parsedProps = new Map<string, [number[], string]>();
   let last = "";
   for (const prop of props) {
      const mktIdBase = ESPNtoMktId.get(prop.type.name);
      let mktId: number;
      if (mktIdBase && prop.athlete && prop.athlete["$ref"]) {
         const athleteRef = prop.athlete["$ref"];
         const athleteId = parseAthleteId(athleteRef);
         let line: number | undefined = undefined;
         if (mktIdBase % 10 === 0) {
            if ("target" in prop) {
               line = prop.target.value;
            } else {
               line = prop.current.target.value;
            }
            if (!line) {
               // this is an prop that needs a line but doesnt have one.
               continue;
            }
            if (line % 1 === 0) {
               // if its a whole number like tackle milestones meaning (3+), add 0.5 for 3.5.
               line += 0.5;
            }
            mktId = round(mktIdBase + line*2, 0);
         }else{
            mktId = mktIdBase;
         }

         const current = `${mktId}-${athleteId}-${line}`;
         let odds: number | undefined = undefined;
         if ("odds" in prop) {
            odds = parseFloat(prop.odds.decimal.value);
         } else if ("over" in prop.current) {
            odds = parseFloat(prop.current.over.decimal);
         } else {
            odds = 1.9;
         }
         if (current === last) {
            //push odds to array of the last key
            parsedProps.get(last)?.[0]?.push(odds);
         } else {
            parsedProps.set(current, ([[odds], athleteRef]));
         }
         last = current;
      }
   }
   return Array.from(parsedProps.entries()).map(([key, value]) => ({
      mktId: parseInt(key.split("-")[0]!), 
      athleteId: parseInt(key.split("-")[1]!),
      line: isNaN(Number(key.split("-")[2])) ? null : Number(key.split("-")[2]), 
      odds: value[0]!,
      athleteRef: value[1]!
   }));
}

export async function getAthleteName(athleteRef: string): Promise<string> {
   const response = await fetch(athleteRef, {headers});
   const data = await response.json() as {fullName: string};
   return data.fullName;
}

function parseAthleteId(athleteRef: string ): number {
   //"http://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/seasons/2026/athletes/34986?lang=en&region=us"
   // => 34986
   const id = athleteRef.split("athletes/")[1]!.split("?")[0]!;
   return parseInt(id);
}
