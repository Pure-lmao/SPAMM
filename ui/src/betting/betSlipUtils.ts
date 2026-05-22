import { ODDS_SCALE, type MarketId, type ParlayLegWire } from "spamm-aggregator-sdk";
import { apiSportToSdk, buildMarketId, DEFAULT_EVENT_STATE_SEQUENCE, EVENT_GAME_STATE_PG } from "./chainIds";
import { pickBetSide } from "./outcomeSide";
import type { BetSlipSelection } from "./types";

export function marketKey(sel: Pick<BetSlipSelection, "eventId" | "marketWireId" | "periodId">): string {
   return `${sel.eventId}:${sel.marketWireId}:${sel.periodId}`;
}

export function selectionId(
   sel: Pick<BetSlipSelection, "eventId" | "marketWireId" | "periodId" | "column" | "outcomeIndex">,
): string {
   return `${marketKey(sel)}:${sel.column}:${sel.outcomeIndex}`;
}

export function selectionMatches(
   a: Pick<BetSlipSelection, "eventId" | "marketWireId" | "periodId" | "column" | "outcomeIndex">,
   b: Pick<BetSlipSelection, "eventId" | "marketWireId" | "periodId" | "column" | "outcomeIndex">,
): boolean {
   return selectionId(a) === selectionId(b);
}

export function parseMinOddsScaled(raw: string, fallback: bigint): bigint {
   const t = raw.trim();
   if (!t) {
      return fallback;
   }
   const n = Number(t);
   if (!Number.isFinite(n) || n <= 0) {
      return fallback;
   }
   return BigInt(Math.round(n * Number(ODDS_SCALE)));
}

export function oddsDecimalLabel(scaled: bigint): string {
   const x = Number(scaled) / Number(ODDS_SCALE);
   if (!Number.isFinite(x)) {
      return "—";
   }
   return x >= 10 ? x.toFixed(2) : x.toFixed(3);
}

/** Matches on-chain `calc_potential_payout`. */
export function calcPotentialPayoutBase(amount: bigint, oddsScaled: bigint): bigint | null {
   if (amount <= 0n || oddsScaled <= 0n) {
      return null;
   }
   return (oddsScaled * amount) / ODDS_SCALE;
}

export function buildMarketIdForSelection(sel: BetSlipSelection): MarketId {
   const sport = apiSportToSdk(sel.sportApiId);
   return buildMarketId(sel.eventId, sel.leagueId, sport, sel.marketWireId, sel.periodId);
}

export function parlayLegFromSelection(sel: BetSlipSelection): ParlayLegWire {
   return {
      marketId: buildMarketIdForSelection(sel),
      side: pickBetSide(sel.column, sel.mktString, sel.outcomeIndex),
      eventStateSequence: DEFAULT_EVENT_STATE_SEQUENCE,
      eventGameState: EVENT_GAME_STATE_PG,
   };
}

export function solscanTxUrl(signature: string): string {
   return `https://solscan.io/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}
