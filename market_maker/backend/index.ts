import { fetchEventsGrouped } from "../../api/localDb";
import { getEventGameState, getEventStateData, ODDS_SCALE, type EventId, type MarketId } from "spamm-aggregator-sdk";
import { getInitEventIx, getInitMarketIx, getMmMarketData, getUpdateEventStateIx, getUpdateOracleIx, MARKET_MAKER_PROGRAM_ID } from "spamm-market-maker-sdk";
import { createRpcClients, sendAndConfirmInstructions, withRpcRetry } from "../client/txSend";
import { sleep } from "bun";
import { ADMIN_SIGNER } from "../client/admin";
import type { ESPNOdds } from "../../api/types";
import type { Instruction } from "@solana/instructions";

// read the db (instead of fetching from the api)
// check if event exists onchain, if not, create it
// check if markets exist onchain, if not, create them
// update the market odds onchain

async function main() {
   try {
      await runMarketMakerCycle();
   } catch (error) {
      console.error("Market maker cycle failed:", error);
   }
}

async function runMarketMakerCycle() {
   console.log("Updating market odds onchain");
   const clients = createRpcClients();
   const dbEventsAndMarkets = fetchEventsGrouped(true)
   for (const sport of dbEventsAndMarkets) {
      for (const league of sport.leagues) {
         for (const event of league.events) {
            if (event.start_time < Date.now()) {
               continue;
            }
            const eventId: EventId = {
               sport: event.sport_id,
               league: event.league_id,
               event: BigInt(event.id),
            };
            let oddsData;
            try {
               // check for event state account
               const _eventStateData = await withRpcRetry(() =>
                  getEventStateData(clients.rpc, MARKET_MAKER_PROGRAM_ID, eventId),
               );
               oddsData = await getESPNOdds(sport.api_id, league.api_id, event.api_id);
               // console.log(sport.api_id, league.api_id, event.api_id, oddsData);
            } catch (error) {
               if (error instanceof Error && error.message.includes('Event state account not found')) {
                  // create the event onchain
                  try {
                     const initEventIx = await getInitEventIx(
                        ADMIN_SIGNER.address, eventId, MARKET_MAKER_PROGRAM_ID
                     );
                     const setEventStateIx = await getUpdateEventStateIx(
                        ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, eventId, 1, 
                        getEventGameState("PG", 0, 0, 0, 0)
                     )
                     const txResult = await withRpcRetry(() =>
                        sendAndConfirmInstructions([initEventIx, setEventStateIx], [ADMIN_SIGNER]),
                     );
                     // console.log("Event created onchain", eventId, txResult);
                  } catch (error) {
                     console.error(error);
                     console.error(`Failed to create event ${event.id} onchain`);
                  }
               } else {
                  console.error(error);
               }
            }
            const ixs: Instruction[] = [];
            for (const market of event.markets ?? []) {
               // check for market data account
               const marketId: MarketId = {
                  eventId,
                  player: 0n,
                  mkt: market.id,
                  period: market.period_id,
                  isPregame: true,
               };
               try {
                  const _marketData = await withRpcRetry(() =>
                     getMmMarketData(clients.rpc, MARKET_MAKER_PROGRAM_ID, marketId),
                  );
               } catch (error) {
                  if (error instanceof Error && error.message.includes('MM market data account not found')) {
                     // create the market onchain
                     ixs.push(await getInitMarketIx(
                        ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, new Uint8Array(3*4)
                     ));
                  } else {
                     console.error(error);
                  }
               }
               const sequence = BigInt(Math.floor(Date.now() / 1000));
               // get the latest odds
               if (market.id === 1 || market.id === 0) {
                  const winOdds = oddsData?.win;
                  if (winOdds) {
                     const odds0 = scaleOdds(winOdds[0]);
                     const odds1 = scaleOdds(winOdds[1]);
                     const odds2 = winOdds[2] ? scaleOdds(winOdds[2]) : undefined;
                     // console.log(market.id, odds0, odds1, odds2);
                     ixs.push(await getUpdateOracleIx(
                        ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                        sequence, 
                        odds0, odds1, odds2
                     ));
                  }
               } else if ( // spread markets
                  (market.id > 100 && market.id < 299) ||
                  (market.id > 300 && market.id < 499)
               ) {
                  const spreadOdds = oddsData?.spread;
                  if (spreadOdds && spreadOdds.odds) {
                     // need to make sure the line is the same as the market line
                     let apiMkt = market.sport_id === 1 ? 400 : 200;
                     apiMkt += spreadOdds.line * (sport.id === 1 ? 4 : 2);
                     if (apiMkt !== market.id) {
                        // set null odds onchain
                        ixs.push(await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence, 
                           0n, 0n, 0n
                        ));                        
                     } else {
                        // update the onchain odds
                        const odds0 = scaleOdds(spreadOdds.odds[0]);
                        const odds1 = scaleOdds(spreadOdds.odds[1]);
                        // console.log(market.id, odds0, odds1);
                        ixs.push(await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence, 
                           odds0, odds1, undefined
                        ));
                     }
                  }
               } else if ( // total markets
                  (market.id > 50 && market.id < 99) ||
                  (market.id > 1000 && market.id < 1999)
               ) {
                  const totalOdds = oddsData?.total;
                  if (totalOdds && totalOdds.odds) {
                     // need to make sure the line is the same as the market line
                     let apiMkt = market.sport_id === 1 ? 50 : 1000;
                     apiMkt += totalOdds.line * (sport.id === 1 ? 4 : 2);
                     if (apiMkt !== market.id) {
                        // set null odds onchain
                        ixs.push(await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence, 
                           0n, 0n, 0n
                        ));
                     } else {
                        // update the onchain odds
                        const odds0 = scaleOdds(totalOdds.odds[0]);
                        const odds1 = scaleOdds(totalOdds.odds[1]);
                        // console.log(market.id, odds0, odds1);
                        ixs.push(await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence,
                           odds0, odds1, undefined
                        ));
                     }
                  }
               } else if (market.id === 9) {
                  let parsed: number[];
                  try {
                     parsed = JSON.parse(market.last_odds) as number[];
                  } catch {
                     parsed = [0, 0];
                  }
                  const odds0 = BigInt(parsed[0] ?? 0);
                  const odds1 = BigInt(parsed[1] ?? 0);
                  ixs.push(await getUpdateOracleIx(
                     ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId,
                     sequence,
                     odds0, odds1, undefined,
                  ));
               }
            }
            // send the ixs
            if (ixs.length > 0) {
               try {
                  const txResult = await withRpcRetry(() =>
                     sendAndConfirmInstructions(ixs, [ADMIN_SIGNER]),
                  );
                  console.log("Market updated onchain", eventId, txResult);
               } catch (error) {
                  console.error(`Failed to update markets for event ${event.id}:`, error);
               }
            }
            await sleep(200);
         }
      }
   }
   console.log("All market odds updated onchain");
}

