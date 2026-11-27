import { address, type Address } from "@solana/kit";
import {
   MAX_NUMBER_OF_MMS,
   getBoostedFillBetIx,
   getBoostedFillParlayIx,
   getBoostedFillRfqBetIx,
   getBoostedFillRfqParlayIx,
   getFillBetIx,
   getFillParlayIx,
   getFillRfqIxFromData,
   getFreebetFillBetIx,
   getFreebetFillParlayIx,
   getFreebetFillRfqBetIx,
   getFreebetFillRfqParlayIx,
   type RfqHttpRequestJson,
   type RfqQuoteJson,
} from "spamm-aggregator-sdk";
import { nextBetId, DEFAULT_EVENT_STATE_SEQUENCE, EVENT_GAME_STATE_PG } from "../chain/ids";
import { buildMarketId, chainSide, parlayLeg, type Leg } from "../markets/leg";
import { sendInstructions } from "../wallet/send";
import type { BotWallet } from "../wallet/privy";
import { feePayerFor } from "../wallet/solFree";
import { fillFromQuote } from "./rfq";
import type { MmQuoteRow } from "./quote";
import type { SlipBoost, SlipFreebet } from "./vouchers";

export type VoucherPick =
   | { kind: "freebet"; row: SlipFreebet }
   | { kind: "boost"; row: SlipBoost }
   | null;

function singleBody(leg: Leg, amount: bigint, minOddsScaled: bigint) {
   return {
      betId: nextBetId(),
      marketId: buildMarketId(leg),
      side: chainSide(leg),
      amount,
      minOddsScaled,
      eventStateSequence: DEFAULT_EVENT_STATE_SEQUENCE,
      eventGameState: EVENT_GAME_STATE_PG,
   };
}

export async function placeAuction(wallet: BotWallet, legs: readonly Leg[], amount: bigint, minOddsScaled: bigint, quotes: readonly MmQuoteRow[], voucher: VoucherPick): Promise<string> {
   const feePayer = await feePayerFor(wallet.address);
   const user = wallet.address;
   let ix;
   if (legs.length === 1) {
      const body = singleBody(legs[0]!, amount, minOddsScaled);
      const mms = quotes.map((row) => row.mmProgramAddress).slice(0, MAX_NUMBER_OF_MMS);
      if (voucher?.kind === "freebet") {
         ix = await getFreebetFillBetIx(body, feePayer, user, voucher.row.data.issuerAuth, voucher.row.data.freebetId, mms, false);
      } else if (voucher?.kind === "boost") {
         ix = await getBoostedFillBetIx(body, feePayer, user, voucher.row.data.issuerAuth, voucher.row.data.boostId, mms, false);
      } else {
         ix = await getFillBetIx(body, feePayer, user, mms, false);
      }
   } else {
      const mm = quotes[0]?.mmProgramAddress;
      if (mm == null) {
         throw new Error("No parlay quote");
      }
      const fill = {
         betId: nextBetId(),
         amount,
         minOddsScaled,
         numLegs: legs.length,
         legs: legs.map(parlayLeg),
      };
      if (voucher?.kind === "freebet") {
         ix = await getFreebetFillParlayIx(fill, feePayer, user, voucher.row.data.issuerAuth, voucher.row.data.freebetId, mm);
      } else if (voucher?.kind === "boost") {
         ix = await getBoostedFillParlayIx(fill, feePayer, user, voucher.row.data.issuerAuth, voucher.row.data.boostId, mm);
      } else {
         ix = await getFillParlayIx(fill, feePayer, user, mm);
      }
   }
   const sig = await sendInstructions(wallet, [ix]);
   return String(sig);
}

export async function placeRfq(wallet: BotWallet, request: RfqHttpRequestJson, quote: RfqQuoteJson, voucher: VoucherPick): Promise<string> {
   const feePayer = await feePayerFor(wallet.address);
   const user = wallet.address;
   const fill = fillFromQuote(request, quote);
   const mm = address(quote.mmProgramId);
   let ix;
   if (voucher?.kind === "freebet" && fill.kind === "fillRfqBet") {
      ix = await getFreebetFillRfqBetIx(fill.data, feePayer, user, voucher.row.data.issuerAuth, voucher.row.data.freebetId, mm, false);
   } else if (voucher?.kind === "freebet" && fill.kind === "fillRfqParlay") {
      ix = await getFreebetFillRfqParlayIx(fill.data, feePayer, user, voucher.row.data.issuerAuth, voucher.row.data.freebetId, mm);
   } else if (voucher?.kind === "boost" && fill.kind === "fillRfqBet") {
      ix = await getBoostedFillRfqBetIx(fill.data, feePayer, user, voucher.row.data.issuerAuth, voucher.row.data.boostId, mm, false);
   } else if (voucher?.kind === "boost" && fill.kind === "fillRfqParlay") {
      ix = await getBoostedFillRfqParlayIx(fill.data, feePayer, user, voucher.row.data.issuerAuth, voucher.row.data.boostId, mm);
   } else {
      ix = await getFillRfqIxFromData(fill, feePayer, user, false);
   }
   const sig = await sendInstructions(wallet, [ix]);
   return String(sig);
}

export type { Address };
