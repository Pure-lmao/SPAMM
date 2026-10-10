import { useMemo } from "react";
import { useI18n } from "../i18n/useI18n";

/** Column labels for the home list and event markets. */
export function useOddsTableLabels(): {
   home: string;
   draw: string;
   away: string;
   over: string;
   under: string;
   yes: string;
   no: string;
   line: string;
   player: string;
   side1: string;
   side2: string;
   main1x2: string;
   mainMl: string;
   spread: string;
   total: string;
   teamsAndStart: string;
} {
   const { t } = useI18n();
   return useMemo(
      () => ({
         home: t("markets.home"),
         draw: t("markets.draw"),
         away: t("markets.away"),
         over: t("markets.over"),
         under: t("markets.under"),
         yes: t("markets.yes"),
         no: t("markets.no"),
         line: t("markets.line"),
         player: t("markets.player"),
         side1: t("markets.side1"),
         side2: t("markets.side2"),
         main1x2: t("markets.main1x2"),
         mainMl: t("markets.mainMl"),
         spread: t("markets.spread"),
         total: t("markets.total"),
         teamsAndStart: t("markets.teamsAndStart"),
      }),
      [t],
   );
}
