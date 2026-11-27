import { address, type Address } from "@solana/kit";
import {
   BetResult,
   PROMO_BOOST,
   PROMO_FREEBET,
   PromoState,
   getBetsData,
   getBoostsData,
   getFreebetsData,
   getParlaysData,
   getSettleBetIx,
   getSettleBoostedBetIx,
   getSettleBoostedParlayIx,
   getSettleFreebetIx,
   getSettleFreebetParlayIx,
   getSettleParlayIx,
   sideLabel,
   type BetAccountData,
   type MarketId,
   type ParlayBetAccountData,
} from "spamm-aggregator-sdk";
import { HISTORY_PAGE, HISTORY_TTL_MS, LABELS_TTL_MS, SETTLE_BATCH } from "../constants";
import { ttlMap } from "../cache";
import { rpc } from "../chain/rpc";
import { LABS_DOMAIN } from "../network";
import { formatDollars, formatOdds, type OddsFormat } from "../usdc";
import { sendInstructions } from "../wallet/send";
import { feePayerFor } from "../wallet/solFree";
import type { BotWallet } from "../wallet/privy";

export type WalletBetRow =
   | { kind: "single"; address: string; data: BetAccountData; issuerAuth?: Address }
   | {
      kind: "parlay";
      address: string;
      account: ParlayBetAccountData;
      issuerAuth?: Address;
   };

const labels = ttlMap<{ home: string; away: string }>(LABELS_TTL_MS);
const historyCache = ttlMap<{ rows: HistoryRow[]; next: string | null }>(HISTORY_TTL_MS);

export function rowResult(row: WalletBetRow): BetResult {
   return row.kind === "single" ? row.data.result : row.account.result;
}

export function rowAmount(row: WalletBetRow): bigint {
   return row.kind === "single" ? row.data.amount : row.account.amount;
}

export function rowPayout(row: WalletBetRow): bigint {
   return row.kind === "single" ? row.data.payout : row.account.payout;
}

function promoAccount(row: WalletBetRow, promoType: number): Address | null {
   if (row.kind === "single") {
      return row.data.promoType === promoType ? row.data.promoAccount : null;
   }
   return row.account.promoType === promoType ? row.account.promoAccount : null;
}

async function issuers(user: Address, rows: WalletBetRow[]): Promise<WalletBetRow[]> {
   const freebets = rows.flatMap((row) => {
      const acct = promoAccount(row, PROMO_FREEBET);
      return acct == null ? [] : [acct];
   });
   const boosts = rows.flatMap((row) => {
      const acct = promoAccount(row, PROMO_BOOST);
      return acct == null ? [] : [acct];
   });
   const [freebetRows, boostRows] = await Promise.all([
      freebets.length === 0 ? Promise.resolve([]) : getFreebetsData(rpc, { user, state: PromoState.Used }),
      boosts.length === 0 ? Promise.resolve([]) : getBoostsData(rpc, { user, state: PromoState.Used }),
   ]);
   const map = new Map<string, Address>();
   for (const row of freebetRows) {
      map.set(String(row.address), row.data.issuerAuth);
   }
   for (const row of boostRows) {
      map.set(String(row.address), row.data.issuerAuth);
   }
   return rows.map((row) => {
      const acct = promoAccount(row, PROMO_FREEBET) ?? promoAccount(row, PROMO_BOOST);
      const issuer = acct == null ? undefined : map.get(String(acct));
      return issuer == null ? row : { ...row, issuerAuth: issuer };
   });
}

export async function fetchOpenBets(user: Address): Promise<WalletBetRow[]> {
   const [singles, parlays] = await Promise.all([
      getBetsData(rpc, { user }),
      getParlaysData(rpc, { user }),
   ]);
   const rows: WalletBetRow[] = [
      ...singles.map((row) => ({ kind: "single" as const, address: String(row.address), data: row.data })),
      ...parlays.map((row) => ({ kind: "parlay" as const, address: String(row.address), account: row.data })),
   ];
   rows.sort((a, b) => {
      const at = a.kind === "single" ? a.data.timestamp : a.account.timestamp;
      const bt = b.kind === "single" ? b.data.timestamp : b.account.timestamp;
      return bt - at;
   });
   return issuers(user, rows);
}

