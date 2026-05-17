import { Sport, getEventGameState } from "spamm-aggregator-sdk";

export const EVENT_GAME_STATE_PG = getEventGameState("PG", 0, 0, 0, 0);

export const DEFAULT_EVENT_STATE_SEQUENCE = 1;

export function apiSportToSdk(sportId: number): Sport {
   return sportId as Sport;
}

export function buildMarketId(
   eventId: number,
   leagueId: number,
   sport: Sport,
   mktWireId: number,
   period: number,
) {
   return {
      eventId: { event: BigInt(eventId), league: leagueId, sport },
      mkt: mktWireId,
      period,
      isPregame: true,
      player: 0n,
   };
}
