const INT_EPS = 1e-9;

/** `last_odds` JSON stores decimal odds × this factor (on-chain ODDS_SCALE). */
export const ODDS_DB_SCALE = 10_000;

export function decimalOddsFromDb(dbValue: number): number {
   return Number((dbValue / ODDS_DB_SCALE).toFixed(2));
}

function formatDecimalMinimal(abs: number): string {
   let s = abs.toFixed(4);
   if (s.includes(".")) {
      s = s.replace(/0+$/, "");
      s = s.replace(/\.$/, "");
   }
   return s;
}

/**
 * Spread / total line for display: whole numbers show one decimal (e.g. 2 → 2.0, +1 → +1.0).
 * Otherwise minimal decimals (e.g. 2.5, 0.25). Totals omit a leading + on positives.
 */
export function formatMarketLineDisplay(raw: string, kind: "spread" | "total"): string {
   const t = raw.trim();
   const hasPlus = t.startsWith("+");
   const hasMinus = t.startsWith("-");
   const unsignedStr = t.replace(/^[+-]/, "");
   const n = Number(unsignedStr);
   if (!Number.isFinite(n)) {
      return raw;
   }

   const abs = Math.abs(n);
   const isInt = Math.abs(abs - Math.round(abs)) < INT_EPS;
   const body = isInt ? `${Math.round(abs)}.0` : formatDecimalMinimal(abs);

   if (hasMinus || n < 0) {
      return `-${body}`;
   }
   if (kind === "spread" && (hasPlus || n > 0)) {
      return `+${body}`;
   }
   return body;
}

export function parseOdds(json: string): number[] {
   try {
      const v = JSON.parse(json) as unknown;
      if (!Array.isArray(v)) {
         return [];
      }
      return v.map((x) => (typeof x === "number" ? x : Number(x))).filter((n) => !Number.isNaN(n));
   } catch {
      return [];
   }
}

export function fmtOdd(dbValue: number): string {
   if (dbValue === 0) {
      return "—";
   }
   return decimalOddsFromDb(dbValue).toFixed(2);
}