async function eventTeams(operator: string, sport: number, league: number, event: bigint): Promise<{ home: string; away: string }> {
   const key = `${operator}|${sport}|${league}|${event}`;
   return labels.get(key, async () => {
      const q = new URLSearchParams({
         operator,
         ids: `${sport}|${league}|${event}`,
      });
      const res = await fetch(`${LABS_DOMAIN}/api/events?${q}`);
      if (!res.ok) {
         return { home: "", away: "" };
      }
      const body = (await res.json()) as { events?: Array<Record<string, unknown>> };
      const row = body.events?.[0];
      return {
         home: typeof row?.home_name === "string" ? row.home_name : "",
         away: typeof row?.away_name === "string" ? row.away_name : "",
      };
   });
}

function matchup(teams: { home: string; away: string }, event: bigint): string {
   if (teams.home === "" && teams.away === "") {
      return `Event ${event}`;
   }
   return `${teams.home} vs ${teams.away}`;
}

function marketLine(market: MarketId, side: number, teams: { home: string; away: string }): string {
   return sideLabel(market.mkt, side, {
      sport: market.eventId.sport,
      period: market.period,
      playerId: Number(market.player),
      homeName: teams.home,
      awayName: teams.away,
   });
}

function ticketLine(kind: "Single" | "Parlay", amount: bigint, payout: bigint, result: string, format: OddsFormat): string {
   const odds = amount > 0n && payout > 0n ? formatOdds((payout * 10000n) / amount, format) : "—";
   return `${kind} · ${formatDollars(amount)} @ ${odds} → ${formatDollars(payout)} · ${result}`;
}

export async function describeRow(row: WalletBetRow, format: OddsFormat = "decimal"): Promise<string> {
   const amount = rowAmount(row);
   const payout = rowPayout(row);
   const result = BetResult[rowResult(row)] ?? String(rowResult(row));
   if (row.kind === "single") {
      const market = row.data.marketId;
      const teams = await eventTeams(String(market.operator), market.eventId.sport, market.eventId.league, market.eventId.event);
      const odds = row.data.amount > 0n ? formatOdds((row.data.payout * 10000n) / row.data.amount, format) : "—";
      return `${matchup(teams, market.eventId.event)}\n${marketLine(market, row.data.side, teams)} | ${odds}\n${ticketLine("Single", amount, payout, result, format)}`;
   }
   const lines = [ticketLine("Parlay", amount, payout, result, format)];
   for (const leg of row.account.legs.slice(0, row.account.numLegs)) {
      const teams = await eventTeams(String(leg.marketId.operator), leg.marketId.eventId.sport, leg.marketId.eventId.league, leg.marketId.eventId.event);
      const odds = leg.oddsScaled > 0n ? formatOdds(leg.oddsScaled, format) : "—";
      lines.push(`${matchup(teams, leg.marketId.eventId.event)}: ${marketLine(leg.marketId, leg.side, teams)} | ${odds}`);
   }
   return lines.join("\n");
}

export async function rowCashLabel(row: WalletBetRow): Promise<string> {
   const stake = formatDollars(rowAmount(row));
   if (row.kind === "parlay") {
      return `parlay · ${stake}`;
   }
   const market = row.data.marketId;
   const teams = await eventTeams(String(market.operator), market.eventId.sport, market.eventId.league, market.eventId.event);
   return `${marketLine(market, row.data.side, teams)} · ${stake}`;
}

export function isPending(row: WalletBetRow): boolean {
   return rowResult(row) === BetResult.Pending;
}

export function isCashedOut(row: WalletBetRow): boolean {
   return rowResult(row) === BetResult.CashedOut;
}

export function canClaim(row: WalletBetRow): boolean {
   const result = rowResult(row);
   return result !== BetResult.Pending && result !== BetResult.CashedOut;
}

export function canCashout(row: WalletBetRow): boolean {
   if (row.kind === "single") {
      return row.data.result === BetResult.Pending && row.data.promoType === 0;
   }
   return row.account.result === BetResult.Pending && row.account.promoType === 0;
}

