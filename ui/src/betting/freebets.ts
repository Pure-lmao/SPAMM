import { address, type Address, type Rpc, type SolanaRpcApi } from "@solana/kit";
import {
   FreebetState,
   ODDS_SCALE,
   getFreebetsData,
   type FreebetAccountData,
} from "spamm-aggregator-sdk";
import type { BetSlipSelection } from "./types";
import { parseOperatorAddress } from "./chainIds";
import { oddsDecimalLabel } from "./betSlipUtils";
import { formatUsdcBaseUnitsForUi } from "./usdc";

export type SlipFreebet = Readonly<{
   address: Address;
   data: FreebetAccountData;
   eligible: boolean;
   reason: string | null;
}>;

export type FreebetQuoteRow = Readonly<{
   mmProgramAddress: Address;
   oddsScaled: bigint;
}>;

export async function fetchAvailableFreebets(
   rpc: Rpc<SolanaRpcApi>,
   user: Address,
   nowUnixSecs: number = Math.floor(Date.now() / 1000),
): Promise<readonly SlipFreebet[]> {
   const rows = await getFreebetsData(rpc, { user, state: FreebetState.Available });
   return rows
      .filter((r) => r.data.expiry > nowUnixSecs)
      .map((r) => ({
         address: r.address,
         data: r.data,
         eligible: true,
         reason: null,
      }));
}

export async function mapFreebetIdToIssuerAuth(
   rpc: Rpc<SolanaRpcApi>,
   user: Address,
   freebetIds: readonly number[],
): Promise<ReadonlyMap<number, Address>> {
   const wanted = new Set(freebetIds.filter((id) => id !== 0));
   const out = new Map<number, Address>();
   if (wanted.size === 0) {
      return out;
   }
   const rows = await getFreebetsData(rpc, { user, state: FreebetState.Used });
   for (const row of rows) {
      if (wanted.has(row.data.freebetId)) {
         out.set(row.data.freebetId, row.data.issuerAuth);
      }
   }
   return out;
}

export function addressInList(list: readonly Address[], needle: Address | string): boolean {
   const n = String(needle);
   return list.some((a) => String(a) === n);
}

export function oddsInFreebetRange(oddsScaled: bigint, voucher: FreebetAccountData): boolean {
   return oddsScaled >= voucher.minOddsScaled && oddsScaled <= voucher.maxOddsScaled;
}

export function explainFreebetOdds(oddsScaled: bigint, voucher: FreebetAccountData): string | null {
   if (oddsScaled < voucher.minOddsScaled) {
      return `Odds must be higher than ${oddsDecimalLabel(voucher.minOddsScaled)}`;
   }
   if (oddsScaled > voucher.maxOddsScaled) {
      return `Odds must be lower than ${oddsDecimalLabel(voucher.maxOddsScaled)}`;
   }
   return null;
}

export function explainFreebetOddsForQuotes(
   rows: readonly FreebetQuoteRow[],
   voucher: FreebetAccountData,
): string | null {
   if (rows.some((r) => oddsInFreebetRange(r.oddsScaled, voucher))) {
      return null;
   }
   if (rows.length === 0) {
      return `Odds must be between ${oddsDecimalLabel(voucher.minOddsScaled)} and ${oddsDecimalLabel(voucher.maxOddsScaled)}`;
   }
   const allBelow = rows.every((r) => r.oddsScaled < voucher.minOddsScaled);
   if (allBelow) {
      return `Odds must be higher than ${oddsDecimalLabel(voucher.minOddsScaled)}`;
   }
   const allAbove = rows.every((r) => r.oddsScaled > voucher.maxOddsScaled);
   if (allAbove) {
      return `Odds must be lower than ${oddsDecimalLabel(voucher.maxOddsScaled)}`;
   }
   return `Odds must be between ${oddsDecimalLabel(voucher.minOddsScaled)} and ${oddsDecimalLabel(voucher.maxOddsScaled)}`;
}

export function combinedBoardOddsScaled(selections: readonly BetSlipSelection[]): bigint | null {
   if (selections.length === 0) {
      return null;
   }
   let prod = 1;
   for (const sel of selections) {
      const d = sel.displayedDecimalOdds;
      if (d == null || !Number.isFinite(d) || d <= 0) {
         return null;
      }
      prod *= d;
   }
   if (!Number.isFinite(prod) || prod <= 0) {
      return null;
   }
   return BigInt(Math.round(prod * Number(ODDS_SCALE)));
}

