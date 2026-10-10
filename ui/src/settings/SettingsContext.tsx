import {
   createContext,
   useCallback,
   useContext,
   useMemo,
   useState,
   type ReactElement,
   type ReactNode,
} from "react";
import { isLanguageId, LANGUAGE_OPTIONS } from "../i18n/languages";
import { formatDbOdds } from "../markets/oddsFormat";
import { isOddsFormat, type OddsFormat } from "./convertOdds";

export { LANGUAGE_OPTIONS };

const STORAGE_KEY = "spamm-ui-settings";

type SettingsState = {
   language: string;
   oddsFormat: OddsFormat;
};

type SettingsContextValue = SettingsState & {
   setLanguage: (language: string) => void;
   setOddsFormat: (format: OddsFormat) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readStored(): SettingsState {
   const fallback: SettingsState = { language: "en", oddsFormat: "decimal" };
   try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw == null) {
         return fallback;
      }
      const parsed = JSON.parse(raw) as { language?: unknown; oddsFormat?: unknown };
      const language =
         typeof parsed.language === "string" && isLanguageId(parsed.language)
            ? parsed.language
            : fallback.language;
      const oddsFormat =
         typeof parsed.oddsFormat === "string" && isOddsFormat(parsed.oddsFormat)
            ? parsed.oddsFormat
            : fallback.oddsFormat;
      return { language, oddsFormat };
   } catch {
      return fallback;
   }
}

export function SettingsProvider({ children }: { children: ReactNode }): ReactElement {
   const [state, setState] = useState<SettingsState>(readStored);

   const write = useCallback((next: SettingsState) => {
      try {
         localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
         /* ignore quota / private mode */
      }
      return next;
   }, []);

   const setLanguage = useCallback(
      (language: string) => {
         if (!isLanguageId(language)) {
            return;
         }
         setState((prev) => write({ ...prev, language }));
      },
      [write],
   );

   const setOddsFormat = useCallback(
      (oddsFormat: OddsFormat) => {
         setState((prev) => write({ ...prev, oddsFormat }));
      },
      [write],
   );

   const value = useMemo(
      () => ({
         language: state.language,
         oddsFormat: state.oddsFormat,
         setLanguage,
         setOddsFormat,
      }),
      [setLanguage, setOddsFormat, state.language, state.oddsFormat],
   );

   return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
   const ctx = useContext(SettingsContext);
   if (ctx == null) {
      throw new Error("useSettings must be used within SettingsProvider");
   }
   return ctx;
}

export function useFormatDbOdd(): (dbValue: number) => string {
   const { oddsFormat } = useSettings();
   return (dbValue: number) => formatDbOdds(dbValue, oddsFormat);
}
