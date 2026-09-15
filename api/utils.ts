import type { ParlayLegWire } from "../aggregator/sdk/ts/src/types";
import { BetResult } from "../aggregator/sdk/ts/src/types";
import type { Selection } from "./quickIndexer";
import type { Address } from "@solana/kit";



/** Safe JSON stringify: handles BigInt, Map, Set, circular refs, Error, functions. */
export function safeJSONStringify(json: unknown, space?: number): string {
   try {
      return JSON.stringify(json, function replacer(_key: string, v: unknown): unknown {
         if (typeof v === "bigint") return v.toString();
         if (typeof v === "function") return `[Function${v.name ? `: ${v.name}` : ""}]`;
         if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
         if (v instanceof Map) {
            return Object.fromEntries([...v.entries()].map(([k, val]) => [String(k), replacer(k, val)]));
         }
         if (v instanceof Set) {
            return [...v].map((item, i) => replacer(String(i), item));
         }
         return v;
      }, space ?? 0);
   } catch (_e) {
      return '"unstringifiable"';
   }
}

export function round(value: number, precision: number): number {
   return Math.round(value * Math.pow(10, precision)) / Math.pow(10, precision);
}

export function foldParlayResult(selections: Selection[]): BetResult {
   let anyLost = false;
   let anyModified = false;
   let anyPending = false;
   let allWon = true;
   let allVoid = true;
   let allRolledBack = true;
   for (const selection of selections) {
      if (selection.result === BetResult.Lost) {
         anyLost = true;
         allWon = false;
         allVoid = false;
         allRolledBack = false;
      }
      if (selection.result === BetResult.Won) {
         allVoid = false;
         allRolledBack = false;
      }
      if (selection.result === BetResult.HalfWon) {
         anyModified = true;
         allWon = false;
         allVoid = false;
         allRolledBack = false;
      }
      if (selection.result === BetResult.HalfLost) {
         anyModified = true;
         allWon = false;
         allVoid = false;
         allRolledBack = false;
      }
      if (selection.result === BetResult.Push) {
         anyModified = true;
         allWon = false;
         allRolledBack = false;
      }
      if (selection.result === BetResult.Cancelled) {
         anyModified = true;
         allWon = false;
         allRolledBack = false;
      }
      if (selection.result === BetResult.RolledBack) {
         anyModified = true;
         allWon = false;
      }
      if (selection.result === BetResult.ModifiedWin) {
         anyModified = true;
         allWon = false;
      }
      if (selection.result === BetResult.CashedOut) {
         anyModified = true;
         allWon = false;
      }
      if (selection.result === BetResult.Pending || selection.result == null) {
         anyPending = true;
         allWon = false;
         allVoid = false;
         allRolledBack = false;
      }
   }

   if (anyLost) {
      return BetResult.Lost;
   }
   if (allVoid) {
      if (allRolledBack) {
         return BetResult.RolledBack;
      }
      return BetResult.Cancelled;
   }
   if (allWon) {
      return BetResult.Won;
   }
   if (anyPending) {
      return BetResult.Pending;
   }
   if (anyModified) {
      return BetResult.ModifiedWin;
   }
   return BetResult.Pending;
}

export const DEFAULT_MARKET_OPERATOR = "BqQKZKbnYMpmQEtoCjvaDVTdhfpbaCQuBiSngNKu6YQW" as Address;