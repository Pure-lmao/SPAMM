import { type ReactElement } from "react";
import { buildMarketLabel } from "../betting/marketLabel";
import { pickBetSide } from "../betting/outcomeSide";
import { useBetSlip } from "../betting/BetSlipContext";
import { decimalOddsFromDb, fmtOdd, parseOdds } from "./oddsFormat";
import type { UiPromotionalMarket } from "./types";

type PromoMarketsSectionProps = {
   promos: readonly UiPromotionalMarket[];
   /** When set, omit promos not tied to this event (home shows all active). */
   eventFilter?: { sportId: number; leagueId: number; eventId: number };
};

function promoMatchesEvent(
   promo: UiPromotionalMarket,
   filter: { sportId: number; leagueId: number; eventId: number },
): boolean {
   if (
      promo.sport_id === filter.sportId &&
      promo.league_id === filter.leagueId &&
      promo.event_id === filter.eventId
   ) {
      return true;
   }
   return promo.related_events.some(
      (e) =>
         e.sport_id === filter.sportId &&
         e.league_id === filter.leagueId &&
         e.event_id === filter.eventId,
   );
}

function promoEventTitle(promo: UiPromotionalMarket): string | null {
   if (promo.related_events.length <= 1) {
      return null;
   }
   return promo.related_events
      .map((e) => e.event_name?.trim() || `Event ${e.event_id}`)
      .join(" · ");
}

export function PromoMarketsSection({ promos, eventFilter }: PromoMarketsSectionProps): ReactElement | null {
   const { toggleSelection, isSelected } = useBetSlip();

   const visible = promos.filter((p) => {
      if (p.status !== "open") {
         return false;
      }
      if (eventFilter == null) {
         return true;
      }
      return promoMatchesEvent(p, eventFilter);
   });

   if (visible.length === 0) {
      return null;
   }

   return (
      <section className="promo-markets-section" aria-label="Promotional markets">
         <h2 className="promo-markets-section__title">Odds Boost</h2>
         <ul className="promo-markets-list">
            {visible.map((promo) => {
               const [yesDb] = parseOdds(promo.last_odds);
               const yesDec = decimalOddsFromDb(yesDb);
               const related = promoEventTitle(promo);
               const mktId = promo.mkt_id;
               const marketRow = {
                  id: mktId,
                  mkt_string: "PROMO",
                  period_id: promo.period_id,
                  line_value: null,
               };

               const pickYes = () => {
                  toggleSelection({
                     eventTitle: promo.title,
                     marketLabel: buildMarketLabel("main", marketRow, pickBetSide("main", "PROMO", 0), {
                        homeName: promo.yes_label,
                        awayName: "",
                     }),
                     displayedDecimalOdds: yesDec > 0 ? yesDec : null,
                     eventId: promo.event_id,
                     leagueId: promo.league_id,
                     sportApiId: promo.sport_id,
                     marketWireId: mktId,
                     periodId: promo.period_id,
                     column: "main",
                     outcomeIndex: 0,
                     mktString: "PROMO",
                  });
               };

               const yesSelected = isSelected({
                  eventId: promo.event_id,
                  marketWireId: mktId,
                  periodId: promo.period_id,
                  column: "main",
                  outcomeIndex: 0,
               });

               return (
                  <li key={promo.id} className="promo-market-card">
                     <div className="promo-market-card__head">
                        <h3 className="promo-market-card__title">{promo.title}</h3>
                     </div>
                     {promo.description.trim() !== "" && (
                        <p className="promo-market-card__description">{promo.description}</p>
                     )}
                     {related != null && <p className="promo-market-card__related">{related}</p>}
                     <div className="promo-market-card__odds promo-market-card__odds--single">
                        <button
                           type="button"
                           className={`odd-btn promo-market-card__odd${yesSelected ? " odd-btn--selected" : ""}`}
                           disabled={yesDb === 0}
                           onClick={pickYes}
                        >
                           <span className="promo-market-card__odd-label">{promo.yes_label}</span>
                           <span
                              className={`promo-market-card__odd-price${yesDb > 0 ? " promo-market-card__odd-price--boosted" : ""}`}
                           >
                              {yesDb > 0 ? fmtOdd(yesDb) : "—"}
                           </span>
                        </button>
                     </div>
                  </li>
               );
            })}
         </ul>
      </section>
   );
}
