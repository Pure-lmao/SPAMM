import type { Address, Rpc, SolanaRpcApi, TransactionSigner } from "@solana/kit";
import {
   decodeProxyQuoteReturnData,
   getFillBetIx,
   getFillParlayIx,
   getGetParlayQuoteProxyIx,
   getGetQuoteProxyIx,
   MAX_NUMBER_OF_MMS_PROXY,
   ODDS_SCALE,
   type FillParlayIxData,
   type MarketId,
   type ParlayLegWire,
   type ProxyQuoteData,
} from "spamm-aggregator-sdk";
import { DEFAULT_EVENT_STATE_SEQUENCE, EVENT_GAME_STATE_PG } from "./chainIds";
import { getMmListCached } from "./mmCache";
import { buildSignV0Transaction, simulateInstructionReturnData } from "./txPipeline";

const QUOTE_PROBE_MIN_ODDS = ODDS_SCALE + 100n;
/** Unused on-chain for quote-proxy instructions; must be > 0 for SDK validation. */
const QUOTE_PROBE_BET_ID = 1n;

function proxyQuotesToRows(quotes: readonly ProxyQuoteData[], amount: bigint): MmQuoteRow[] {
   const valid = quotes
      .filter((q) => q.maxAmount > 0n && q.oddsScaled > 0n)
      .map((q) => ({
         mmProgramAddress: q.mmAddress,
         maxAmount: q.maxAmount,
         oddsScaled: q.oddsScaled,
      }));
   const fills = valid.filter((x) => x.maxAmount >= amount);
   const pool = fills.length > 0 ? fills : [];
   return [...pool].sort((a, b) => Number(b.oddsScaled - a.oddsScaled));
}

export type MmQuoteRow = Readonly<{
   mmProgramAddress: Address;
   maxAmount: bigint;
   oddsScaled: bigint;
}>;

export type QuoteFlowResult = Readonly<{
   topMms: MmQuoteRow[];
   conservativeMinOddsScaled: bigint;
   errors: string[];
}>;

export async function runMmQuoteFlow(params: {
   rpc: Rpc<SolanaRpcApi>;
   userAddress: Address;
   marketId: MarketId;
   side: number;
   /** Stake in USDC base units (6 decimals: multiply whole USDC by 10^6). */
   amount: bigint;
}): Promise<QuoteFlowResult> {
   const errors: string[] = [];
   const mmList = await getMmListCached(params.rpc);
   const mmPrograms = mmList.mmProgramAddresses.slice(0, MAX_NUMBER_OF_MMS_PROXY);

   if (mmPrograms.length === 0) {
      return { topMms: [], conservativeMinOddsScaled: QUOTE_PROBE_MIN_ODDS, errors };
   }

   try {
      const quoteIx = await getGetQuoteProxyIx(
         {
            betId: QUOTE_PROBE_BET_ID,
            marketId: params.marketId,
            side: params.side,
            amount: params.amount,
            minOddsScaled: QUOTE_PROBE_MIN_ODDS,
            eventGameState: EVENT_GAME_STATE_PG,
            eventStateSequence: DEFAULT_EVENT_STATE_SEQUENCE,
         },
         params.userAddress,
         mmPrograms,
      );
      const returnData = await simulateInstructionReturnData(params.rpc, quoteIx, params.userAddress, false);
      if (!returnData || returnData.length === 0) {
         return { topMms: [], conservativeMinOddsScaled: QUOTE_PROBE_MIN_ODDS, errors };
      }
      const sorted = proxyQuotesToRows(decodeProxyQuoteReturnData(returnData), params.amount);
      const top = sorted.slice(0, MAX_NUMBER_OF_MMS_PROXY);
      const conservativeMinOddsScaled =
         top.length === 0
            ? QUOTE_PROBE_MIN_ODDS
            : top.reduce((m, x) => (x.oddsScaled < m ? x.oddsScaled : m), top[0]!.oddsScaled);

      return { topMms: top, conservativeMinOddsScaled, errors };
   } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return { topMms: [], conservativeMinOddsScaled: QUOTE_PROBE_MIN_ODDS, errors };
   }
}

