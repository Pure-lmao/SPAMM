import { address, type Address, type Rpc, type SolanaRpcApi } from "@solana/kit";
import {
   ODDS_SCALE,
   PromoState,
   getBoostsData,
   getFreebetsData,
   type BoostAccountData,
   type FreebetAccountData,
} from "spamm-aggregator-sdk";
import { VOUCHER_TTL_MS } from "../constants";
import { ttlMap } from "../cache";
import { rpc } from "../chain/rpc";
import type { Leg } from "../markets/leg";
import { formatDollars, formatOdds, type OddsFormat } from "../usdc";
import type { MmQuoteRow } from "./quote";

export type SlipFreebet = { address: Address; data: FreebetAccountData };
export type SlipBoost = { address: Address; data: BoostAccountData };

type Limits = {
   minLegs: number;
   minOddsScaled: bigint;
   maxOddsScaled: bigint;
   allowedMms: readonly Address[];
   allowedOperators: readonly Address[];
};

const cache = ttlMap<{ freebets: SlipFreebet[]; boosts: SlipBoost[] }>(VOUCHER_TTL_MS);

export function freebetKey(row: SlipFreebet): string {
   return `${row.data.issuerAuth}:${row.data.freebetId}`;
}

export function boostKey(row: SlipBoost): string {
   return `${row.data.issuerAuth}:${row.data.boostId}`;
}

export async function loadVouchers(user: Address): Promise<{ freebets: SlipFreebet[]; boosts: SlipBoost[] }> {
   return cache.get(String(user), async () => {
      const now = Math.floor(Date.now() / 1000);
      const [freebets, boosts] = await Promise.all([
         getFreebetsData(rpc, { user, state: PromoState.Available }),
         getBoostsData(rpc, { user, state: PromoState.Available }),
      ]);
      return {
         freebets: freebets.filter((row) => row.data.expiry > now).map((row) => ({ address: row.address, data: row.data })),
         boosts: boosts.filter((row) => row.data.expiry > now).map((row) => ({ address: row.address, data: row.data })),
      };
   });
}

function inList(list: readonly Address[], needle: Address | string): boolean {
   const key = String(needle);
   return list.some((item) => String(item) === key);
}

export function boardOdds(legs: readonly Leg[]): bigint | null {
   if (legs.length === 0) {
      return null;
   }
   let prod = 1;
   for (const leg of legs) {
      const dec = leg.displayedDecimalOdds;
      if (dec == null || dec <= 0) {
         return null;
      }
      prod *= dec;
   }
   if (!Number.isFinite(prod) || prod <= 0) {
      return null;
   }
   return BigInt(Math.round(prod * Number(ODDS_SCALE)));
}

export function voucherReason(limits: Limits, legs: readonly Leg[], quotes?: readonly MmQuoteRow[], format: OddsFormat = "decimal"): string | null {
   if (legs.length < limits.minLegs) {
      return `Needs ${limits.minLegs}+ legs`;
   }
   if (limits.allowedOperators.length > 0) {
      for (const leg of legs) {
         if (!inList(limits.allowedOperators, address(leg.operator))) {
            return "Operator not allowed";
         }
      }
   }
   const rows = quotes ?? [];
   if (quotes != null) {
      const allowed = limits.allowedMms.length === 0 ? rows : rows.filter((row) => inList(limits.allowedMms, row.mmProgramAddress));
      if (allowed.length === 0) {
         return "No allowed MM quoted";
      }
      const ok = allowed.some((row) => row.oddsScaled >= limits.minOddsScaled && row.oddsScaled <= limits.maxOddsScaled);
      if (!ok) {
         return `Odds must be between ${formatOdds(limits.minOddsScaled, format)} and ${formatOdds(limits.maxOddsScaled, format)}`;
      }
      return null;
   }
   const board = boardOdds(legs);
   if (board != null && (board < limits.minOddsScaled || board > limits.maxOddsScaled)) {
      return `Odds must be between ${formatOdds(limits.minOddsScaled, format)} and ${formatOdds(limits.maxOddsScaled, format)}`;
   }
   return null;
}

export function eligibleFreebets(rows: readonly SlipFreebet[], legs: readonly Leg[], quotes?: readonly MmQuoteRow[]): SlipFreebet[] {
   return rows.filter((row) => voucherReason(row.data, legs, quotes) == null);
}

export function eligibleBoosts(rows: readonly SlipBoost[], legs: readonly Leg[], quotes?: readonly MmQuoteRow[]): SlipBoost[] {
   return rows.filter((row) => voucherReason(row.data, legs, quotes) == null);
}

export function filterQuotes(rows: readonly MmQuoteRow[], limits: Limits | null): MmQuoteRow[] {
   if (limits == null) {
      return [...rows];
   }
   return rows.filter((row) => {
      if (limits.allowedMms.length > 0 && !inList(limits.allowedMms, row.mmProgramAddress)) {
         return false;
      }
      return row.oddsScaled >= limits.minOddsScaled && row.oddsScaled <= limits.maxOddsScaled;
   });
}

export function freebetLabel(row: SlipFreebet): string {
   const legs = row.data.minLegs > 1 ? ` · ${row.data.minLegs}+ legs` : "";
   return `${formatDollars(row.data.amount)}${legs}`;
}

export function boostLabel(row: SlipBoost): string {
   const legs = row.data.minLegs > 1 ? ` · ${row.data.minLegs}+ legs` : "";
   return `${row.data.boostBps / 100}% extra · max ${formatDollars(row.data.maxStake)}${legs}`;
}

export function boostedPayout(payout: bigint, amount: bigint, boostBps: number): bigint {
   if (payout <= amount || boostBps <= 0) {
      return payout;
   }
   const profit = payout - amount;
   return payout + (profit * BigInt(boostBps)) / 10_000n;
}

export type RpcClient = Rpc<SolanaRpcApi>;
