import { address, type Address } from "@solana/kit";
import { Sport, getEventGameState } from "spamm-aggregator-sdk";

/** Funded pubkey — required as tx fee payer for read-only ix simulations. */
export const SIM_FEE_PAYER_ADDRESS = address("BqQKZKbnYMpmQEtoCjvaDVTdhfpbaCQuBiSngNKu6YQW");

/** Market operator embedded in `MarketId` (grading authority for dev). */
export const DEFAULT_MARKET_OPERATOR = SIM_FEE_PAYER_ADDRESS;

export const EVENT_GAME_STATE_PG = getEventGameState("PG", 0, 0, 0, 0);

export const DEFAULT_EVENT_STATE_SEQUENCE = 1;

export function apiSportToSdk(sportId: number): Sport {
   return sportId as Sport;
}

export function parseOperatorAddress(raw: string | undefined | null): Address {
   const t = raw?.trim() ?? "";
   if (t === "") {
      return DEFAULT_MARKET_OPERATOR;
   }
   try {
      return address(t);
   } catch {
      return DEFAULT_MARKET_OPERATOR;
   }
}

export function buildMarketId(
   eventId: number,
   leagueId: number,
   sport: Sport,
   mktWireId: number,
   period: number,
   player: bigint = 0n,
   operator: Address = DEFAULT_MARKET_OPERATOR,
) {
   return {
      eventId: { event: BigInt(eventId), league: leagueId, sport },
      mkt: mktWireId,
      period,
      isPregame: true,
      player,
      operator,
   };
}