export function filterQuoteRowsForFreebet<T extends FreebetQuoteRow>(
   rows: readonly T[],
   voucher: FreebetAccountData | null | undefined,
): T[] {
   if (voucher == null) {
      return [...rows];
   }
   return rows.filter((r) => {
      if (voucher.allowedMms.length > 0 && !addressInList(voucher.allowedMms, r.mmProgramAddress)) {
         return false;
      }
      return oddsInFreebetRange(r.oddsScaled, voucher);
   });
}

export function assessFreebetForSlip(
   voucher: FreebetAccountData,
   selections: readonly BetSlipSelection[],
   ctx?: Readonly<{
      quoteRows?: readonly FreebetQuoteRow[];
      quotesAttempted?: boolean;
      isSelected?: boolean;
   }>,
): { eligible: boolean; reason: string | null } {
   const legs = Math.max(1, selections.length);
   if (legs < voucher.minLegs) {
      return { eligible: false, reason: `Needs ${voucher.minLegs}+ legs` };
   }
   if (voucher.allowedOperators.length > 0) {
      for (const sel of selections) {
         const op = parseOperatorAddress(sel.operator);
         if (!addressInList(voucher.allowedOperators, op)) {
            return { eligible: false, reason: "Operator not allowed" };
         }
      }
   }

   const isSelected = ctx?.isSelected === true;
   const quotesAttempted = ctx?.quotesAttempted === true;
   const rows = ctx?.quoteRows ?? [];

   if (isSelected && quotesAttempted) {
      const mmRows =
         voucher.allowedMms.length > 0
            ? rows.filter((r) => addressInList(voucher.allowedMms, r.mmProgramAddress))
            : rows;
      if (voucher.allowedMms.length > 0 && mmRows.length === 0) {
         return { eligible: false, reason: "No allowed MM quoted" };
      }
      if (mmRows.length === 0) {
         return { eligible: false, reason: "No allowed MM quoted" };
      }
      const oddsReason = explainFreebetOddsForQuotes(mmRows, voucher);
      if (oddsReason != null) {
         return { eligible: false, reason: oddsReason };
      }
      return { eligible: true, reason: null };
   }

   const boardOdds = combinedBoardOddsScaled(selections);
   if (boardOdds != null) {
      const oddsReason = explainFreebetOdds(boardOdds, voucher);
      if (oddsReason != null) {
         return { eligible: false, reason: oddsReason };
      }
   }
   return { eligible: true, reason: null };
}

export function withSlipEligibility(
   vouchers: readonly SlipFreebet[],
   selections: readonly BetSlipSelection[],
   ctx: Readonly<{
      quoteRows: readonly FreebetQuoteRow[];
      quotesAttempted: boolean;
      selectedKey: string;
   }>,
): SlipFreebet[] {
   return vouchers.map((v) => {
      const a = assessFreebetForSlip(v.data, selections, {
         quoteRows: ctx.quoteRows,
         quotesAttempted: ctx.quotesAttempted,
         isSelected: freebetKey(v) === ctx.selectedKey,
      });
      return { ...v, eligible: a.eligible, reason: a.reason };
   });
}

export function freebetPickerLabel(v: SlipFreebet): string {
   const amt = formatUsdcBaseUnitsForUi(v.data.amount);
   const exp = new Date(v.data.expiry * 1000).toLocaleDateString();
   const legs = v.data.minLegs > 1 ? ` · ${v.data.minLegs}+ legs` : "";
   return `${amt} USDC${legs} · exp ${exp}`;
}

export function freebetKey(v: SlipFreebet): string {
   return `${v.data.issuerAuth}:${v.data.freebetId}`;
}

export function parseFreebetKey(raw: string): { issuerAuth: Address; freebetId: number } | null {
   const i = raw.lastIndexOf(":");
   if (i < 0) {
      return null;
   }
   const id = Number(raw.slice(i + 1));
   if (!Number.isFinite(id) || id <= 0) {
      return null;
   }
   try {
      return { issuerAuth: address(raw.slice(0, i)), freebetId: id };
   } catch {
      return null;
   }
}
