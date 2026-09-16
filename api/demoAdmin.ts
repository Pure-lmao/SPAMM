import { address } from "@solana/kit";
import {
   getFreebetIssuerData,
   getIssueFreebetIx,
   ODDS_SCALE,
} from "spamm-aggregator-sdk";
import { ADMIN_SIGNER } from "../aggregator/client/admin";
import {
   buildSignV0Transaction,
   createRpcClients,
   sendAndConfirmSignedTransaction,
} from "../aggregator/client/txSend";
import { listUpcomingEvents, periodIdForSport, type UpcomingEventSummary } from "./marketAdmin";
import {
   createPromotionalMarket,
   parseAllowAddresses,
} from "./promoAdmin";
import { fetchEventsByEventId, fetchPromotionalMarketsForEvent, promotionalMarketToJson } from "./localDb";

const httpUrl = process.env.HELIUS_RPC_URL ?? process.env.CHAINSTACK_RPC_URL;
const clients = createRpcClients(httpUrl != null ? { httpUrl } : undefined);

const DEMO_FREEBET_AMOUNT = 2n * 10n ** 6n;
const DEMO_FREEBET_TTL_SECS = 60 * 60 * 24 * 7;
const DEMO_PROMO_USDC = 1;
const DEMO_MAX_ODDS = 10;

function eventHasOpenPromo(sportId: number, leagueId: number, eventId: number): boolean {
   return fetchPromotionalMarketsForEvent(sportId, leagueId, eventId).length > 0;
}

export function listDemoEvents(): UpcomingEventSummary[] {
   return listUpcomingEvents().filter((e) => !eventHasOpenPromo(e.sport_id, e.league_id, e.id));
}

export async function issueDemoFreebet(userRaw: string): Promise<{
   success: true;
   signature: string;
   freebetId: number;
}> {
   const user = address(userRaw);
   await getFreebetIssuerData(clients.rpc, ADMIN_SIGNER.address);
   const nowSec = Math.floor(Date.now() / 1000);
   const freebetId = nowSec;
   const ix = await getIssueFreebetIx(ADMIN_SIGNER.address, user, {
      freebetId,
      expiry: nowSec + DEMO_FREEBET_TTL_SECS,
      amount: DEMO_FREEBET_AMOUNT,
      minOddsScaled: (11n * ODDS_SCALE) / 10n,
      maxOddsScaled: 100n * ODDS_SCALE,
      minLegs: 1,
      allowedMms: [],
      allowedOperators: [],
   });
   const signed = await buildSignV0Transaction(clients.rpc, {
      feePayer: ADMIN_SIGNER,
      instructions: [ix],
      signers: [ADMIN_SIGNER],
   });
   const signature = await sendAndConfirmSignedTransaction(clients, signed);
   return { success: true, signature: String(signature), freebetId };
}

export type CreateDemoPromoInput = {
   title: string;
   eventId: number;
   odds: number;
   yesLabel: string;
   description?: string;
   allow?: string;
};

export async function createDemoPromo(input: CreateDemoPromoInput) {
   const title = input.title.trim();
   const yesLabel = input.yesLabel.trim();
   if (title === "") {
      throw new Error("title is required");
   }
   if (yesLabel === "") {
      throw new Error("yesLabel is required");
   }
   if (!Number.isFinite(input.eventId)) {
      throw new Error("eventId is required");
   }
   if (!Number.isFinite(input.odds) || input.odds <= 1 || input.odds > DEMO_MAX_ODDS) {
      throw new Error(`odds must be > 1 and <= ${DEMO_MAX_ODDS}`);
   }

   const matches = fetchEventsByEventId(input.eventId);
   if (matches.length === 0) {
      throw new Error(`Event ${input.eventId} not found`);
   }
   if (matches.length > 1) {
      throw new Error(`Event ${input.eventId} is ambiguous`);
   }
   const event = matches[0]!;
   if (eventHasOpenPromo(event.sport_id, event.league_id, event.id)) {
      throw new Error("That event already has a promo market");
   }

   const promo = await createPromotionalMarket({
      title,
      description: input.description,
      yesLabel,
      periodId: periodIdForSport(event.sport_id),
      eventId: input.eventId,
      allow: parseAllowAddresses(input.allow ?? ""),
      odds: input.odds,
      maxUsdc: DEMO_PROMO_USDC,
      maxTotalUsdc: DEMO_PROMO_USDC,
   });
   return promotionalMarketToJson(promo);
}
