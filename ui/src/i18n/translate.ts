import { calendarFor, leaguesFor, readMessage, sportsFor, type Calendar } from "./languages";
import type { Messages } from "./languages";

type Join<A extends string, B extends string> = A extends "" ? B : `${A}.${B}`;

type Leaves<T, P extends string = ""> = T extends string
   ? P
   : T extends object
     ? { [K in keyof T & string]: Leaves<T[K], Join<P, K>> }[keyof T & string]
     : never;

export type MessageKey = Leaves<Messages>;

export type TranslateVars = Record<string, string | number>;

export type Translate = (key: MessageKey, vars?: TranslateVars) => string;

export function translate(language: string, key: MessageKey, vars?: TranslateVars): string {
   const raw = readMessage(language, key.split(".")) ?? key;
   if (vars == null) {
      return raw;
   }
   return raw.replace(/\{(\w+)\}/g, (token, name: string) => {
      const value = vars[name];
      return value == null ? token : String(value);
   });
}

export function sportName(language: string, sportId: number, fallback: string): string {
   return sportsFor(language)[String(sportId)] ?? fallback;
}

export function leagueName(language: string, apiName: string): string {
   const trimmed = apiName.trim();
   if (trimmed === "") {
      return apiName;
   }
   return leaguesFor(language)[trimmed] ?? trimmed;
}

/** Weekday and month come from the language pack. The clock stays in the browser's local format. */
export function formatEventStart(ts: number, calendar: Calendar): string {
   const d = new Date(ts);
   const weekday = calendar.weekdays[d.getDay()] ?? "";
   const month = calendar.months[d.getMonth()] ?? "";
   const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
   return `${weekday}, ${month} ${d.getDate()}, ${time}`;
}

export function formatBetTime(ts: number, calendar: Calendar): string {
   if (!Number.isFinite(ts) || ts <= 0) {
      return "";
   }
   const ms = ts < 1e12 ? ts * 1000 : ts;
   const d = new Date(ms);
   const month = calendar.months[d.getMonth()] ?? "";
   const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
   return `${month} ${d.getDate()}, ${time}`;
}

const EXACT_SLIP_REASONS: Record<string, MessageKey> = {
   "Enter a valid stake amount.": "slip.enterStake",
   "No MM returned a quote (wrong cluster, missing market, or amount too large).": "slip.noQuote",
   "No allowed MM quoted": "slip.noAllowedMm",
   "No MM returned a parlay quote for these legs.": "slip.noParlayQuote",
   "Connect a wallet to request offchain quotes.": "slip.connectForRfq",
   "No RFQ market makers connected": "slip.noRfqMms",
   "No RFQ quote for this stake": "slip.noRfqQuote",
   "Connect a wallet to place a bet.": "slip.connectToBet",
   "Wallet signer not ready.": "slip.signerNotReady",
   "Invalid amount.": "slip.invalidAmount",
   "Freebet cannot be used on this slip.": "slip.freebetBlocked",
   "Freebet stake must match the voucher amount.": "slip.freebetStake",
   "Boost cannot be used on this slip.": "slip.boostBlocked",
   "Stake is above the boost maximum.": "slip.boostStake",
   "Min. odds must be above 1.00 (scaled > ODDS_SCALE).": "slip.minOddsFloor",
   "No parlay quote available. Wait for quotes or adjust stake.": "slip.waitParlayQuote",
   "No MM routes from quotes. Wait for quotes or reduce amount.": "slip.noMmRoutes",
   "Select an offchain quote to accept.": "slip.selectOffchain",
   "Stake changed — request offchain quotes again.": "slip.stakeChanged",
   "Operator not allowed": "slip.operatorNotAllowed",
   Expired: "slip.expired",
};

/** Maps English slip/freebet sentences onto the catalog. Unknown text is returned as-is. */
export function translateKnownSlipReason(text: string, t: Translate): string {
   const exact = EXACT_SLIP_REASONS[text];
   if (exact != null) {
      return t(exact);
   }
   const needs = /^Needs (\d+)\+ legs$/.exec(text);
   if (needs != null) {
      return t("slip.needsLegs", { count: needs[1]! });
   }
   const higher = /^Odds must be higher than (.+)$/.exec(text);
   if (higher != null) {
      return t("slip.oddsHigher", { odds: higher[1]! });
   }
   const lower = /^Odds must be lower than (.+)$/.exec(text);
   if (lower != null) {
      return t("slip.oddsLower", { odds: lower[1]! });
   }
   const between = /^Odds must be between (.+) and (.+)$/.exec(text);
   if (between != null) {
      return t("slip.oddsBetween", { min: between[1]!, max: between[2]! });
   }
   const expires = /^Expires in (\d+)s$/.exec(text);
   if (expires != null) {
      return t("slip.expiresIn", { seconds: expires[1]! });
   }
   return text;
}

export function calendarOf(language: string): Calendar {
   return calendarFor(language);
}
