import type { Address, Rpc, SolanaRpcApi, TransactionSigner } from "@solana/kit";
import {
   decodeMmReturnData,
   getFillBetIx,
   getMmGetQuoteIx,
   ODDS_SCALE,
   type MarketId,
} from "spamm-aggregator-sdk";
import { DEFAULT_EVENT_STATE_SEQUENCE, EVENT_GAME_STATE_PG } from "./chainIds";
import { getMmListCached } from "./mmCache";
import { buildSignV0Transaction, simulateInstructionReturnData } from "./txPipeline";

const QUOTE_PROBE_MIN_ODDS = ODDS_SCALE + 100n;

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

   const quoteBase = {
      marketId: params.marketId,
      side: params.side,
      amount: params.amount,
      minOddsScaled: QUOTE_PROBE_MIN_ODDS,
      eventGameState: EVENT_GAME_STATE_PG,
      eventStateSequence: DEFAULT_EVENT_STATE_SEQUENCE,
   };

   const rows = await Promise.all(
      mmList.mmProgramAddresses.map(async (mmProgramAddress: Address) => {
         try {
            const quoteIx = await getMmGetQuoteIx(quoteBase, mmProgramAddress, params.userAddress);
            const returnData = await simulateInstructionReturnData(params.rpc, quoteIx, params.userAddress, false);
            if (!returnData) {
               return undefined;
            }
            const parsed = decodeMmReturnData(returnData);
            if (parsed.maxAmount > 0n && parsed.oddsScaled > 0n) {
               return { mmProgramAddress, ...parsed };
            }
         } catch (e) {
            errors.push(`${mmProgramAddress}: ${e instanceof Error ? e.message : String(e)}`);
         }
         return undefined;
      }),
   );

   const valid = rows.filter((x): x is MmQuoteRow => x !== undefined);
   const fills = valid.filter((x) => x.maxAmount >= params.amount);
   const pool = fills.length > 0 ? fills : [];
   const sorted = [...pool].sort((a, b) => Number(b.oddsScaled - a.oddsScaled));
   const top = sorted.slice(0, 5);
   const conservativeMinOddsScaled =
      top.length === 0
         ? QUOTE_PROBE_MIN_ODDS
         : top.reduce((m, x) => (x.oddsScaled < m ? x.oddsScaled : m), top[0]!.oddsScaled);

   return { topMms: top, conservativeMinOddsScaled, errors };
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
