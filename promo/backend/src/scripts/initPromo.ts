/**
 * One-shot promo market bootstrap (single tx).
 *
 *   bun run init-promo -- --market-key 1:1:12345:0:9: --operator <pk> \
 *     --allow <pk>[,pk…] --start 1730000000 --max-usdc 25 --max-total-usdc 5000 --odds0 1.90
 *
 * Bundles: init-event (if needed) → update-event-state (seq 1, PG 0-0) → init-market (if needed) → set-odds.
 * Global: --dry-run
 */

import './bootstrapEnv';
import { decodeMarketKey } from '../marketKey';
import { getEventStatePda } from '../spammSdk';
import {
   assertPromoMarketParts,
   buildPromoInitMarketFromParts,
   createPromoAdminContext,
   parseMarketKeyPartsFromFlags,
   promoMarketIdFromParts,
   runPromoBootstrapMarket,
} from '../adminRun';
import { getPromoMarketDataPda } from '../instructions';
import { ODDS_SCALE } from '../constants';
import { parseAllowList, parseFlags, parseOperatorFlag, parseSendOptions } from './cliFlags';

function parseOdds(input: string): bigint {
   if (/^\d+$/.test(input.trim())) {
      return BigInt(input.trim());
   }
   return BigInt(Math.round(Number(input) * ODDS_SCALE));
}

function parseUsdc(input: string): bigint {
   if (/^\d+$/.test(input.trim())) {
      return BigInt(input.trim()) * 1_000_000n;
   }
   return BigInt(Math.round(Number(input) * 1_000_000));
}

async function main(): Promise<void> {
   const flags = parseFlags(process.argv.slice(2));
   const opts = parseSendOptions(flags);
   const marketKey = flags['market-key'];
   const start = flags.start;
   const maxUsdc = flags['max-usdc'];
   const maxTotalUsdc = flags['max-total-usdc'];
   const odds0 = flags.odds0;

   if (!marketKey || !start || !maxUsdc || !maxTotalUsdc || !odds0) {
      throw new Error(
         'required: --market-key --start <unix> --max-usdc --max-total-usdc --odds0 <decimal>',
      );
   }

   const parts = decodeMarketKey(marketKey);
   if (!parts) {
      throw new Error(`invalid --market-key ${marketKey}`);
   }
   assertPromoMarketParts(parts);

   const operator = parseOperatorFlag(flags);
   const allowedAccounts = parseAllowList(process.argv.slice(2));

   const ctx = await createPromoAdminContext();
   const marketParts = parseMarketKeyPartsFromFlags({ ...flags, 'market-key': marketKey });
   const marketId = promoMarketIdFromParts(marketParts, operator);

   const outcomes = flags.outcomes === '3' ? 3 : 2;
   const payload = await buildPromoInitMarketFromParts(
      marketParts,
      operator,
      allowedAccounts,
      Number(start),
      outcomes,
      parseUsdc(maxUsdc),
      parseUsdc(maxTotalUsdc),
   );

   const o0 = parseOdds(odds0);
   const o1 = flags.odds1 ? parseOdds(flags.odds1) : o0;
   const o2 = flags.odds2 ? parseOdds(flags.odds2) : 0n;

   console.log('[init-promo] bootstrap (one tx)…');
   await runPromoBootstrapMarket(
      ctx,
      {
         payload,
         odds0: o0,
         odds1: o1,
         odds2: o2,
      },
      opts,
   );

   const [eventPda] = await getEventStatePda(ctx.programId, marketId.eventId);
   const [marketPda] = await getPromoMarketDataPda(ctx.programId, marketId);
   console.log('[init-promo] done');
   console.log(`  event:  ${eventPda}`);
   console.log(`  market: ${marketPda}`);
}

main().catch((error) => {
   console.error(error);
   process.exit(1);
});
