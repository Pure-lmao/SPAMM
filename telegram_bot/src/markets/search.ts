import { NICKNAMES } from "./nicknames";
import type { UiEvent, UiSport } from "./types";

export type SearchHit = {
   sportId: number;
   leagueId: number;
   eventId: number;
   sportName: string;
   label: string;
   score: number;
};

const NICKNAME_SCORE = 1000;
const CONTAINS_SCORE = 800;
const MASCOT_SCORE = 700;
const CITY_SCORE = 600;
const CITY_TOKEN_SCORE = 500;
const TOKEN_SCORE = 300;
const FUZZY_SCORE = 200;

export function normalizeQuery(raw: string): string {
   return raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
}

function tokensOf(name: string): string[] {
   const n = normalizeQuery(name);
   return n === "" ? [] : n.split(" ");
}

function editDistance(a: string, b: string): number {
   if (a === b) {
      return 0;
   }
   if (Math.abs(a.length - b.length) > 1) {
      return 2;
   }
   const prev = new Array<number>(b.length + 1);
   const cur = new Array<number>(b.length + 1);
   for (let j = 0; j <= b.length; j++) {
      prev[j] = j;
   }
   for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
         const cost = a[i - 1] === b[j - 1] ? 0 : 1;
         cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      }
      for (let j = 0; j <= b.length; j++) {
         prev[j] = cur[j]!;
      }
   }
   return prev[b.length] ?? 2;
}

function scoreName(name: string, query: string, expansions: readonly string[]): number {
   const norm = normalizeQuery(name);
   if (norm === "" || query === "") {
      return 0;
   }
   for (const fragment of expansions) {
      const target = normalizeQuery(fragment);
      if (target !== "" && norm.includes(target)) {
         return NICKNAME_SCORE;
      }
   }
   if (query.length >= 3 && norm.includes(query)) {
      return CONTAINS_SCORE;
   }
   const tokens = tokensOf(name);
   if (tokens.length === 0) {
      return 0;
   }
   const trailing = tokens.slice(1).join(" ");
   const last = tokens[tokens.length - 1] ?? "";
   const lastTwo = tokens.length >= 2 ? tokens.slice(-2).join(" ") : "";
   if (query === trailing || query === last || (lastTwo !== last && query === lastTwo)) {
      return MASCOT_SCORE;
   }
   if (norm === query || norm.startsWith(`${query} `)) {
      return CITY_SCORE;
   }
   if (tokens.length > 1 && tokens[0] === query) {
      return CITY_TOKEN_SCORE;
   }
   for (const token of tokens) {
      if (token.startsWith(query) && query.length >= 3) {
         return TOKEN_SCORE;
      }
   }
   if (query.length >= 4) {
      for (const token of tokens) {
         if (token.length >= 4 && editDistance(token, query) <= 1) {
            return FUZZY_SCORE;
         }
      }
   }
   return 0;
}

export function searchEvents(tree: readonly UiSport[], rawQuery: string): SearchHit[] {
   const query = normalizeQuery(rawQuery);
   if (query === "") {
      return [];
   }
   const expansions = NICKNAMES[query] ?? [];
   const hits: SearchHit[] = [];
   for (const sport of tree) {
      for (const league of sport.leagues) {
         for (const ev of league.events) {
            const home = scoreName(ev.home_name, query, expansions);
            const away = scoreName(ev.away_name, query, expansions);
            const score = Math.max(home, away);
            if (score <= 0) {
               continue;
            }
            hits.push({
               sportId: sport.id,
               leagueId: league.id,
               eventId: ev.id,
               sportName: sport.name,
               label: matchLabel(ev),
               score,
            });
         }
      }
   }
   hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
   if (hits.length === 0) {
      return [];
   }
   const top = hits[0]!.score;
   if (top >= NICKNAME_SCORE) {
      return hits.filter((hit) => hit.score >= NICKNAME_SCORE);
   }
   if (top >= CITY_TOKEN_SCORE) {
      return hits.filter((hit) => hit.score >= CITY_TOKEN_SCORE);
   }
   return hits.slice(0, 8);
}

export function matchLabel(ev: Pick<UiEvent, "away_name" | "home_name" | "start_time">): string {
   const when = formatStart(ev.start_time);
   const names = `${ev.home_name} vs ${ev.away_name}`;
   return when === "" ? names : `${names} · ${when}`;
}

export function formatStart(start: number): string {
   if (!Number.isFinite(start) || start <= 0) {
      return "";
   }
   const ms = start > 1_000_000_000_000 ? start : start * 1000;
   const date = new Date(ms);
   if (Number.isNaN(date.getTime())) {
      return "";
   }
   return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
   });
}