async function getESPNOdds(sport: string, league: string, event: string): Promise<{
   win: [number, number, number] | [number, number] | null,
   spread: {line: number, odds: [number, number] | null} | null,
   total: {line: number, odds: [number, number] | null} | null,
}> {
   const url = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${event}/competitions/${event}/odds`
   const response = await fetch(url);
   const data = await response.json() as ESPNOdds;

   let win = null;
   let spread = null;
   let total = null;
   if (data.error) {
      return {win, spread, total};
   }

   try {
      const d = data.items[0]!;

      const homeOdds = d.homeTeamOdds.current.moneyLine.decimal;
      const awayOdds = d.awayTeamOdds.current.moneyLine.decimal;
      const drawOdds = d.current.draw?.decimal;
      if (homeOdds && awayOdds && drawOdds) {
         win = [homeOdds, awayOdds, drawOdds] as [number, number, number];
      } else if (homeOdds && awayOdds) {
         win = [homeOdds, awayOdds] as [number, number];
      }

      const spreadLine = d.spread;
      const spreadHomeOdds = d.homeTeamOdds.current.spread.decimal;
      const spreadAwayOdds = d.awayTeamOdds.current.spread.decimal;
      if (spreadLine && spreadHomeOdds && spreadAwayOdds) {
         spread = {line: spreadLine, odds: [spreadHomeOdds, spreadAwayOdds] as [number, number]};
      }

      const totalLine = d.overUnder;
      const totalOverOdds = d.current.over.decimal;
      const totalUnderOdds = d.current.under.decimal;
      if (totalLine && totalOverOdds && totalUnderOdds) {
         total = {line: totalLine, odds: [totalOverOdds, totalUnderOdds] as [number, number]};
      }
      return {win, spread, total};
   } catch (error) {
      console.error(error);
      return {win, spread, total};
   }
}

if (import.meta.main === true) {
   await main();
   setInterval(() => {
      void main();
   }, 1000 * 60 * 5);
}

function scaleOdds(odds: number): bigint {
   return BigInt(Math.floor(odds * 10_000));
}