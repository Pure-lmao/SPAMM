import {
   getMmListData,
   MAX_NUMBER_OF_MMS_PROXY,
} from "spamm-aggregator-sdk";
import { createRpcClients, withRpcRetry } from "../aggregator/client/txSendV1.ts";
import { fetchUpcomingMarkets, updateMarket } from "./localDb.ts";
import { createOddsSvm, simulateMarketQuotesLocally } from "./oddsIndexerHelpers.ts";
import { safeJSONStringify } from "./utils.ts";

export async function runOddsIndexer(): Promise<void> {
   console.log("Odds indexer: snapshot + local simulate");
   const markets = fetchUpcomingMarkets();
   const { rpc } = createRpcClients({
      httpUrl: process.env.HELIUS_RPC_URL,
   });
   const marketMakers = await withRpcRetry(() => getMmListData(rpc));
   const mmPrograms = marketMakers.mmProgramAddresses.slice(0, MAX_NUMBER_OF_MMS_PROXY);

   if (mmPrograms.length === 0) {
      console.log("No market makers registered; skipping odds indexer");
      return;
   }

   const ctx = await createOddsSvm(rpc, mmPrograms);

   for (const [, market] of markets) {
      try {
         const odds = await simulateMarketQuotesLocally(ctx, market, mmPrograms);
         if (odds === null) {
            continue;
         }
         // console.log(odds);
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
            `Error locally simulating market ${market.id} event ${market.event_id}`,
         );
         console.error(error instanceof Error ? error.message : String(error));
      }
   }

   console.log(`Odds indexer finished`);
}

// if (import.meta.main) {
//    await runOddsIndexer();
// }
