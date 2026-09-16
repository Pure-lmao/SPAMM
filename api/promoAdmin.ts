import {
   PROMO_MKT_ID,
   addPromotionalMarket,
   fetchEventsByEventId,
   fetchOpenPromotionalMarketOnEvent,
   fetchPromotionalMarket,
   settlePromotionalMarket,
   updatePromotionalMarketLastOdds,
} from "./localDb";
import type { Address } from "@solana/kit";
import { address } from "@solana/kit";
import type { DbEvent, PromoRelatedEvent, PromotionalMarket } from "./types";
import { DEFAULT_MARKET_OPERATOR, safeJSONStringify } from "./utils";
import { createRpcClients, sendAndConfirmInstructions, simulateTransaction } from "../aggregator/client/txSend";
import { ADMIN_SIGNER } from "../aggregator/client/admin";
import { BetResult, getBetsData, getGradeBetsIx} from "spamm-aggregator-sdk";
import { MAX_PROMO_ALLOWED } from "../promo/backend/src/codex.ts";
import { ODDS_SCALE } from "../promo/backend/src/constants.ts";
import {
   buildPromoInitMarketFromParts,
   createPromoAdminContext,
   promoMarketIdFromIds,
   runPromoBootstrapMarket,
   runPromoCloseMarketAndEvent,
   runPromoUpdateOracle,
   runSetMarketMaxAmount,
   runSetMarketMaxTotalAmount,
} from "../promo/backend/src/adminRun.ts";
import { fetchPromoOracleAccount, formatPromoOracleChainState } from "../promo/backend/src/readOracle.ts";
import type { PromoOracleDisplay } from "../promo/backend/src/readOracle.ts";
import type { MarketId } from "../promo/backend/src/spammSdk.ts";

const clients = createRpcClients({ httpUrl: process.env.CHAINSTACK_URL});

