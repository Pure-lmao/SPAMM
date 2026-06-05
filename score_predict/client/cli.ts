/**
 * score_predict CLI
 *
 *   bun run cli.ts fetch user <pubkey>
 *   bun run cli.ts fetch contest <contestId>
 *   bun run cli.ts close <ownerPubkey> <contestId> [--admin]
 */

import { closePredictionPda, fetchContestPredictions, fetchUserPredictions } from './onchainAdmin.ts';
import { jsonStringify } from './contestParse.ts';

const sub = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

function hasFlag(name: string): boolean {
   return process.argv.includes(name);
}

if (sub === 'fetch' && arg1 === 'user' && arg2) {
   const rows = await fetchUserPredictions(arg2);
   console.log(jsonStringify(rows));
} else if (sub === 'fetch' && arg1 === 'contest' && arg2) {
   const rows = await fetchContestPredictions(Number(arg2));
   console.log(jsonStringify(rows));
} else if (sub === 'close' && arg1 && arg2) {
   const { signature } = await closePredictionPda({
      ownerPubkey: arg1,
      contestId: Number(arg2),
      useAdmin: hasFlag('--admin'),
   });
   console.log('closed', signature);
} else {
   console.log('Usage: fetch user <pk> | fetch contest <id> | close <owner> <contestId> [--admin]');
   process.exit(1);
}
