import { address, type Address } from "@solana/kit";
import {
   displayColumnToChainSide,
   sideLabel,
   type MarketDisplayCtx,
   type MarketId,
   type ParlayLegSel,
} from "spamm-aggregator-sdk";
import { DEFAULT_EVENT_STATE_SEQUENCE, EVENT_GAME_STATE_PG } from "../chain/ids";
import { formatOddsNumber, type OddsFormat } from "../usdc";
import type { UiEvent, UiMarket } from "./types";

export type BetColumn = "main" | "spread" | "total";

export type Leg = {
   id: string;
   eventTitle: string;
   marketLabel: string;
   outcomeLabel: string;
   displayedDecimalOdds: number | null;
   eventId: number;
   leagueId: number;
   sportApiId: number;
   marketWireId: number;
   periodId: number;
   playerId: number;
   playerName: string;
   operator: string;
   mint: string;
   column: BetColumn;
   outcomeIndex: number;
   mktString: string;
};

export function marketKey(leg: Pick<Leg, "eventId" | "marketWireId" | "periodId" | "playerId">): string {
   return `${leg.eventId}:${leg.marketWireId}:${leg.periodId}:${leg.playerId}`;
}

export function legId(leg: Pick<Leg, "eventId" | "marketWireId" | "periodId" | "playerId" | "outcomeIndex">): string {
   return `${marketKey(leg)}:${leg.outcomeIndex}`;
}

export function displayCtx(market: UiMarket, event: UiEvent): MarketDisplayCtx {
   return {
      sport: market.sport_id,
      homeName: event.home_name,
      awayName: event.away_name,
      playerId: market.player_id,
      playerName: market.player_name,
      period: market.period_id,
      lineValue: market.line_value,
      mktString: market.mkt_string,
   };
}

export function columnFor(market: UiMarket): BetColumn {
   const family = market.mkt_string;
   if (family.startsWith("AH ") || family === "AH") {
      return "spread";
   }
   if (family.startsWith("OU ") || family === "OU") {
      return "total";
   }
   return "main";
}

export function chainSide(leg: Pick<Leg, "column" | "mktString" | "outcomeIndex" | "marketWireId">): number {
   const mkt = leg.marketWireId || (leg.mktString === "1X2" ? 1 : 0);
   if (leg.column === "main" && (leg.mktString === "1X2" || mkt === 1)) {
      return displayColumnToChainSide(1, leg.outcomeIndex);
   }
   return displayColumnToChainSide(mkt, leg.outcomeIndex);
}

export function buildMarketId(leg: Leg): MarketId {
   return {
      eventId: { event: BigInt(leg.eventId), league: leg.leagueId, sport: leg.sportApiId as MarketId["eventId"]["sport"] },
      mkt: leg.marketWireId,
      period: leg.periodId,
      isPregame: true,
      player: BigInt(leg.playerId),
      operator: address(leg.operator),
      mint: address(leg.mint),
   };
}

export function parlayLeg(leg: Leg): ParlayLegSel {
   return {
      marketId: buildMarketId(leg),
      side: chainSide(leg),
      eventStateSequence: DEFAULT_EVENT_STATE_SEQUENCE,
      eventGameState: EVENT_GAME_STATE_PG,
   };
}

export function makeLeg(event: UiEvent, market: UiMarket, outcomeIndex: number, dbOdds: number, column: BetColumn): Leg {
   const ctx = displayCtx(market, event);
   const decimal = dbOdds === 0 ? null : Math.round((dbOdds / 10000) * 100) / 100;
   const outcome = sideLabel(market.id, chainSide({
      column,
      mktString: market.mkt_string,
      outcomeIndex,
      marketWireId: market.id,
   }), ctx);
   const leg: Leg = {
      id: "",
      eventTitle: `${event.home_name} vs ${event.away_name}`,
      marketLabel: market.mkt_string,
      outcomeLabel: outcome,
      displayedDecimalOdds: decimal != null && decimal > 0 ? decimal : null,
      eventId: event.id,
      leagueId: event.league_id,
      sportApiId: event.sport_id,
      marketWireId: market.id,
      periodId: market.period_id,
      playerId: market.player_id ?? 0,
      playerName: market.player_name ?? "",
      operator: market.operator,
      mint: market.mint,
      column,
      outcomeIndex,
      mktString: market.mkt_string,
   };
   leg.id = legId(leg);
   return leg;
}

export function legSummary(leg: Leg, format: OddsFormat = "decimal"): string {
   const price = leg.displayedDecimalOdds == null ? "" : ` | ${formatOddsNumber(leg.displayedDecimalOdds, format)}`;
   return `${leg.eventTitle}\n${leg.outcomeLabel}${price}`;
}

export function sameMarket(a: Leg, b: Leg): boolean {
   return marketKey(a) === marketKey(b);
}

export function operatorAddress(leg: Leg): Address {
   return address(leg.operator);
}
