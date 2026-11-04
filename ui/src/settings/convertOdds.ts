/** How decimal odds are shown. Add new formats here and in the settings menu. */
export type OddsFormat = "decimal" | "american" | "percent";

export const ODDS_FORMATS: readonly { id: OddsFormat; label: string }[] = [
   { id: "decimal", label: "Decimal" },
   { id: "american", label: "American" },
   { id: "percent", label: "Percent" },
];

export type DecimalPlaces = number | "slip";

export function isOddsFormat(value: string): value is OddsFormat {
   return value === "decimal" || value === "american" || value === "percent";
}

/**
 * Decimal translation beside an odds input.
 * Four significant figures (2.415, 10.25, 254.1, 1489). Above 9999, the full number.
 */
export function formatTranslatedDecimal(decimal: number): string {
   if (!Number.isFinite(decimal)) {
      return "—";
   }
   const sign = decimal < 0 ? "-" : "";
   const abs = Math.abs(decimal);
   if (abs > 9999) {
      if (Math.abs(abs - Math.round(abs)) < 1e-6) {
         return `${sign}${Math.round(abs)}`;
      }
      return `${sign}${abs.toFixed(8).replace(/\.?0+$/, "")}`;
   }
   if (abs === 0) {
      return "0";
   }
   let magnitude = Math.floor(Math.log10(abs));
   let decimals = Math.max(0, 3 - magnitude);
   let rounded = Number(abs.toFixed(decimals));
   if (rounded > 9999) {
      return `${sign}${Math.round(rounded)}`;
   }
   const roundedMagnitude = Math.floor(Math.log10(Math.max(rounded, Number.MIN_VALUE)));
   if (roundedMagnitude !== magnitude) {
      magnitude = roundedMagnitude;
      decimals = Math.max(0, 3 - magnitude);
      rounded = Number(abs.toFixed(decimals));
   }
   return `${sign}${rounded.toFixed(decimals)}`;
}

/**
 * `decimal` rounded down to `places`, so a shown price is never above the real one (1.7376 → "1.73").
 * The epsilon keeps exact values like 1.73 (172.999… after scaling) from dropping a step.
 */
export function floorToFixed(decimal: number, places: number): string {
   const factor = 10 ** places;
   return (Math.floor(decimal * factor + 1e-9) / factor).toFixed(places);
}

/** Decimal string used on market buttons (2 dp) or bet-slip labels (3 dp under 10). Always rounded down. */
export function formatDecimalOdds(decimal: number, places: DecimalPlaces = 2): string {
   if (!Number.isFinite(decimal)) {
      return "—";
   }
   if (places === "slip") {
      return decimal >= 10 ? floorToFixed(decimal, 2) : floorToFixed(decimal, 3);
   }
   return floorToFixed(decimal, places);
}

function nearestAmerican(decimal: number): number | null {
   if (!(decimal > 1)) {
      return null;
   }
   const american =
      decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
   if (!Number.isFinite(american) || american === 0 || Math.abs(american) < 100) {
      return decimal >= 2 ? 100 : -100;
   }
   return american;
}

export function americanToDecimal(american: number): number | null {
   if (!Number.isFinite(american) || american === 0 || Math.abs(american) < 100) {
      return null;
   }
   if (american > 0) {
      return 1 + american / 100;
   }
   return 1 + 100 / Math.abs(american);
}

/**
 * Display a decimal price in the selected format.
 * American is a whole number (for example -150). Percent is implied probability, nearest 1 dp.
 */
export function convertOdds(decimal: number, format: OddsFormat, places: DecimalPlaces = 2): string {
   if (!Number.isFinite(decimal) || decimal <= 0) {
      return "—";
   }
   if (format === "decimal") {
      return formatDecimalOdds(decimal, places);
   }
   if (format === "american") {
      const american = nearestAmerican(decimal);
      if (american == null) {
         return "—";
      }
      return american > 0 ? `+${american}` : String(american);
   }
   const pct = Math.round((100 / decimal) * 10) / 10;
   if (!Number.isFinite(pct)) {
      return "—";
   }
   return `${pct.toFixed(1)}%`;
}

/** Bet slip price. Decimal is shown alone; other formats include the on-chain decimal in brackets. */
export function formatSlipOdds(decimal: number, format: OddsFormat): string {
   if (!Number.isFinite(decimal) || decimal <= 0) {
      return "—";
   }
   const real = formatDecimalOdds(decimal, "slip");
   if (format === "decimal") {
      return real;
   }
   const shown = convertOdds(decimal, format, "slip");
   if (shown === "—") {
      return real;
   }
   return `${shown} (${real})`;
}

export function formatSlipOddsFromScaled(scaled: bigint, format: OddsFormat, scale = 10_000): string {
   if (scaled <= 0n) {
      return "—";
   }
   const decimal = Number(scaled) / scale;
   return formatSlipOdds(decimal, format);
}

/** Parse a field the user typed in `format` back to decimal odds. Incomplete input returns null. */
export function parseUserOddsToDecimal(raw: string, format: OddsFormat): number | null {
   const trimmed = raw.trim();
   if (trimmed === "") {
      return null;
   }
   if (format === "american") {
      if (trimmed === "+" || trimmed === "-" || trimmed === "+." || trimmed === "-.") {
         return null;
      }
      const n = Number(trimmed);
      return americanToDecimal(n);
   }
   if (format === "percent") {
      const body = trimmed.endsWith("%") ? trimmed.slice(0, -1).trim() : trimmed;
      if (body === "" || body === "." || body === "+" || body === "-") {
         return null;
      }
      const n = Number(body);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
         return null;
      }
      return 100 / n;
   }
   const n = Number(trimmed);
   if (!Number.isFinite(n) || n <= 0) {
      return null;
   }
   return n;
}

function trimDecimalInput(decimal: number): string {
   return decimal.toFixed(4).replace(/\.?0+$/, "");
}

/**
 * String to put in an odds input so parsing it does not round the minimum above `decimal`.
 * Used when a quote pre-fills min odds, or when the display format changes.
 */
export function formatOddsInputFromDecimal(decimal: number, format: OddsFormat): string {
   if (!Number.isFinite(decimal) || decimal <= 0) {
      return "";
   }
   if (format === "decimal") {
      return trimDecimalInput(decimal);
   }
   if (format === "american") {
      let american = nearestAmerican(decimal);
      if (american == null) {
         return "";
      }
      for (let i = 0; i < 30; i++) {
         const back = americanToDecimal(american);
         if (back != null && back <= decimal + 1e-8) {
            break;
         }
         if (american > 0) {
            american -= 1;
            if (american < 100) {
               american = -100;
            }
         } else {
            american -= 1;
         }
      }
      return american > 0 ? `+${american}` : String(american);
   }
   // Tenths of a percent, so stepping by 0.1 stays exact.
   let tenths = Math.round(1000 / decimal);
   if (!Number.isFinite(tenths)) {
      return "";
   }
   if (tenths < 1) {
      tenths = 1;
   }
   if (tenths > 1000) {
      tenths = 1000;
   }
   for (let i = 0; i < 5 && tenths < 1000; i++) {
      if (1000 / tenths <= decimal + 1e-8) {
         break;
      }
      tenths += 1;
   }
   return (tenths / 10).toFixed(1);
}

export function oddsFormatInputLabel(base: string, format: OddsFormat): string {
   if (format === "american") {
      return `${base} (American)`;
   }
   if (format === "percent") {
      return `${base} (%)`;
   }
   return `${base} (decimal)`;
}
