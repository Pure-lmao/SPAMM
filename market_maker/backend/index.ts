import { fetchEventsGrouped } from "../../api/localDb";
import { getCloseNettingAccountIx, getEventGameState, getEventStateData, ODDS_SCALE, type EventId, type MarketId } from "spamm-aggregator-sdk";
import { getCloseEventIx, getCloseMarketIx, getInitEventIx, getInitMarketIx, getMmMarketData, getUpdateEventStateIx, getUpdateOracleIx, MARKET_MAKER_PROGRAM_ID } from "spamm-market-maker-sdk";
import { createRpcClients, logSolanaError, sendAndConfirmInstructionGroups, sendAndConfirmInstructions, withRpcRetry } from "../../aggregator/client/txSendV1";
import { sleep } from "bun";
import { ADMIN_SIGNER } from "../client/admin";
import type { ESPNOdds, GroupedEvent } from "../../api/types";
import type { Instruction } from "@solana/instructions";
import type { Address } from "@solana/kit";
import { getProps } from "../../api/playerProps";

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
   const clients = createRpcClients({
      httpUrl: process.env.SOLANA_RPC_URL,
      wsUrl: process.env.SOLANA_WS_URL,
   });
   const dbEventsAndMarkets = fetchEventsGrouped(true)
   for (const sport of dbEventsAndMarkets) {
      for (const league of sport.leagues) {
         for (const event of league.events) {
            if (event.start_time < Date.now()) {
               await closeEventAndMarkets(event);
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
                     const txResult = await sendAndConfirmInstructions(
                        [initEventIx, setEventStateIx],
                        [ADMIN_SIGNER],
                     );
                     // console.log("Event created onchain", eventId, txResult);
                  } catch (error) {
                     logSolanaError(`Failed to create event ${event.id} onchain:`, error);
                  }
               } else {
                  console.error(error);
               }
            }
            const ixs: Instruction[][] = [];
            for (const market of event.markets ?? []) {
               // check for market data account
               const marketId: MarketId = {
                  eventId,
                  player: BigInt(market.player_id),
                  mkt: market.id,
                  period: market.period_id,
                  isPregame: true,
                  operator: market.operator as Address,
               };
               try {
                  const _marketData = await withRpcRetry(() =>
                     getMmMarketData(clients.rpc, MARKET_MAKER_PROGRAM_ID, marketId),
                  );
               } catch (error) {
                  if (error instanceof Error && error.message.includes('MM market data account not found')) {
                     // create the market onchain
                     ixs.push([await getInitMarketIx(
                        ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, new Uint8Array(3*4)
                     )]);
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
                     ixs.push([await getUpdateOracleIx(
                        ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                        sequence, 
                        odds0, odds1, odds2
                     )]);
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
                        ixs.push([await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence, 
                           0n, 0n, 0n
                        )]);                        
                     } else {
                        // update the onchain odds
                        const odds0 = scaleOdds(spreadOdds.odds[0]);
                        const odds1 = scaleOdds(spreadOdds.odds[1]);
                        // console.log(market.id, odds0, odds1);
                        ixs.push([await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence, 
                           odds0, odds1, undefined
                        )]);
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
                        ixs.push([await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence, 
                           0n, 0n, 0n
                        )]);
                     } else {
                        // update the onchain odds
                        const odds0 = scaleOdds(totalOdds.odds[0]);
                        const odds1 = scaleOdds(totalOdds.odds[1]);
                        // console.log(market.id, odds0, odds1);
                        ixs.push([await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence,
                           odds0, odds1, undefined
                        )]);
                     }
                  }
               } else if (market.id > 11000) {
                  const propsOdds = oddsData?.props;
                  if (propsOdds) {
                     const thisProp = propsOdds.find(prop => prop.mktId === market.id && prop.athleteId === market.player_id);
                     if (thisProp) {
                        if (thisProp.odds[0]) {
                           const odds0 = scaleOdds(thisProp.odds[0]);
                           let odds1 = 0n;
                           if (thisProp.odds[1]) {
                              odds1 = scaleOdds(thisProp.odds[1]);
                           }
                           ixs.push([await getUpdateOracleIx(
                              ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                              sequence, odds0, odds1, undefined
                           )]);
                        }
                     }
                  }
               }
            }
            // send the ixs
            if (ixs.length > 0) {
               try {
                  const txResult = await sendAndConfirmInstructionGroups(ixs, [ADMIN_SIGNER]);
                  console.log("Markets updated onchain", eventId, txResult);
               } catch (error) {
                  logSolanaError(`Failed to update markets for event ${event.id}:`, error);
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
   props: {mktId: number, athleteId: number, line: number | null, odds: number[]}[] | null,
}> {
   const url = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${event}/competitions/${event}/odds`
   const response = await fetch(url);
   const linesData = await response.json() as ESPNOdds;

   const propsData = await getProps(sport, league, event);

   let win = null;
   let spread = null;
   let total = null;
   let props = null;
   if (linesData.error) {
      return {win, spread, total, props};
   }

   try {
      const d = linesData.items[0];
      if (!d) {
         return {win, spread, total, props};
      }

      const homeOdds = d.homeTeamOdds.current.moneyLine.decimal;
      const awayOdds = d.awayTeamOdds.current.moneyLine.decimal;
      const drawOdds = d.current.draw?.decimal;
      if (homeOdds && awayOdds && drawOdds) {
         win = revigOdds([homeOdds, awayOdds, drawOdds]) as [number, number, number];
      } else if (homeOdds && awayOdds) {
         win = revigOdds([homeOdds, awayOdds]) as [number, number];
      }

      const spreadLine = d.spread;
      const spreadHomeOdds = d.homeTeamOdds.current.spread.decimal;
      const spreadAwayOdds = d.awayTeamOdds.current.spread.decimal;
      if (spreadLine && spreadHomeOdds && spreadAwayOdds) {
         spread = {line: spreadLine, odds: revigOdds([spreadHomeOdds, spreadAwayOdds]) as [number, number]};
      }

      const totalLine = d.overUnder;
      const totalOverOdds = d.current.over.decimal;
      const totalUnderOdds = d.current.under.decimal;
      if (totalLine && totalOverOdds && totalUnderOdds) {
         total = {line: totalLine, odds: revigOdds([totalOverOdds, totalUnderOdds]) as [number, number]};
      }
      return {win, spread, total, props: propsData};
   } catch (error) {
      console.error(error, linesData.items[0]!, url);
      return {win, spread, total, props: propsData};
   }
}

if (import.meta.main === true) {
   await main();
   setInterval(() => {
      void main();
   }, 1000 * 60 * 5);
}

function scaleOdds(odds: number): bigint {
   return BigInt(Math.floor(odds * Number(ODDS_SCALE)));
}

function revigOdds(odds: number[]): number[] {
   const vig = odds.reduce((acc, curr) => acc + 1/curr, 0);
   return odds.map(odds => odds * vig / 1.02);
}
async function closeEventAndMarkets(event: GroupedEvent) {
   const ixs: Instruction[][] = [];
   ixs.push([await getCloseNettingAccountIx(
      {
         sport: event.sport_id,
         league: event.league_id,
         event: BigInt(event.id),
      }, ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID
   )]);
   ixs.push([await getCloseEventIx(
      ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID,
      {
         sport: event.sport_id,
         league: event.league_id,
         event: BigInt(event.id),
      }, 
   )]);
   for (const market of event.markets ?? []) {
      ixs.push([await getCloseMarketIx(
         ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID,
         {
            eventId: {
               sport: event.sport_id,
               league: event.league_id,
               event: BigInt(event.id),
            },
            player: BigInt(market.player_id),
            mkt: market.id,
            period: market.period_id,
            isPregame: true,
            operator: market.operator as Address,
         },
      )]);
   }
   const txResult = await sendAndConfirmInstructionGroups(ixs, [ADMIN_SIGNER]);
   console.log("Event and markets closed onchain", event.id, txResult);
}
