import { address, type Address } from "@solana/kit";
import {
   marketIdToJson,
   rfqRequestAndQuoteToFillIxData,
   type RfqHttpRequestJson,
   type RfqQuoteJson,
} from "spamm-aggregator-sdk";
import { LABS_DOMAIN } from "../network";
import { nextBetId } from "../chain/ids";
import { parlayLeg, type Leg } from "../markets/leg";
import type { Limits } from "./limits";

export type { RfqQuoteJson, RfqHttpRequestJson };

function selections(legs: readonly Leg[]) {
   return legs.map((leg) => {
      const item = parlayLeg(leg);
      return {
         marketId: marketIdToJson(item.marketId),
         side: item.side,
         eventStateSequence: item.eventStateSequence,
         eventGameState: item.eventGameState,
      };
   });
}

export function rfqBody(user: Address, amount: bigint, legs: readonly Leg[], betId = nextBetId()): RfqHttpRequestJson {
   return {
      user: String(user),
      betId: betId.toString(),
      amount: amount.toString(),
      selections: selections(legs),
   };
}

export function quoteReject(quote: RfqQuoteJson, amount: bigint, limits: Limits | null, now = Math.floor(Date.now() / 1000)): string | null {
   if (quote.offerExpiry <= now) {
      return "Expired";
   }
   let odds = 0n;
   let max = 0n;
   try {
      odds = BigInt(quote.oddsScaled);
      max = BigInt(quote.maxStake);
      address(quote.mmProgramId);
   } catch {
      return "Invalid quote";
   }
   if (odds <= 0n) {
      return "Invalid odds";
   }
   if (max < amount) {
      return "Stake above max";
   }
   if (limits == null) {
      return null;
   }
   if (limits.allowedMms.length > 0 && !limits.allowedMms.some((mm) => String(mm) === quote.mmProgramId)) {
      return "MM not allowed";
   }
   if (odds < limits.minOddsScaled || odds > limits.maxOddsScaled) {
      return "Odds outside voucher range";
   }
   return null;
}

export async function requestRfq(body: RfqHttpRequestJson): Promise<{ quotes: RfqQuoteJson[]; mmCount: number }> {
   const res = await fetch(`${LABS_DOMAIN}/api/rfq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
   });
   if (!res.ok) {
      throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
   }
   const data = (await res.json()) as { quotes?: RfqQuoteJson[]; mmCount?: number };
   const quotes = [...(data.quotes ?? [])].sort((a, b) => {
      const delta = BigInt(b.oddsScaled) - BigInt(a.oddsScaled);
      return delta > 0n ? 1 : delta < 0n ? -1 : 0;
   });
   return { quotes, mmCount: data.mmCount ?? 0 };
}

export function fillFromQuote(request: RfqHttpRequestJson, quote: RfqQuoteJson) {
   return rfqRequestAndQuoteToFillIxData(request, quote);
}
