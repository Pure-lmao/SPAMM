import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import {
   decodeMarketQuotesProxyReturnData,
   getGetMarketQuotesProxyIx,
   maxProxyMmsForMarketQuotes,
   MAX_NUMBER_OF_MMS_PROXY,
   numSidesForMkt,
   ODDS_SCALE,
   type ProxyMarketMmQuotes,
} from "spamm-aggregator-sdk";
import type { UiGroupedEvent, UiMarket } from "../markets/types";
import {
   apiSportToSdk,
   buildMarketId,
   DEFAULT_EVENT_STATE_SEQUENCE,
   EVENT_GAME_STATE_PG,
   SIM_FEE_PAYER_ADDRESS,
} from "./chainIds";
import { getMmListCached } from "./mmCache";
import { simulateInstructionReturnData } from "./txPipeline";

const QUOTE_PROBE_BET_ID = 1n;
const QUOTE_PROBE_MIN_ODDS = ODDS_SCALE + 1n;

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

async function fetchLiveOddsForMarket(
   rpc: Rpc<SolanaRpcApi>,
   market: UiMarket,
   mmPrograms: readonly Address[],
): Promise<number[] | null> {
   const numSides = numSidesForMkt(market.id);
   if (numSides === undefined) {
      return null;
   }

   const mmProgramsForMarket = mmPrograms.slice(
      0,
      Math.min(MAX_NUMBER_OF_MMS_PROXY, maxProxyMmsForMarketQuotes(numSides)),
   );
   if (mmProgramsForMarket.length === 0) {
      return null;
   }

   const marketId = buildMarketId(
      market.event_id,
      market.league_id,
      apiSportToSdk(market.sport_id),
      market.id,
      market.period_id,
   );

   try {
      const quoteIx = await getGetMarketQuotesProxyIx(
         {
            betId: QUOTE_PROBE_BET_ID,
            marketId,
            side: 0,
            amount: 1n,
            minOddsScaled: QUOTE_PROBE_MIN_ODDS,
            eventGameState: EVENT_GAME_STATE_PG,
            eventStateSequence: DEFAULT_EVENT_STATE_SEQUENCE,
         },
         SIM_FEE_PAYER_ADDRESS,
         mmProgramsForMarket,
      );
      const returnData = await simulateInstructionReturnData(rpc, quoteIx, SIM_FEE_PAYER_ADDRESS, false);
      if (!returnData || returnData.length === 0) {
         return null;
      }
      const quotes = decodeMarketQuotesProxyReturnData(returnData, numSides);
      return bestOddsPerSideFromMarketQuotes(quotes, numSides);
   } catch {
      return null;
   }
}

/** Replace each market's `last_odds` with best per-side odds from `get_market_quotes_proxy`. */
export async function refreshEventOddsFromProxy(
   rpc: Rpc<SolanaRpcApi>,
   ev: UiGroupedEvent,
): Promise<UiGroupedEvent> {
   const markets = ev.markets;
   if (!markets?.length) {
      return ev;
   }

   const mmList = await getMmListCached(rpc);
   const mmPrograms = mmList.mmProgramAddresses.slice(0, MAX_NUMBER_OF_MMS_PROXY);
   if (mmPrograms.length === 0) {
      return ev;
   }

   const oddsResults = await Promise.all(
      markets.map((m) => fetchLiveOddsForMarket(rpc, m, mmPrograms)),
   );

   const now = Date.now();
   const updatedMarkets = markets.map((m, i) => {
      const odds = oddsResults[i];
      if (odds == null) {
         return m;
      }
      return {
         ...m,
         last_odds: JSON.stringify(odds),
         last_update: now,
      };
   });

   return { ...ev, markets: updatedMarkets };
}
