import { ODDS_SCALE } from 'spamm-aggregator-sdk';

/** Filled odds scaled integer from on-chain `payout` / `amount`. */
export function filledOddsScaled(amount: bigint, payout: bigint): bigint {
   if (amount <= 0n || payout <= 0n) {
      return 0n;
   }
   return (payout * ODDS_SCALE) / amount;
}

/** Decimal odds from on-chain filled `payout` / `amount` (pending bets). */
export function formatFilledBetOdds(amount: bigint, payout: bigint): string {
   const scaled = filledOddsScaled(amount, payout);
   if (scaled <= 0n) {
      return '—';
   }
   const x = Number(scaled) / Number(ODDS_SCALE);
   if (!Number.isFinite(x) || x <= 0) {
      return '—';
   }
   return x >= 10 ? x.toFixed(2) : x.toFixed(3);
}
