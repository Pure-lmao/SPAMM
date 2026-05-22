import { Address } from "@solana/connector";
import { address, type Rpc, type SolanaRpcApi } from "@solana/kit";
import {
   getBetsData,
   getParlaysData,
   SYSTEM_PROGRAM_ID,
   type BetAccountData,
   type BetFiller,
   type BetResult,
   type MarketId,
   type ParlayBetAccountData,
} from "spamm-aggregator-sdk";
import { type BetRecord, type Selection } from "../../../api/quickIndexer";

const apiDomain = import.meta.env.VITE_API_DOMAIN?.trim() ?? "";

const emptyFiller: BetFiller = {
   mmAddress: SYSTEM_PROGRAM_ID,
   amount: 0n,
   oddsScaled: 0n,
   isPotentiallyNetted: false,
   encumbranceDelta: 0n,
};

export type WalletParlayLeg = {
   marketId: MarketId;
   side: number;
};

export type WalletSingleRow = {
   kind: "single";
   address: string;
   data: BetAccountData;
};

export type WalletParlayRow = {
   kind: "parlay";
   address: string;
   betId: bigint;
   amount: bigint;
   payout: bigint;
   result: BetResult;
   legs: readonly WalletParlayLeg[];
   /** Present when loaded from chain (open bets); used for settle. */
   account?: ParlayBetAccountData;
};

export type WalletBetRow = WalletSingleRow | WalletParlayRow;

/** @deprecated Use {@link WalletBetRow} */
export type ClosedParlayLeg = WalletParlayLeg;
/** @deprecated Use {@link WalletSingleRow} */
export type ClosedSingleRow = WalletSingleRow;
/** @deprecated Use {@link WalletParlayRow} */
export type ClosedParlayRow = WalletParlayRow;
/** @deprecated Use {@link WalletBetRow} */
export type ClosedBetRow = WalletBetRow;

export function walletBetRowBetId(row: WalletBetRow): bigint {
   return row.kind === "single" ? row.data.betId : row.betId;
}

export function walletBetRowResult(row: WalletBetRow): BetResult {
   return row.kind === "single" ? row.data.result : row.result;
}

export function sortWalletBetRows<T extends WalletBetRow>(rows: readonly T[]): T[] {
   return [...rows].sort((a, b) => {
      const aId = walletBetRowBetId(a);
      const bId = walletBetRowBetId(b);
      return aId < bId ? 1 : aId > bId ? -1 : 0;
   });
}

export function parlayLegsFromAccount(p: ParlayBetAccountData): readonly WalletParlayLeg[] {
   return p.legs.slice(0, p.numLegs).map((leg) => ({
      marketId: leg.marketId,
      side: leg.side,
   }));
}

function toBigIntField(value: unknown, label: string): bigint {
   if (value === undefined || value === null) {
      throw new Error(`Cannot convert undefined to a BigInt (${label})`);
   }
   return BigInt(value as string | number | bigint);
}

/** API/DB may return selections as a JSON string; normalize before mapping to wallet rows. */
export function parseSelectionsField(raw: unknown): Selection[] {
   let parsed: unknown = raw;
   if (typeof parsed === "string") {
      try {
         parsed = JSON.parse(parsed);
      } catch {
         return [];
      }
   }
   if (!Array.isArray(parsed)) {
      return [];
   }
   const out: Selection[] = [];
   for (const item of parsed) {
      if (item == null || typeof item !== "object") {
         continue;
      }
      const r = item as Record<string, unknown>;
      const sport_id = Number(r.sport_id ?? r.sportId);
      const league_id = Number(r.league_id ?? r.leagueId);
      const event_id = Number(r.event_id ?? r.eventId);
      const mkt_id = Number(r.mkt_id ?? r.mktId);
      const period_id = Number(r.period_id ?? r.periodId);
      const player_id = Number(r.player_id ?? r.playerId);
      const side = Number(r.side);
      if (
         !Number.isFinite(sport_id) ||
         !Number.isFinite(league_id) ||
         !Number.isFinite(event_id) ||
         !Number.isFinite(mkt_id) ||
         !Number.isFinite(period_id) ||
         !Number.isFinite(player_id) ||
         !Number.isFinite(side)
      ) {
         continue;
      }
      const isRaw = r.is_pregame ?? r.isPregame;
      out.push({
         sport_id,
         league_id,
         event_id,
         mkt_id,
         period_id,
         player_id,
         is_pregame: isRaw === 1 || isRaw === true ? 1 : 0,
         side,
      });
   }
   return out;
}

