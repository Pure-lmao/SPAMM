import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { MIN_BET_AMOUNT } from "spamm-aggregator-sdk";
import { apiSportToSdk, buildMarketId } from "../betting/chainIds";
import { runMmQuoteFlow } from "../betting/quoteAndFill";
import type { UiPromotionalMarket } from "./types";

export async function promoIsOpenToUser(
   rpc: Rpc<SolanaRpcApi>,
   userAddress: Address,
   promo: UiPromotionalMarket,
): Promise<boolean> {
   const marketId = buildMarketId(
      promo.event_id,
      promo.league_id,
      apiSportToSdk(promo.sport_id),
      promo.mkt_id,
      promo.period_id,
   );
   const q = await runMmQuoteFlow({
      rpc,
      userAddress,
      marketId,
      side: 0,
      amount: MIN_BET_AMOUNT,
   });
   return q.topMms.length > 0;
}

export async function filterPromosOpenToUser(
   rpc: Rpc<SolanaRpcApi>,
   userAddress: Address,
   promos: readonly UiPromotionalMarket[],
): Promise<UiPromotionalMarket[]> {
   const out: UiPromotionalMarket[] = [];
   for (const promo of promos) {
      if (await promoIsOpenToUser(rpc, userAddress, promo)) {
         out.push(promo);
      }
   }
   return out;
}