export async function claimGraded(wallet: BotWallet, rows: readonly WalletBetRow[]): Promise<number> {
   const graded = rows.filter(canClaim);
   if (graded.length === 0) {
      return 0;
   }
   const feePayer = await feePayerFor(wallet.address);
   const ixs = await Promise.all(graded.map(async (row) => {
      const betPda = address(row.address);
      if (row.kind === "single") {
         if (row.data.promoType === PROMO_BOOST || row.data.promoType === PROMO_FREEBET) {
            if (row.issuerAuth == null) {
               throw new Error("Promo issuer not found");
            }
            return row.data.promoType === PROMO_BOOST
               ? getSettleBoostedBetIx(feePayer, betPda, row.data, row.issuerAuth)
               : getSettleFreebetIx(feePayer, betPda, row.data, row.issuerAuth);
         }
         return getSettleBetIx(feePayer, betPda, row.data);
      }
      if (row.account.promoType === PROMO_BOOST || row.account.promoType === PROMO_FREEBET) {
         if (row.issuerAuth == null) {
            throw new Error("Promo issuer not found");
         }
         return row.account.promoType === PROMO_BOOST
            ? getSettleBoostedParlayIx(feePayer, betPda, row.account, row.issuerAuth)
            : getSettleFreebetParlayIx(feePayer, betPda, row.account, row.issuerAuth);
      }
      return getSettleParlayIx(feePayer, betPda, row.account);
   }));
   for (let i = 0; i < ixs.length; i += SETTLE_BATCH) {
      await sendInstructions(wallet, ixs.slice(i, i + SETTLE_BATCH));
   }
   return graded.length;
}

export type HistoryRow = {
   title: string;
   detail: string;
   stake: string;
   payout: string;
};

export async function fetchHistory(user: Address, before?: string): Promise<{ rows: HistoryRow[]; next: string | null }> {
   const key = `${user}|${before ?? ""}`;
   return historyCache.get(key, async () => {
      const q = new URLSearchParams({ user: String(user), limit: String(HISTORY_PAGE) });
      if (before != null && before !== "") {
         q.set("before", before);
      }
      const res = await fetch(`${LABS_DOMAIN}/api/betHistory?${q}`);
      if (!res.ok) {
         throw new Error(`${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as { accounts?: unknown[]; next?: unknown };
      const next = typeof body.next === "string" && body.next !== "" ? body.next : null;
      const rows: HistoryRow[] = [];
      for (const item of body.accounts ?? []) {
         const row = await historyLine(item);
         if (row != null) {
            rows.push(row);
         }
      }
      return { rows, next };
   });
}

function numField(value: unknown): number | null {
   const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
   return Number.isFinite(n) ? n : null;
}

async function historyLine(raw: unknown): Promise<HistoryRow | null> {
   if (raw == null || typeof raw !== "object") {
      return null;
   }
   const rec = raw as Record<string, unknown>;
   const selections = Array.isArray(rec.selections) ? rec.selections : [];
   const first = selections[0];
   let title = "Bet";
   if (first != null && typeof first === "object") {
      const sel = first as Record<string, unknown>;
      const sport = numField(sel.sport_id);
      const league = numField(sel.league_id);
      const event = numField(sel.event_id);
      const operator = typeof sel.operator === "string" ? sel.operator : typeof rec.operator === "string" ? rec.operator : "";
      if (sport != null && league != null && event != null && operator !== "") {
         const id = BigInt(Math.trunc(event));
         const name = matchup(await eventTeams(operator, sport, league, id), id);
         title = selections.length > 1 ? `${name} +${selections.length - 1}` : name;
      }
   }
   const stake = formatDollars(BigInt(Math.trunc(Number(rec.amount_filled ?? 0))));
   const payout = formatDollars(BigInt(Math.trunc(Number(rec.final_payout ?? rec.payout ?? 0))));
   const result = BetResult[Number(rec.result)] ?? String(rec.result ?? "");
   return {
      title,
      detail: `${selections.length > 1 ? `Parlay ${selections.length} legs` : "Single"} · ${result}`,
      stake,
      payout,
   };
}
