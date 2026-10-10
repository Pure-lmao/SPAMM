import { useMemo } from "react";
import { useSettings } from "../settings/SettingsContext";
import { calendarFor } from "./languages";
import {
   formatBetTime,
   formatEventStart,
   leagueName,
   sportName,
   translate,
   translateKnownSlipReason,
   type Translate,
   type TranslateVars,
   type MessageKey,
} from "./translate";

export function useI18n(): {
   t: Translate;
   sportName: (sportId: number, fallback: string) => string;
   leagueName: (apiName: string) => string;
   formatStart: (ts: number) => string;
   formatBetTime: (ts: number) => string;
   slipReason: (text: string) => string;
} {
   const { language } = useSettings();
   return useMemo(() => {
      const t: Translate = (key: MessageKey, vars?: TranslateVars) => translate(language, key, vars);
      const calendar = calendarFor(language);
      return {
         t,
         sportName: (sportId, fallback) => sportName(language, sportId, fallback),
         leagueName: (apiName) => leagueName(language, apiName),
         formatStart: (ts) => formatEventStart(ts, calendar),
         formatBetTime: (ts) => formatBetTime(ts, calendar),
         slipReason: (text) => translateKnownSlipReason(text, t),
      };
   }, [language]);
}
