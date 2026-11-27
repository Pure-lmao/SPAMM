import type { Address } from "@solana/kit";
import {
   MAX_NUMBER_OF_MMS_PROXY,
   ODDS_SCALE,
   decodeProxyParlayQuoteReturnData,
   decodeProxyQuoteReturnData,
   getGetParlayQuoteProxyIx,
   getGetQuoteProxyIx,
   getMmListData,
   type MarketId,
   type ParlayLegSel,
   type ProxyQuoteData,
} from "spamm-aggregator-sdk";
import { MM_LIST_TTL_MS } from "../constants";
import { ttlCache } from "../cache";
import { rpc } from "../chain/rpc";
import { DEFAULT_EVENT_STATE_SEQUENCE, EVENT_GAME_STATE_PG } from "../chain/ids";
import { simulateReturnData } from "../chain/rpc";
import { feePayerFor } from "../wallet/solFree";

const QUOTE_PROBE_MIN_ODDS = ODDS_SCALE + 100n;
const QUOTE_PROBE_BET_ID = 1n;
const mmCache = ttlCache<Awaited<ReturnType<typeof getMmListData>>>(MM_LIST_TTL_MS);

export type MmQuoteRow = {
   mmProgramAddress: Address;
   maxAmount: bigint;
   oddsScaled: bigint;
};

export type QuoteFlowResult = {
   topMms: MmQuoteRow[];
   errors: string[];
};

async function mmPrograms(allowed?: readonly Address[]): Promise<Address[]> {
   const list = await mmCache.get(() => getMmListData(rpc));
   const registered = list.mmProgramAddresses.slice(0, MAX_NUMBER_OF_MMS_PROXY);
   if (allowed == null || allowed.length === 0) {
      return registered;
   }
   const set = new Set(allowed.map(String));
   return registered.filter((mm) => set.has(String(mm)));
}

function rows(quotes: readonly ProxyQuoteData[]): MmQuoteRow[] {
   return quotes
      .filter((quote) => quote.maxAmount > 0n && quote.oddsScaled > 0n)
      .map((quote) => ({
         mmProgramAddress: quote.mmAddress,
         maxAmount: quote.maxAmount,
         oddsScaled: quote.oddsScaled,
      }))
      .sort((a, b) => (a.oddsScaled === b.oddsScaled ? 0 : a.oddsScaled > b.oddsScaled ? -1 : 1));
}

export function oddsCoveringStake(book: readonly MmQuoteRow[], stake: bigint): bigint | null {
   if (stake <= 0n || book.length === 0) {
      return null;
   }
   let covered = 0n;
   let marginal = book[0]!.oddsScaled;
   for (const row of book) {
      covered += row.maxAmount;
      marginal = row.oddsScaled;
      if (covered >= stake) {
         break;
      }
   }
   return marginal;
}

export async function quoteSingle(user: Address, marketId: MarketId, side: number, amount: bigint, allowed?: readonly Address[]): Promise<QuoteFlowResult> {
   const programs = await mmPrograms(allowed);
   if (programs.length === 0) {
      return { topMms: [], errors: ["No market makers registered"] };
   }
   try {
      const ix = await getGetQuoteProxyIx({
         betId: QUOTE_PROBE_BET_ID,
         marketId,
         side,
         amount,
         minOddsScaled: QUOTE_PROBE_MIN_ODDS,
         eventGameState: EVENT_GAME_STATE_PG,
         eventStateSequence: DEFAULT_EVENT_STATE_SEQUENCE,
      }, user, programs);
      const feePayer = await feePayerFor(user);
      const data = await simulateReturnData(ix, feePayer);
      if (data == null || data.length === 0) {
         return { topMms: [], errors: ["No MM returned a quote"] };
      }
      return { topMms: rows(decodeProxyQuoteReturnData(data)).slice(0, MAX_NUMBER_OF_MMS_PROXY), errors: [] };
   } catch (error) {
      return { topMms: [], errors: [error instanceof Error ? error.message : String(error)] };
   }
}

export async function quoteParlay(user: Address, legs: readonly ParlayLegSel[], amount: bigint, allowed?: readonly Address[]): Promise<QuoteFlowResult> {
   const programs = await mmPrograms(allowed);
   if (programs.length === 0) {
      return { topMms: [], errors: ["No market makers registered"] };
   }
   try {
      const ix = await getGetParlayQuoteProxyIx({
         betId: QUOTE_PROBE_BET_ID,
         amount,
         minOddsScaled: QUOTE_PROBE_MIN_ODDS,
         numLegs: legs.length,
         legs: [...legs],
      }, user, programs);
      const feePayer = await feePayerFor(user);
      const data = await simulateReturnData(ix, feePayer);
      if (data == null || data.length === 0) {
         return { topMms: [], errors: ["No MM returned a parlay quote"] };
      }
      return { topMms: rows(decodeProxyParlayQuoteReturnData(data)).slice(0, MAX_NUMBER_OF_MMS_PROXY), errors: [] };
   } catch (error) {
      return { topMms: [], errors: [error instanceof Error ? error.message : String(error)] };
   }
}