function resolveEvent(eventId: number): DbEvent {
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

/** DB event times are unix ms; promo MM `event_start_time` is unix seconds. */
export function msToUnixSeconds(ms: number): number {
   if (ms > 1_000_000_000_000) {
      return Math.floor(ms / 1000);
   }
   return Math.floor(ms);
}

export function decimalOddsToScaled(odds: number): bigint {
   if (!Number.isFinite(odds) || odds <= 1) {
      throw new Error(`odds must be > 1 (got ${odds})`);
   }
   return BigInt(Math.round(odds * ODDS_SCALE));
}

export function usdcToMicro(usdc: number): bigint {
   if (!Number.isFinite(usdc) || usdc <= 0) {
      throw new Error(`USDC amount must be > 0 (got ${usdc})`);
   }
   return BigInt(Math.round(usdc * 1_000_000));
}

export function lastOddsJsonFromScaled(scaled: bigint): string {
   return safeJSONStringify([Number(scaled), 0]);
}

export function parseAllowAddresses(raw: string): Address[] {
   const out: Address[] = [];
   const seen = new Set<string>();
   for (const part of raw.split(/[,\s]+/)) {
      const trimmed = part.trim();
      if (!trimmed) {
         continue;
      }
      const pk = address(trimmed);
      if (seen.has(pk)) {
         continue;
      }
      seen.add(pk);
      out.push(pk);
   }
   if (out.length > MAX_PROMO_ALLOWED) {
      throw new Error(`allow list too long (${out.length} > ${MAX_PROMO_ALLOWED})`);
   }
   return out;
}

export function marketIdForPromo(promo: PromotionalMarket): MarketId {
   return promoMarketIdFromIds(promo.sport_id, promo.league_id, promo.event_id, promo.period_id);
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
   allow: readonly Address[];
   odds: number;
   maxUsdc: number;
   maxTotalUsdc: number;
};

export async function createPromotionalMarket(input: CreatePromotionalMarketInput): Promise<PromotionalMarket> {
   const hasSingle = input.eventId != null;
   const hasManual = input.sportId != null && input.leagueId != null && input.chainEventId != null;
   if (hasSingle === hasManual) {
      throw new Error("Provide event_id (single game) OR sport_id + league_id + chain_event_id (multi/manual)");
   }

   const oddsScaled = decimalOddsToScaled(input.odds);
   const lastOdds = lastOddsJsonFromScaled(oddsScaled);
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

   if (closes_at == null) {
      throw new Error("Need an event start time for on-chain init (single event_id or related_event_ids)");
   }

   const existing = fetchOpenPromotionalMarketOnEvent(sport_id, league_id, event_id, period_id);
   if (existing) {
      throw new Error(
         `Open promo ${existing.id} already exists on ${sport_id}:${league_id}:${event_id} period ${period_id}`,
      );
   }

   const ctx = await createPromoAdminContext();
   const parts = {
      sport: sport_id,
      league: league_id,
      event: BigInt(event_id),
      period: period_id,
      mkt: PROMO_MKT_ID,
      player: 0n,
   };
   const payload = await buildPromoInitMarketFromParts(
      parts,
      DEFAULT_MARKET_OPERATOR,
      input.allow,
      msToUnixSeconds(closes_at),
      2,
      usdcToMicro(input.maxUsdc),
      usdcToMicro(input.maxTotalUsdc),
   );
   await runPromoBootstrapMarket(ctx, {
      payload,
      odds0: oddsScaled,
      odds1: oddsScaled,
      odds2: 0n,
   });

   return addPromotionalMarket({
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

function requirePromo(promoId: number): PromotionalMarket {
   const promo = fetchPromotionalMarket(promoId);
   if (!promo) {
      throw new Error(`Promotional market ${promoId} not found`);
   }
   return promo;
}

export async function setPromoOdds(promoId: number, odds: number): Promise<PromotionalMarket> {
   const promo = requirePromo(promoId);
   const oddsScaled = decimalOddsToScaled(odds);
   const ctx = await createPromoAdminContext();
   const marketId = marketIdForPromo(promo);
   const oracle = await fetchPromoOracleAccount(ctx, marketId);
   const unix = Math.floor(Date.now() / 1000);
   const sequence = BigInt(Math.max(unix, (oracle?.oracle.sequence ?? 0) + 1));
   await runPromoUpdateOracle(ctx, marketId, sequence, oddsScaled, 0n, 0n);
   return updatePromotionalMarketLastOdds(promoId, lastOddsJsonFromScaled(oddsScaled));
}

export async function setPromoMaxUsdc(promoId: number, maxUsdc: number): Promise<void> {
   const promo = requirePromo(promoId);
   const ctx = await createPromoAdminContext();
   await runSetMarketMaxAmount(ctx, marketIdForPromo(promo), usdcToMicro(maxUsdc));
}

export async function setPromoMaxTotalUsdc(promoId: number, maxTotalUsdc: number): Promise<void> {
   const promo = requirePromo(promoId);
   const ctx = await createPromoAdminContext();
   await runSetMarketMaxTotalAmount(ctx, marketIdForPromo(promo), usdcToMicro(maxTotalUsdc));
}

export async function closePromoMarket(promoId: number): Promise<void> {
   const promo = requirePromo(promoId);
   const ctx = await createPromoAdminContext();
   await runPromoCloseMarketAndEvent(ctx, marketIdForPromo(promo));
}

export async function promoMarketStatus(promoId: number): Promise<PromoOracleDisplay> {
   const promo = requirePromo(promoId);
   const ctx = await createPromoAdminContext();
   const state = await fetchPromoOracleAccount(ctx, marketIdForPromo(promo));
   if (state == null) {
      throw new Error(`Promo ${promoId} has no on-chain market PDA`);
   }
   return formatPromoOracleChainState(state);
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
         operator: DEFAULT_MARKET_OPERATOR,
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
      await simulateTransaction(clients.rpc, [ix], [ADMIN_SIGNER]);
      await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   }

   return resultAddresses.length;
}
