import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import {
   decodeMarketQuotesProxyReturnData,
   getGetMarketQuotesProxyIx,
   maxProxyMmsForMarketQuotes,
   MAX_NUMBER_OF_MMS_PROXY,
   MIN_BET_AMOUNT,
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
   parseOperatorAddress,
   SIM_FEE_PAYER_ADDRESS,
} from "./chainIds";
import { getMmListCached } from "./mmCache";
import { runPacedRpc, simulateInstructionReturnData } from "./txPipeline";

const QUOTE_PROBE_BET_ID = 1n;
const QUOTE_PROBE_MIN_ODDS = ODDS_SCALE + 1n;
const BLOCKHASH_REFRESH_EVERY = 20;

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

async function fetchLatestBlockhash(rpc: Rpc<SolanaRpcApi>) {
   const { value } = await runPacedRpc(() => rpc.getLatestBlockhash({ commitment: "confirmed" }).send());
   return value;
}

async function fetchLiveOddsForMarket(
   rpc: Rpc<SolanaRpcApi>,
   market: UiMarket,
   mmPrograms: readonly Address[],
   lifetime: Awaited<ReturnType<typeof fetchLatestBlockhash>>,
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
      BigInt(market.player_id ?? 0),
      parseOperatorAddress(market.operator),
   );

   try {
      const quoteIx = await getGetMarketQuotesProxyIx(
         {
            betId: QUOTE_PROBE_BET_ID,
            marketId,
            side: 0,
            amount: MIN_BET_AMOUNT,
            minOddsScaled: QUOTE_PROBE_MIN_ODDS,
            eventGameState: EVENT_GAME_STATE_PG,
            eventStateSequence: DEFAULT_EVENT_STATE_SEQUENCE,
         },
         SIM_FEE_PAYER_ADDRESS,
         mmProgramsForMarket,
      );
      const returnData = await simulateInstructionReturnData(
         rpc,
         quoteIx,
         SIM_FEE_PAYER_ADDRESS,
         lifetime,
      );
      if (!returnData || returnData.length === 0) {
         return null;
      }
      const quotes = decodeMarketQuotesProxyReturnData(returnData, numSides);
      return bestOddsPerSideFromMarketQuotes(quotes, numSides);
   } catch (error) {
      console.warn(`Live quote failed for mkt ${market.id} player ${market.player_id ?? 0}`, error);
      return null;
   }
}

/** Replace each market's `last_odds` with best per-side odds from `get_market_quotes_proxy`. */
export async function refreshEventOddsFromProxy(
   rpc: Rpc<SolanaRpcApi>,
   ev: UiGroupedEvent,
   onUpdate?: (next: UiGroupedEvent) => void,
): Promise<UiGroupedEvent> {
   const markets = ev.markets;
   if (!markets?.length) {
      return ev;
   }

   const mmList = await getMmListCached(rpc);
   const mmPrograms = mmList.mmProgramAddresses.slice(0, MAX_NUMBER_OF_MMS_PROXY);
   if (mmPrograms.length === 0) {
      console.warn("Live odds refresh skipped: mm list has no programs");
      return ev;
   }

   let lifetime = await fetchLatestBlockhash(rpc);
   const updatedMarkets = [...markets];
   let next: UiGroupedEvent = ev;

   for (let i = 0; i < markets.length; i++) {
      if (i > 0 && i % BLOCKHASH_REFRESH_EVERY === 0) {
         lifetime = await fetchLatestBlockhash(rpc);
      }
      const odds = await fetchLiveOddsForMarket(rpc, markets[i]!, mmPrograms, lifetime);
      if (odds == null) {
         continue;
      }
      updatedMarkets[i] = {
         ...markets[i]!,
         last_odds: JSON.stringify(odds),
         last_update: Date.now(),
      };
      next = { ...ev, markets: [...updatedMarkets] };
      onUpdate?.(next);
   }

   return next;
}
