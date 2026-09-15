import type { Address } from "@solana/kit";
import {
   marketIdToJson,
   rfqRequestAndQuoteToFillIxData,
   type FreebetAccountData,
   type RfqFillIxFromQuote,
   type RfqHttpRequestJson,
   type RfqHttpResponseJson,
   type RfqQuoteJson,
   type RfqSelectionJson,
} from "spamm-aggregator-sdk";
import type { BetSlipSelection } from "./types";
import { parlayLegFromSelection } from "./betSlipUtils";
import { addressInList, oddsInFreebetRange } from "./freebets";

const apiDomain = import.meta.env.VITE_API_DOMAIN?.trim() ?? "";

export function rfqSelectionsFromSlip(selections: readonly BetSlipSelection[]): RfqSelectionJson[] {
   return selections.map((sel) => {
      const leg = parlayLegFromSelection(sel);
      return {
         marketId: marketIdToJson(leg.marketId),
         side: leg.side,
         eventStateSequence: leg.eventStateSequence,
         eventGameState: leg.eventGameState,
      };
   });
}

export function rfqQuoteRejectReason(
   quote: RfqQuoteJson,
   amount: bigint,
   voucher?: FreebetAccountData | null,
   nowUnixSecs: number = Math.floor(Date.now() / 1000),
): string | null {
   try {
      if (quote.offerExpiry <= nowUnixSecs) {
         return "Expired";
      }
      if (BigInt(quote.oddsScaled) <= 0n) {
         return "Invalid odds";
      }
      if (BigInt(quote.maxStake) < amount) {
         return "Stake above max";
      }
      if (voucher == null) {
         return null;
      }
      if (voucher.allowedMms.length > 0 && !addressInList(voucher.allowedMms, quote.mmProgramId)) {
         return "MM not allowed for freebet";
      }
      if (!oddsInFreebetRange(BigInt(quote.oddsScaled), voucher)) {
         return "Odds outside freebet range";
      }
      return null;
   } catch {
      return "Invalid quote";
   }
}

export function sortRfqQuotes(quotes: readonly RfqQuoteJson[]): RfqQuoteJson[] {
   return [...quotes].sort((a, b) => {
      const d = BigInt(b.oddsScaled) - BigInt(a.oddsScaled);
      return d > 0n ? 1 : d < 0n ? -1 : 0;
   });
}

export function pickBestRfqQuote(
   quotes: readonly RfqQuoteJson[],
   amount: bigint,
   voucher?: FreebetAccountData | null,
): RfqQuoteJson | null {
   const ok = quotes.filter((q) => rfqQuoteRejectReason(q, amount, voucher) == null);
   if (ok.length === 0) {
      return null;
   }
   return sortRfqQuotes(ok)[0]!;
}

export async function requestRfqQuotes(params: {
   user: Address;
   betId: bigint;
   amount: bigint;
   selections: readonly BetSlipSelection[];
}): Promise<RfqHttpResponseJson> {
   const body: RfqHttpRequestJson = {
      user: String(params.user),
      betId: params.betId.toString(),
      amount: params.amount.toString(),
      selections: rfqSelectionsFromSlip(params.selections),
   };
   const res = await fetch(`${apiDomain}/api/rfq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
   });
   if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `${res.status} ${res.statusText}`);
   }
   return (await res.json()) as RfqHttpResponseJson;
}

export function rfqFillFromResponse(
   request: RfqHttpRequestJson,
   quote: RfqQuoteJson,
): RfqFillIxFromQuote {
   return rfqRequestAndQuoteToFillIxData(request, quote);
}

export function rfqRequestBody(params: {
   user: Address;
   betId: bigint;
   amount: bigint;
   selections: readonly BetSlipSelection[];
}): RfqHttpRequestJson {
   return {
      user: String(params.user),
      betId: params.betId.toString(),
      amount: params.amount.toString(),
      selections: rfqSelectionsFromSlip(params.selections),
   };
}
