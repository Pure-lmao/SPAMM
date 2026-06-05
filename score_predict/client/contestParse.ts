import { encodePrediction, type PredictionKind } from 'spamm-score-predict-sdk';

export function parseDeadline(raw: string): number {
   if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      return raw.length <= 10 ? n * 1000 : n;
   }
   const ms = Date.parse(raw);
   if (!Number.isFinite(ms)) {
      throw new Error(`Invalid deadline: ${raw}`);
   }
   return ms;
}

/** Legacy 4-hex-char wire encoding (e.g. `0201`). */
export function parseResultHex(raw: string): Uint8Array {
   const hex = raw.replace(/^0x/i, '');
   if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      throw new Error('result must be 4 hex chars (2 bytes), e.g. 0201');
   }
   return new Uint8Array([parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16)]);
}

export function parseContestResult(kind: PredictionKind, raw: string): Uint8Array {
   const trimmed = raw.trim();
   const hexBody = trimmed.replace(/^0x/i, '');
   if (/^[0-9a-fA-F]{4}$/.test(hexBody)) {
      return parseResultHex(trimmed);
   }
   if (kind === 'match_score') {
      return parseMatchScoreResult(trimmed);
   }
   return parseDailyTotalResult(trimmed);
}

function parseMatchScoreResult(raw: string): Uint8Array {
   const m = raw.match(/^(\d+)\s*-\s*(\d+)$/);
   if (!m) {
      throw new Error('match_score result must be HOME-AWAY, e.g. 2-1');
   }
   const homeGoals = Number(m[1]);
   const awayGoals = Number(m[2]);
   if (
      !Number.isInteger(homeGoals) ||
      !Number.isInteger(awayGoals) ||
      homeGoals < 0 ||
      homeGoals > 255 ||
      awayGoals < 0 ||
      awayGoals > 255
   ) {
      throw new Error('match_score goals must be integers 0–255');
   }
   const [b0, b1] = encodePrediction('match_score', { homeGoals, awayGoals });
   return new Uint8Array([b0, b1]);
}

function parseDailyTotalResult(raw: string): Uint8Array {
   const total = Number(raw);
   if (!Number.isInteger(total) || total < 0 || total > 65535) {
      throw new Error('daily_total result must be an integer 0–65535');
   }
   const [b0, b1] = encodePrediction('daily_total', { total });
   return new Uint8Array([b0, b1]);
}

export function jsonStringify(value: unknown): string {
   return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}
