import { useEffect, useMemo, useState } from "react";
import { fetchBetCardEvents } from "./fetchEvent";
import type { WalletBetRow } from "./fetchBetHistory";
import { fetchPromosForBetLookup } from "./fetchPromos";
import { eventLookupKey, indexPromotionalMarkets, isPromoMarketChain } from "./myBetsMarketDisplay";
import type { BetCardEvent, UiPromotionalMarket } from "./types";
import type { MarketId } from "spamm-aggregator-sdk";

function marketIdsOf(row: WalletBetRow): readonly MarketId[] {
   if (row.kind === "single") {
      return [row.data.marketId];
   }
   return row.legs.map((leg) => leg.marketId);
}

/** Event names and promo copy for the bets currently on screen. */
export function useBetPresentation(rows: readonly WalletBetRow[]): {
   eventsByKey: ReadonlyMap<string, BetCardEvent | null>;
   promosByMarketKey: ReadonlyMap<string, UiPromotionalMarket>;
} {
   const [eventsByKey, setEventsByKey] = useState<ReadonlyMap<string, BetCardEvent | null>>(() => new Map());
   const [promosByMarketKey, setPromosByMarketKey] = useState<ReadonlyMap<string, UiPromotionalMarket>>(
      () => new Map(),
   );

   const eventKeys = useMemo(() => {
      const keys = new Map<string, { sport: number; league: number; event: number; operator: string }>();
      for (const row of rows) {
         for (const marketId of marketIdsOf(row)) {
            const eid = marketId.eventId;
            const key = eventLookupKey(marketId);
            if (!keys.has(key)) {
               keys.set(key, {
                  sport: eid.sport,
                  league: eid.league,
                  event: Number(eid.event),
                  operator: String(marketId.operator),
               });
            }
         }
      }
      return keys;
   }, [rows]);

   const hasPromoBets = useMemo(() => {
      for (const row of rows) {
         for (const marketId of marketIdsOf(row)) {
            if (isPromoMarketChain(marketId)) {
               return true;
            }
         }
      }
      return false;
   }, [rows]);

   useEffect(() => {
      const missing = [...eventKeys.entries()].filter(([key]) => !eventsByKey.has(key));
      if (missing.length === 0) {
         return;
      }
      let cancelled = false;
      void (async () => {
         const byKey = new Map<string, BetCardEvent>();
         try {
            const cards = await fetchBetCardEvents(
               missing.map(([, ids]) => ({
                  sportId: ids.sport,
                  leagueId: ids.league,
                  eventId: ids.event,
                  operator: ids.operator,
               })),
            );
            for (const ev of cards) {
               byKey.set(`${ev.sport_id}:${ev.league_id}:${ev.id}`, ev);
            }
         } catch {
            /* mark missing keys null below so we do not retry per bet */
         }
         if (!cancelled) {
            setEventsByKey((prev) => {
               const next = new Map(prev);
               for (const [key] of missing) {
                  if (!next.has(key)) {
                     next.set(key, byKey.get(key) ?? null);
                  }
               }
               return next;
            });
         }
      })();
      return () => {
         cancelled = true;
      };
   }, [eventKeys, eventsByKey]);

   useEffect(() => {
      if (!hasPromoBets) {
         setPromosByMarketKey(new Map());
         return;
      }
      let cancelled = false;
      void (async () => {
         try {
            const promos = await fetchPromosForBetLookup();
            if (!cancelled) {
               setPromosByMarketKey(indexPromotionalMarkets(promos));
            }
         } catch {
            if (!cancelled) {
               setPromosByMarketKey(new Map());
            }
         }
      })();
      return () => {
         cancelled = true;
      };
   }, [hasPromoBets]);

   return { eventsByKey, promosByMarketKey };
}
