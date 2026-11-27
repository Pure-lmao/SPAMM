import { USDC_DECIMALS } from "./constants";

const SCALE = 10n ** BigInt(USDC_DECIMALS);

export function parseUsdc(raw: string): bigint | null {
   const text = raw.trim().replace(/,/g, "");
   if (!/^\d*\.?\d*$/.test(text) || text === "" || text === ".") {
      return null;
   }
   const [whole, fracRaw = ""] = text.split(".");
   const frac = (fracRaw + "000000").slice(0, USDC_DECIMALS);
   try {
      return BigInt(whole || "0") * SCALE + BigInt(frac || "0");
   } catch {
      return null;
   }
}

export function formatUsdc(amount: bigint): string {
   const sign = amount < 0n ? "-" : "";
   const value = amount < 0n ? -amount : amount;
   const cents = 10n ** BigInt(USDC_DECIMALS - 2);
   const rounded = (value + cents / 2n) / cents;
   const whole = rounded / 100n;
   const frac = rounded % 100n;
   return `${sign}${whole}.${frac.toString().padStart(2, "0")}`;
}

export function formatDollars(amount: bigint): string {
   return `$${formatUsdc(amount)}`;
}

export function formatDecimalOdds(scaled: bigint, scale = 10000n): string {
   const x = Number(scaled) / Number(scale);
   if (!Number.isFinite(x) || x <= 0) {
      return "—";
   }
   return x.toFixed(2);
}

export type OddsFormat = "decimal" | "american" | "percent";

export function formatOddsNumber(decimal: number, format: OddsFormat): string {
   if (!Number.isFinite(decimal) || decimal <= 0) {
      return "—";
   }
   if (format === "decimal") {
      return decimal.toFixed(2);
   }
   if (format === "american") {
      if (!(decimal > 1)) {
         return "—";
      }
      const raw = decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
      const american = !Number.isFinite(raw) || raw === 0 || Math.abs(raw) < 100 ? (decimal >= 2 ? 100 : -100) : raw;
      return american > 0 ? `+${american}` : String(american);
   }
   const pct = Math.round((100 / decimal) * 10) / 10;
   if (!Number.isFinite(pct)) {
      return "—";
   }
   return `${pct.toFixed(1)}%`;
}

export function formatOdds(scaled: bigint, format: OddsFormat = "decimal", scale = 10000n): string {
   if (scaled <= 0n) {
      return "—";
   }
   if (format === "decimal") {
      return formatDecimalOdds(scaled, scale);
   }
   return formatOddsNumber(Number(scaled) / Number(scale), format);
}

/** Parse odds typed in the selected format back to the on-chain scale (decimal × 10000). */
export function parseOddsToScaled(raw: string, format: OddsFormat): bigint | null {
   const trimmed = raw.trim();
   let decimal: number | null = null;
   if (format === "american") {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n === 0 || Math.abs(n) < 100) {
         return null;
      }
      decimal = n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
   } else if (format === "percent") {
      const body = trimmed.endsWith("%") ? trimmed.slice(0, -1).trim() : trimmed;
      const n = Number(body);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
         return null;
      }
      decimal = 100 / n;
   } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) {
         return null;
      }
      decimal = n;
   }
   if (decimal == null || !Number.isFinite(decimal) || decimal <= 0) {
      return null;
   }
   return BigInt(Math.round(decimal * 10000));
}
