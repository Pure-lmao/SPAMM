/** SPL-style USDC: integer on-chain amounts use 10^6 base units per whole token. */
export const USDC_DECIMALS = 6;
export const USDC_BASE_UNITS_PER_TOKEN = 10n ** BigInt(USDC_DECIMALS);

/** Parse a human USDC decimal string (e.g. `10`, `1.5`) into on-chain base units. */
export function parseUsdcAmountUiToBaseUnits(raw: string | number): bigint | null {
   const n = typeof raw === "number" ? raw.toString() : raw;
   const t = n.trim().replace(/,/g, "");
   if (!t || !/^\d*\.?\d*$/.test(t) || t === ".") {
      return null;
   }
   const [a, bRaw = ""] = t.split(".");
   const frac = (bRaw + "000000").slice(0, USDC_DECIMALS);
   try {
      return BigInt(a || "0") * USDC_BASE_UNITS_PER_TOKEN + BigInt(frac || "0");
   } catch {
      return null;
   }
}

/** Format on-chain USDC base units for UI (e.g. `10000000` → `10`). */
export function formatUsdcBaseUnitsForUi(amountBase: bigint): string {
   const sign = amountBase < 0n ? "-" : "";
   const u = amountBase < 0n ? -amountBase : amountBase;
   const whole = u / USDC_BASE_UNITS_PER_TOKEN;
   const frac = u % USDC_BASE_UNITS_PER_TOKEN;
   if (frac === 0n) {
      return `${sign}${whole}`;
   }
   const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
   return `${sign}${whole}.${fracStr}`;
}
