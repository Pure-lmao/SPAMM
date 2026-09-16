/**
 * Read promo MM on-chain config + collateral ATA.
 *
 *   bun run get-config
 *   bun run get-config -- --json
 */

import './bootstrapEnv';
import { createPromoAdminContext } from '../adminRun';
import { decodePromoConfigAccount } from '../codex';
import { PROMO_PROGRAM_ID } from '../constants';
import { getAta, getMmConfigPda, readAccountDataRaw } from '../spammSdk';
import { parseFlags } from './cliFlags';

async function main(): Promise<void> {
   const flags = parseFlags(process.argv.slice(2));
   const ctx = await createPromoAdminContext();
   const [configPda, bump] = await getMmConfigPda(ctx.programId);
   const collateralAta = await getAta(configPda);
   const raw = await readAccountDataRaw(ctx.rpcs.rpc, configPda);

   if (raw === null) {
      console.error(`config PDA missing: ${configPda}`);
      console.error('run: bun run setup');
      process.exit(1);
   }

   const config = decodePromoConfigAccount(raw);
   const out = {
      programId: PROMO_PROGRAM_ID,
      configPda,
      configBump: bump,
      dataLen: raw.length,
      admin: config.admin,
      rfqSigner: config.rfqSigner,
      status: config.status,
      collateralAta,
      signer: ctx.signer.address,
   };

   if (flags.json === 'true') {
      console.log(JSON.stringify(out, null, 2));
      return;
   }

   console.log(`program:       ${out.programId}`);
   console.log(`config PDA:    ${configPda} (bump ${bump})`);
   console.log(`data len:      ${out.dataLen}`);
   console.log(`admin:         ${config.admin}`);
   console.log(`rfq signer:    ${config.rfqSigner}`);
   console.log(`status:        ${config.status ? 'active' : 'inactive'}`);
   console.log(`collateral:    ${collateralAta}`);
   console.log(`signer:        ${ctx.signer.address}`);
   if (config.admin !== ctx.signer.address) {
      console.warn('warning: signer does not match config.admin');
   }
}

main().catch((error) => {
   console.error(error);
   process.exit(1);
});
