/**
 * Read promo MM market-data (oracle) account from chain.
 *
 *   bun run read-oracle --market-key 1:21900:760463:1:9: --operator <pk>
 *   bun run read-oracle --market-key 1:21900:760463:1:9: --operator <pk> --json
 */

import './bootstrapEnv';
import { decodeMarketKey } from '../marketKey';
import { createPromoAdminContext, promoMarketIdFromParts } from '../adminRun';
import {
   fetchPromoOracleAccount,
   printPromoOracleChainState,
   promoOracleChainStateToJson,
} from '../readOracle';
import { parseFlags, parseOperatorFlag } from './cliFlags';

function requireMarketKey(flags: Record<string, string>): string {
   const key = flags['market-key'];
   if (!key) {
      throw new Error('--market-key required');
   }
   return key;
}

async function main(): Promise<void> {
   const flags = parseFlags(process.argv.slice(2));
   const marketKey = requireMarketKey(flags);
   const parts = decodeMarketKey(marketKey);
   if (!parts) {
      throw new Error(`invalid market key: ${marketKey}`);
   }
   const marketId = promoMarketIdFromParts(parts, parseOperatorFlag(flags));

   const ctx = await createPromoAdminContext();
   const state = await fetchPromoOracleAccount(ctx, marketId);
   if (state === null) {
      console.error(`oracle account missing for ${marketKey}`);
      process.exit(1);
   }

   if (flags.json === 'true') {
      console.log(JSON.stringify(promoOracleChainStateToJson(state), null, 2));
      return;
   }

   console.log(`program:       ${ctx.programId}`);
   printPromoOracleChainState(state, marketKey);
}

main().catch((error) => {
   console.error(error);
   process.exit(1);
});