export function normalizeBetRecordFromApi(raw: unknown): BetRecord | null {
   if (raw == null || typeof raw !== "object") {
      return null;
   }
   const r = raw as Record<string, unknown>;
   const selections = parseSelectionsField(r.selections);
   if (selections.length === 0) {
      return null;
   }
   if (r.id == null || r.bet_id == null || r.user_address == null) {
      return null;
   }
   const amount_requested = Number(r.amount_requested);
   const amount_filled = Number(r.amount_filled);
   const min_odds_requested = Number(r.min_odds_requested);
   const payout = Number(r.payout);
   const result = Number(r.result);
   if (
      !Number.isFinite(amount_requested) ||
      !Number.isFinite(amount_filled) ||
      !Number.isFinite(min_odds_requested) ||
      !Number.isFinite(payout) ||
      !Number.isFinite(result)
   ) {
      return null;
   }
   const typeRaw = r.type;
   const type: BetRecord["type"] =
      typeRaw === "parlay" || (typeRaw == null && selections.length > 1) ? "parlay" : "single";

   return {
      id: String(r.id),
      bet_id: String(r.bet_id),
      type,
      user_address: String(r.user_address),
      selections,
      amount_requested,
      amount_filled,
      min_odds_requested,
      payout,
      result: result as BetResult,
      created_at: Number(r.created_at),
      created_sig: String(r.created_sig ?? ""),
      graded_at: r.graded_at == null ? null : Number(r.graded_at),
      graded_sig: r.graded_sig == null ? null : String(r.graded_sig),
      claimed_at: r.claimed_at == null ? null : Number(r.claimed_at),
      claimed_sig: r.claimed_sig == null ? null : String(r.claimed_sig),
      last_update_slot: Number(r.last_update_slot),
      status: String(r.status) as BetRecord["status"],
   };
}

export function selectionToMarketId(sel: Selection): MarketId {
   return {
      eventId: {
         sport: sel.sport_id,
         league: sel.league_id,
         event: toBigIntField(sel.event_id, "event_id"),
      },
      player: toBigIntField(sel.player_id, "player_id"),
      mkt: sel.mkt_id,
      period: sel.period_id,
      isPregame: Boolean(sel.is_pregame),
   };
}

function closedBetRecordToSingleRow(rec: BetRecord): WalletSingleRow | null {
   if (rec.selections.length === 0) {
      return null;
   }
   const sel = rec.selections[0]!;
   const amountFilled = toBigIntField(rec.amount_filled, "amount_filled");

   return {
      kind: "single",
      address: rec.id,
      data: {
         discriminator: 0,
         bump: 0,
         owner: rec.user_address as Address,
         feepayer: rec.user_address as Address,
         betId: toBigIntField(rec.bet_id, "bet_id"),
         marketId: selectionToMarketId(sel),
         side: sel.side,
         amount: amountFilled,
         payout: toBigIntField(rec.payout, "payout"),
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

function closedBetRecordToParlayRow(rec: BetRecord): WalletParlayRow | null {
   if (rec.selections.length === 0) {
      return null;
   }
   return {
      kind: "parlay",
      address: rec.id,
      betId: toBigIntField(rec.bet_id, "bet_id"),
      amount: toBigIntField(rec.amount_filled, "amount_filled"),
      payout: toBigIntField(rec.payout, "payout"),
      result: rec.result,
      legs: rec.selections.map((sel) => ({
         marketId: selectionToMarketId(sel),
         side: sel.side,
      })),
   };
}

export function closedBetRecordToRow(rec: BetRecord): WalletBetRow | null {
   if (rec.type === "parlay") {
      return closedBetRecordToParlayRow(rec);
   }
   return closedBetRecordToSingleRow(rec);
}

/** Open singles + parlays for a wallet from chain. */
export async function fetchOpenWalletBets(
   rpc: Rpc<SolanaRpcApi>,
   userAddress: string,
): Promise<readonly WalletBetRow[]> {
   const user = address(userAddress);
   const [singles, parlays] = await Promise.all([getBetsData(rpc, { user }), getParlaysData(rpc, { user })]);
   const rows: WalletBetRow[] = [
      ...singles.map((r) => ({
         kind: "single" as const,
         address: String(r.address),
         data: r.data,
      })),
      ...parlays.map((r) => ({
         kind: "parlay" as const,
         address: String(r.address),
         betId: r.data.betId,
         amount: r.data.amount,
         payout: r.data.payout,
         result: r.data.result,
         legs: parlayLegsFromAccount(r.data),
         account: r.data,
      })),
   ];
   return sortWalletBetRows(rows);
}

/** Claimed bets for a wallet (`/api/betHistory?user=`). */
export async function fetchClosedBetHistory(userAddress: string): Promise<readonly WalletBetRow[]> {
   const q = new URLSearchParams({ user: userAddress });
   const res = await fetch(`${apiDomain}/api/betHistory?${q.toString()}`);
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const raw = await res.json();
   if (!Array.isArray(raw)) {
      throw new Error("Expected array from /api/betHistory");
   }
   const records = raw.map(normalizeBetRecordFromApi).filter((rec): rec is BetRecord => rec !== null);
   return sortWalletBetRows(records.map(closedBetRecordToRow).filter((row): row is WalletBetRow => row !== null));
}