export async function buildAndSignFillBetTx(params: {
   rpc: Rpc<SolanaRpcApi>;
   walletSigner: TransactionSigner;
   userAddress: Address;
   fill: {
      betId: bigint;
      marketId: MarketId;
      side: number;
      /** USDC base units (6 decimals). */
      amount: bigint;
      minOddsScaled: bigint;
   };
   mmPrograms: readonly Address[];
}): Promise<ReturnType<typeof buildSignV0Transaction>> {
   const ix = await getFillBetIx(
      {
         betId: params.fill.betId,
         marketId: params.fill.marketId,
         side: params.fill.side,
         amount: params.fill.amount,
         minOddsScaled: params.fill.minOddsScaled,
         eventStateSequence: DEFAULT_EVENT_STATE_SEQUENCE,
         eventGameState: EVENT_GAME_STATE_PG,
      },
      params.userAddress,
      params.userAddress,
      params.mmPrograms,
   );
   return buildSignV0Transaction(params.rpc, {
      feePayer: params.walletSigner,
      instructions: [ix],
      signers: [params.walletSigner],
      useALT: false,
   });
}

export async function runMmParlayQuoteFlow(params: {
   rpc: Rpc<SolanaRpcApi>;
   userAddress: Address;
   legs: readonly ParlayLegWire[];
   amount: bigint;
}): Promise<QuoteFlowResult & { bestMm: MmQuoteRow | null }> {
   const errors: string[] = [];
   const mmList = await getMmListCached(params.rpc);
   const mmPrograms = mmList.mmProgramAddresses.slice(0, MAX_NUMBER_OF_MMS_PROXY);

   if (mmPrograms.length === 0) {
      return { topMms: [], conservativeMinOddsScaled: QUOTE_PROBE_MIN_ODDS, errors, bestMm: null };
   }

   try {
      const quoteIx = await getGetParlayQuoteProxyIx(
         {
            betId: QUOTE_PROBE_BET_ID,
            amount: params.amount,
            minOddsScaled: QUOTE_PROBE_MIN_ODDS,
            numLegs: params.legs.length,
            legs: params.legs,
         },
         params.userAddress,
         mmPrograms,
      );
      const returnData = await simulateInstructionReturnData(params.rpc, quoteIx, params.userAddress, false);
      if (!returnData || returnData.length === 0) {
         return { topMms: [], conservativeMinOddsScaled: QUOTE_PROBE_MIN_ODDS, errors, bestMm: null };
      }
      const sorted = proxyQuotesToRows(decodeProxyQuoteReturnData(returnData), params.amount);
      const best = sorted[0] ?? null;
      const conservativeMinOddsScaled =
         best === null
            ? QUOTE_PROBE_MIN_ODDS
            : sorted.reduce((m, x) => (x.oddsScaled < m ? x.oddsScaled : m), best.oddsScaled);

      return {
         topMms: sorted.slice(0, MAX_NUMBER_OF_MMS_PROXY),
         conservativeMinOddsScaled,
         errors,
         bestMm: best,
      };
   } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return { topMms: [], conservativeMinOddsScaled: QUOTE_PROBE_MIN_ODDS, errors, bestMm: null };
   }
}

export async function buildAndSignFillParlayTx(params: {
   rpc: Rpc<SolanaRpcApi>;
   walletSigner: TransactionSigner;
   userAddress: Address;
   fill: FillParlayIxData;
   mmProgram: Address;
}): Promise<ReturnType<typeof buildSignV0Transaction>> {
   const ix = await getFillParlayIx(params.fill, params.userAddress, params.userAddress, params.mmProgram);
   return buildSignV0Transaction(params.rpc, {
      feePayer: params.walletSigner,
      instructions: [ix],
      signers: [params.walletSigner],
      useALT: false,
   });
}
