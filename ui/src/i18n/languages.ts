import { enCalendar, enLeagues, enMessages, enSports } from "./en";

/**
 * Add a language:
 * 1. Add its id to `LanguageId`.
 * 2. Add `{ id, label }` to `LANGUAGE_OPTIONS` (the label is that language's own name).
 * 3. Add a `LanguagePack` below. Omit any field to keep the English string.
 *    `sports` is keyed by sport id. `leagues` is keyed by the API league name.
 */
export type LanguageId = "en" | "american";

export const LANGUAGE_OPTIONS: readonly { id: LanguageId; label: string }[] = [
   { id: "en", label: "English" },
   { id: "american", label: "American" },
];

export function isLanguageId(value: string): value is LanguageId {
   return LANGUAGE_OPTIONS.some((opt) => opt.id === value);
}

type DeepPartial<T> = T extends string
   ? string
   : T extends readonly (infer U)[]
     ? readonly U[]
     : T extends object
       ? { [K in keyof T]?: DeepPartial<T[K]> }
       : T;

export type Messages = typeof enMessages;
export type Calendar = typeof enCalendar;

export type LanguagePack = {
   messages?: DeepPartial<Messages>;
   sports?: Record<string, string>;
   leagues?: Record<string, string>;
   calendar?: {
      weekdays?: readonly string[];
      months?: readonly string[];
   };
};

const american: LanguagePack = {
   sports: {
      "1": "Soccer",
      "2": "Football",
   },
};

export const languagePacks: Partial<Record<LanguageId, LanguagePack>> = {
   american,
};

export function sportsFor(language: string): Record<string, string> {
   return { ...enSports, ...pack(language)?.sports };
}

export function leaguesFor(language: string): Record<string, string> {
   return { ...enLeagues, ...pack(language)?.leagues };
}

export function calendarFor(language: string): Calendar {
   const overlay = pack(language)?.calendar;
   const weekdays = overlay?.weekdays?.length === 7 ? overlay.weekdays : enCalendar.weekdays;
   const months = overlay?.months?.length === 12 ? overlay.months : enCalendar.months;
   return { weekdays: [...weekdays], months: [...months] };
}

function pack(language: string): LanguagePack | undefined {
   if (!isLanguageId(language) || language === "en") {
      return undefined;
   }
   return languagePacks[language];
}

export function readMessage(language: string, path: readonly string[]): string | undefined {
   const overlay = pack(language)?.messages;
   const fromOverlay = overlay == null ? undefined : dig(overlay, path);
   if (typeof fromOverlay === "string") {
      return fromOverlay;
   }
   const fromEn = dig(enMessages, path);
   return typeof fromEn === "string" ? fromEn : undefined;
}

function dig(root: object, path: readonly string[]): unknown {
   let cur: unknown = root;
   for (const key of path) {
      if (cur == null || typeof cur !== "object" || !(key in cur)) {
         return undefined;
      }
      cur = (cur as Record<string, unknown>)[key];
   }
   return cur;
}
