import {
   PROMO_MKT_ID,
   PROMO_MKT_STRING,
   addMarket,
   addPromotionalMarket,
   fetchEventsByEventId,
   fetchMarket,
   fetchPromotionalMarket,
   settlePromotionalMarket,
} from "./localDb";
import type { Address } from "@solana/kit";
import type { Event, PromoRelatedEvent, PromotionalMarket } from "./types";
import { safeJSONStringify } from "./utils";
import { createRpcClients, sendAndConfirmInstructions, simulateTransaction } from "../aggregator/client/txSend";
import { ADMIN_SIGNER } from "../aggregator/client/admin";
import { BetResult, getBetsData, getGradeBetsIx} from "spamm-aggregator-sdk";

const clients = createRpcClients({ httpUrl: "https://" + (process.env.CHAINSTACK_URL ?? "") });

function resolveEvent(eventId: number): Event {
   const matches = fetchEventsByEventId(eventId);
   if (matches.length === 0) {
      throw new Error(`Event ${eventId} not found`);
   }
   if (matches.length > 1) {
      throw new Error(`Event ${eventId} is ambiguous — resolve duplicates in the DB first`);
   }
   return matches[0]!;
}

function resolveRelatedEvents(eventIds: number[]): PromoRelatedEvent[] {
   return eventIds.map((id) => {
      const event = resolveEvent(id);
      return {
         sport_id: event.sport_id,
         league_id: event.league_id,
         event_id: event.id,
         event_name: event.event_name,
      };
   });
}

function earliestEventStartTime(eventIds: number[]): number {
   if (eventIds.length === 0) {
      throw new Error("No events to derive close time from");
   }
   return Math.min(...eventIds.map((id) => resolveEvent(id).start_time));
}

export type CreatePromotionalMarketInput = {
   title: string;
   description?: string;
   yesLabel?: string;
   periodId: number;
   /** Single-game: ids come from this event. */
   eventId?: number;
   /** Multi-game: you supply chain ids; optional linked events for UI. */
   sportId?: number;
   leagueId?: number;
   chainEventId?: number;
   relatedEventIds?: number[];
};

export function createPromotionalMarket(input: CreatePromotionalMarketInput): PromotionalMarket {
   const hasSingle = input.eventId != null;
   const hasManual = input.sportId != null && input.leagueId != null && input.chainEventId != null;
   if (hasSingle === hasManual) {
      throw new Error("Provide event_id (single game) OR sport_id + league_id + chain_event_id (multi/manual)");
   }

   const lastOdds = safeJSONStringify([0, 0]);
   const now = Date.now();
   let sport_id: number;
   let league_id: number;
   let event_id: number;
   let period_id = input.periodId;
   let related_events: PromoRelatedEvent[] = [];
   let closes_at: number | null = null;

   if (hasSingle) {
      const event = resolveEvent(input.eventId!);
      sport_id = event.sport_id;
      league_id = event.league_id;
      event_id = event.id;
      related_events = [{
         sport_id: event.sport_id,
         league_id: event.league_id,
         event_id: event.id,
         event_name: event.event_name,
      }];
      closes_at = earliestEventStartTime([input.eventId!]);
   } else {
      sport_id = input.sportId!;
      league_id = input.leagueId!;
      event_id = input.chainEventId!;
      if (input.relatedEventIds?.length) {
         related_events = resolveRelatedEvents(input.relatedEventIds);
         closes_at = earliestEventStartTime(input.relatedEventIds);
      }
   }

   const existing = fetchMarket(PROMO_MKT_ID, event_id, league_id, sport_id);
   if (existing) {
      throw new Error(`Promo market (mkt ${PROMO_MKT_ID}) already exists on ${sport_id}:${league_id}:${event_id}`);
   }

   const promo = addPromotionalMarket({
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      sport_id,
      league_id,
      event_id,
      period_id,
      yes_label: input.yesLabel?.trim() || "Yes",
      last_odds: lastOdds,
      related_events,
      closes_at,
      created_at: now,
   });

   addMarket({
      id: PROMO_MKT_ID,
      event_id,
      league_id,
      sport_id,
      period_id,
      line_value: null,
      last_odds: lastOdds,
      last_update: now,
      mkt_string: PROMO_MKT_STRING,
   });

   return promo;
}

export function settlePromotionalMarketAdmin(
   promoId: number,
   won: boolean,
   notes: string | null,
): PromotionalMarket {
   const promo = fetchPromotionalMarket(promoId);
   if (!promo) {
      throw new Error(`Promotional market ${promoId} not found`);
   }
   if (promo.status === "settled") {
      throw new Error(`Promotional market ${promoId} is already settled`);
   }
   const winningSide = won ? 0 : 1;
   const updated = settlePromotionalMarket(promoId, winningSide, notes);
   if (!updated) {
      throw new Error(`Failed to settle promotional market ${promoId}`);
   }
   return updated;
}

function promoMatchesBet(promo: PromotionalMarket, sport: number, league: number, eventId: number, period: number, mkt: number): boolean {
   return (
      mkt === PROMO_MKT_ID &&
      sport === promo.sport_id &&
      league === promo.league_id &&
      eventId === promo.event_id &&
      period === promo.period_id
   );
}

/** Grade pending single bets for one settled promo. Not part of normal `gradeBets()`. */
export async function gradePromoBets(promoId: number): Promise<number> {
   const promo = fetchPromotionalMarket(promoId);
   if (!promo || promo.status !== "settled" || promo.winning_side === null) {
      throw new Error(`Promo ${promoId} is not settled`);
   }

   const bets = await getBetsData(clients.rpc, { 
      result: BetResult.Pending, 
      marketId: {
         eventId: { 
            event: BigInt(promo.event_id), 
            league: promo.league_id, 
            sport: promo.sport_id 
         }, 
         player: BigInt(0),
         mkt: PROMO_MKT_ID,
         period: promo.period_id,
         isPregame: true,
      },
   });
   const resultAddresses: [BetResult, Address][] = [];

   for (const bet of bets) {
      const result = bet.data.side === promo.winning_side ? BetResult.Won : BetResult.Lost;
      resultAddresses.push([result, bet.address]);
   }

   const MAX_RESULTS_PER_TX = 25;
   for (let i = 0; i < resultAddresses.length; i += MAX_RESULTS_PER_TX) {
      const batch = resultAddresses.slice(i, i + MAX_RESULTS_PER_TX);
      const ix = await getGradeBetsIx(
         ADMIN_SIGNER.address,
         new Uint8Array(batch.map(([r]) => r)),
         batch.map(([, addr]) => addr),
      );
      await simulateTransaction(clients.rpc, [ix], [ADMIN_SIGNER], true);
      await sendAndConfirmInstructions([ix], [ADMIN_SIGNER], true);
   }

   return resultAddresses.length;
}
