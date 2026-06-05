/**
 * US sports calendar day boundaries (World Cup / US kickoff times).
 * `contest_date` YYYY-MM-DD is interpreted in this timezone, not UTC.
 */
export const US_SPORTS_TIME_ZONE = 'America/New_York';

type ZonedParts = {
   year: number;
   month: number;
   day: number;
   hour: number;
   minute: number;
   second: number;
};

function getZonedParts(ms: number, timeZone: string): ZonedParts {
   const parts: Record<string, string> = {};
   for (const p of new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
   }).formatToParts(new Date(ms))) {
      if (p.type !== 'literal') {
         parts[p.type] = p.value;
      }
   }
   return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
   };
}

/** UTC ms for a local wall time on `dateYmd` in `timeZone`. */
export function zonedDateTimeToUtcMs(
   dateYmd: string,
   hour: number,
   minute: number,
   second: number,
   timeZone: string = US_SPORTS_TIME_ZONE,
): number {
   const [y, m, d] = dateYmd.split('-').map(Number);
   const anchor = Date.UTC(y!, m! - 1, d!, 12, 0, 0);
   for (let deltaMin = -40 * 60; deltaMin <= 40 * 60; deltaMin++) {
      const candidate = anchor + deltaMin * 60_000;
      const p = getZonedParts(candidate, timeZone);
      if (
         p.year === y &&
         p.month === m &&
         p.day === d &&
         p.hour === hour &&
         p.minute === minute &&
         p.second === second
      ) {
         return candidate;
      }
   }
   throw new Error(`zonedDateTimeToUtcMs: no match for ${dateYmd} ${hour}:${minute}:${second} in ${timeZone}`);
}

/** Inclusive start, exclusive end of `dateYmd` as a calendar day in `timeZone`. */
export function sportsDayBoundsMs(
   dateYmd: string,
   timeZone: string = US_SPORTS_TIME_ZONE,
): { start: number; end: number } {
   const start = zonedDateTimeToUtcMs(dateYmd, 0, 0, 0, timeZone);
   const [y, m, d] = dateYmd.split('-').map(Number);
   const nextUtc = new Date(Date.UTC(y!, m! - 1, d! + 1));
   const nextYmd = `${nextUtc.getUTCFullYear()}-${String(nextUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(nextUtc.getUTCDate()).padStart(2, '0')}`;
   const end = zonedDateTimeToUtcMs(nextYmd, 0, 0, 0, timeZone);
   return { start, end };
}

/** Today's date string (YYYY-MM-DD) in the US sports timezone. */
export function sportsTodayDateString(
   now: Date = new Date(),
   timeZone: string = US_SPORTS_TIME_ZONE,
): string {
   return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
   }).format(now);
}
