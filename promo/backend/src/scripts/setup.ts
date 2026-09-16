/**
 * One-shot promo MM bootstrap: init-program → activate → register-mm.
 *
 *   bun run setup
 *   bun run setup -- --dry-run
 *   bun run setup -- --skip-init        (config PDA already exists)
 *   bun run setup -- --skip-register    (already registered with aggregator)
 */

import './bootstrapEnv';
import {
   createPromoAdminContext,
   runPromoActivate,
   runPromoInitProgram,
   runPromoRegisterMm,
} from '../adminRun';
import { PROMO_PROGRAM_ID } from '../constants';
import { decodePromoConfigAccount } from '../codex';
import { getAta, getMmConfigPda, readAccountDataRaw } from '../spammSdk';
import { parseFlags, parseSendOptions } from './cliFlags';

async function main(): Promise<void> {
   const flags = parseFlags(process.argv.slice(2));
   const opts = parseSendOptions(flags);
   const skipInit = flags['skip-init'] === 'true';
   const skipRegister = flags['skip-register'] === 'true';

   const ctx = await createPromoAdminContext();
   const [configPda] = await getMmConfigPda(ctx.programId);
   const existing = await readAccountDataRaw(ctx.rpcs.rpc, configPda);

   console.log(`[promo/setup] program ${PROMO_PROGRAM_ID}`);
   console.log(`[promo/setup] admin   ${ctx.signer.address}`);

   if (!skipInit) {
      if (existing !== null) {
         console.log('[promo/setup] config PDA exists — skip init-program (use --skip-init to silence)');
      } else {
         console.log('[promo/setup] init-program…');
         await runPromoInitProgram(ctx, opts);
      }
   } else {
      console.log('[promo/setup] skip init-program');
   }

   let raw = await readAccountDataRaw(ctx.rpcs.rpc, configPda);
   if (raw === null) {
      throw new Error('config PDA still missing after init-program');
   }
   let config = decodePromoConfigAccount(raw);

   if (!config.status) {
      console.log('[promo/setup] activate (update-status)…');
      await runPromoActivate(ctx, opts);
      raw = await readAccountDataRaw(ctx.rpcs.rpc, configPda);
      if (raw !== null) {
         config = decodePromoConfigAccount(raw);
      }
   } else {
      console.log('[promo/setup] already active');
   }

   if (!skipRegister) {
      console.log('[promo/setup] register-mm with aggregator…');
      await runPromoRegisterMm(ctx, opts);
   } else {
      console.log('[promo/setup] skip register-mm');
   }

   const collateralAta = await getAta(configPda);
   console.log('[promo/setup] done');
   console.log(`  config:     ${configPda}`);
   console.log(`  collateral: ${collateralAta}  ← fund USDC here before taking bets`);
   console.log('  next: init-market / set-odds via `bun run promo-admin`');
}

main().catch((error) => {
   console.error(error);
   process.exit(1);
});
