import { Address } from "@solana/connector";
import { SYSTEM_PROGRAM_ID, type BetAccountData, type BetFiller } from "spamm-aggregator-sdk";
import { type BetRecord } from "../../../api/quickIndexer";

const apiDomain = import.meta.env.VITE_API_DOMAIN?.trim() ?? "";

const emptyFiller: BetFiller = {
   mmAddress: SYSTEM_PROGRAM_ID,
   amount: 0n,
   oddsScaled: 0n,
   isPotentiallyNetted: false,
   encumbranceDelta: 0n,
};

export function closedBetRecordToBetRow(rec: BetRecord): { address: string; data: BetAccountData } {
   const amountFilled = BigInt(rec.amount_filled);

   return {
      address: rec.id,
      data: {
         discriminator: 0,
         bump: 0,
         owner: rec.user_address as Address,
         feepayer: rec.user_address as Address,
         betId: BigInt(rec.bet_id),
         marketId: {
            eventId: {
               sport: rec.sport_id,
               league: rec.league_id,
               event: BigInt(rec.event_id),
            },
            player: BigInt(rec.player_id),
            mkt: rec.mkt_id,
            period: rec.period_id,
            isPregame: Boolean(rec.is_pregame),
         },
         side: rec.side,
         amount: amountFilled,
         payout: BigInt(rec.payout),
         eventStateSequence: 0,
         eventGameState: {
            gamePhase: "",
            homePrimary: 0,
            awayPrimary: 0,
            homeSecondary: 0,
            awaySecondary: 0,
         },
         result: rec.result,
         filler0: emptyFiller,
         filler1: emptyFiller,
         filler2: emptyFiller,
         filler3: emptyFiller,
         filler4: emptyFiller,
      },
   };
}

/** Claimed bets for a wallet (`/api/betHistory?user=`). */
export async function fetchClosedBetHistory(userAddress: string): Promise<readonly { address: string; data: BetAccountData }[]> {
   const q = new URLSearchParams({ user: userAddress });
   const res = await fetch(`${apiDomain}/api/betHistory?${q.toString()}`);
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const raw = (await res.json()) as BetRecord[];
   if (!Array.isArray(raw)) {
      throw new Error("Expected array from /api/betHistory");
   }
   return raw.map(closedBetRecordToBetRow);
}
