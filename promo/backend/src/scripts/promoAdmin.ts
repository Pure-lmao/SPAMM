/**
 * Promo MM admin CLI.
 *
 * Setup (run once after deploy):
 *   bun run setup
 *
 * Usage:
 *   bun run promo-admin init-program
 *   bun run promo-admin activate
 *   bun run promo-admin register-mm
 *   bun run promo-admin update-event-state --sport 1 --league 1 --event 12345 --sequence 1
 *   bun run promo-admin init-market --market-key 1:1:123:0:9: --operator <pk> --allow <pk> \
 *     --start 1730000000 --max-usdc 25 --max-total-usdc 100 --odds0 1.90
 *   bun run promo-admin withdraw [--dest <ata>]
 *
 * Global: --dry-run
 */

import './bootstrapEnv';
import { address } from '@solana/kit';
import { decodeMarketKey } from '../marketKey';
import type { MarketId } from '../spammSdk';
import {
   assertPromoMarketParts,
   buildPromoInitMarketFromParts,
   createPromoAdminContext,
   parseEventIdFromFlags,
   parseGameStateFromFlags,
   parseMarketKeyPartsFromFlags,
   promoMarketIdFromParts,
   runPromoActivate,
   runPromoCloseMarketAndEvent,
   runPromoDeactivate,
   runPromoForceCloseQuoteBuffers,
   runPromoBootstrapMarket,
   runPromoInitProgram,
   runPromoRegisterMm,
   runPromoRepairOracleHeader,
   runPromoUpdateEventState,
   runPromoUpdateOracle,
   runPromoWithdraw,
   runPromoWriteConfigRfqSigner,
   runSetMarketMaxAmount,
   runSetMarketMaxTotalAmount,
} from '../adminRun';
import { ODDS_SCALE } from '../constants';
import {
   parseAllowList,
   parseFlags,
   parseOperatorFlag,
   parseSendOptions,
   positionalCommand,
} from './cliFlags';

const HELP = `
promo-admin — promo MM on-chain admin (program ProMo6Ka…)

Setup (preferred):
  bun run setup              init-program + activate + register-mm

Program:
  init-program
  activate | deactivate
  register-mm
  update-event-state       --sport --league --event --sequence N
                           [--time-period PG] [--home N] [--away N]
  init-market              --market-key (mkt must be 9)
                           [--operator pk] (default DEFAULT_MARKET_OPERATOR)
                           [--allow <pk>[,pk…]] (omit = anyone)
                           --start <unix_sec> --max-usdc --max-total-usdc
                           --odds0 <dec|scaled> [--odds1] [--odds2] [--outcomes 2|3]
                           (one tx: init-event → event-state seq 1 PG → init-market → set-odds)
  set-max                  --market-key [--operator] --max-usdc <n>
  set-max-total            --market-key [--operator] --max-total-usdc <n>
  set-odds                 --market-key [--operator] --sequence N --odds0 <dec|scaled> [--odds1] [--odds2]
  repair-oracle-header     --market-key [--operator] [--sequence 1] (ix 254: disc, bump, sequence)
  close-market             --market-key [--operator] (closes market data + event PDAs)
  withdraw                 [--dest <ata>]  (full MM collateral ATA → dest, default admin ATA)
  write-rfq-signer         grow config PDA and write admin pubkey as rfq_signer (ix 254)
  force-close-quote-buffers  close mm_quote_buffer + mm_parlay_quote_buffer (ix 255)

Global:
  --dry-run
`.trim();

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

function requirePromoMarketId(flags: Record<string, string>): MarketId {
   const marketKey = flags['market-key'];
   if (!marketKey) {
      throw new Error('--market-key required');
   }
   const parts = decodeMarketKey(marketKey);
   if (!parts) {
      throw new Error(`invalid market key: ${marketKey}`);
   }
   assertPromoMarketParts(parts);
   return promoMarketIdFromParts(parts, parseOperatorFlag(flags));
}

async function main(): Promise<void> {
   const argv = process.argv.slice(2);
   const flags = parseFlags(argv);
   const cmd = positionalCommand(argv);
   const sendOpts = parseSendOptions(flags);

   if (!cmd || cmd === 'help' || cmd === '--help') {
      console.log(HELP);
      return;
   }

   const ctx = await createPromoAdminContext();

   switch (cmd) {
      case 'init-program':
         await runPromoInitProgram(ctx, sendOpts);
         break;

      case 'activate':
         await runPromoActivate(ctx, sendOpts);
         break;

      case 'deactivate':
         await runPromoDeactivate(ctx, sendOpts);
         break;

      case 'register-mm':
         await runPromoRegisterMm(ctx, sendOpts);
         break;

      case 'update-event-state': {
         const eventId = parseEventIdFromFlags(flags);
         const sequence = Number(flags.sequence);
         if (!Number.isInteger(sequence) || sequence <= 0) {
            throw new Error('update-event-state: --sequence N (N > 0) required');
         }
         await runPromoUpdateEventState(
            ctx,
            eventId,
            sequence,
            parseGameStateFromFlags(flags),
            sendOpts,
         );
         break;
      }

      case 'init-market': {
         const parts = parseMarketKeyPartsFromFlags(flags);
         assertPromoMarketParts(parts);
         const start = flags.start;
         const maxUsdc = flags['max-usdc'];
         const maxTotalUsdc = flags['max-total-usdc'];
         const odds0 = flags.odds0;
         if (!start || !maxUsdc || !maxTotalUsdc || !odds0) {
            throw new Error(
               'init-market: --start, --max-usdc, --max-total-usdc, and --odds0 required',
            );
         }
         const operator = parseOperatorFlag(flags);
         const allowedAccounts = parseAllowList(process.argv.slice(2));
         const outcomes = flags.outcomes === '3' ? 3 : 2;
         const payload = await buildPromoInitMarketFromParts(
            parts,
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
         await runPromoBootstrapMarket(
            ctx,
            {
               payload,
               odds0: o0,
               odds1: o1,
               odds2: o2,
            },
            sendOpts,
         );
         break;
      }

      case 'set-max': {
         const marketId = requirePromoMarketId(flags);
         const maxUsdc = flags['max-usdc'];
         if (!maxUsdc) {
            throw new Error('--max-usdc required');
         }
         await runSetMarketMaxAmount(ctx, marketId, parseUsdc(maxUsdc), sendOpts);
         break;
      }

      case 'set-max-total': {
         const marketId = requirePromoMarketId(flags);
         const maxTotalUsdc = flags['max-total-usdc'];
         if (!maxTotalUsdc) {
            throw new Error('--max-total-usdc required');
         }
         await runSetMarketMaxTotalAmount(ctx, marketId, parseUsdc(maxTotalUsdc), sendOpts);
         break;
      }

      case 'set-odds': {
         const marketId = requirePromoMarketId(flags);
         const seq = flags.sequence;
         const odds0 = flags.odds0;
         if (!seq || !odds0) {
            throw new Error('--sequence and --odds0 required');
         }
         const o0 = parseOdds(odds0);
         const o1 = flags.odds1 ? parseOdds(flags.odds1) : 0n;
         const o2 = flags.odds2 ? parseOdds(flags.odds2) : 0n;
         await runPromoUpdateOracle(ctx, marketId, BigInt(seq), o0, o1, o2, sendOpts);
         break;
      }

      case 'repair-oracle-header': {
         const marketId = requirePromoMarketId(flags);
         const sequence = flags.sequence ? Number(flags.sequence) : 1;
         await runPromoRepairOracleHeader(ctx, marketId, sequence, sendOpts);
         break;
      }

      case 'close-market': {
         const marketId = requirePromoMarketId(flags);
         await runPromoCloseMarketAndEvent(ctx, marketId, sendOpts);
         break;
      }

      case 'withdraw': {
         const dest = flags.dest ? address(flags.dest) : undefined;
         await runPromoWithdraw(ctx, dest, sendOpts);
         break;
      }

      case 'write-rfq-signer':
         await runPromoWriteConfigRfqSigner(ctx, sendOpts);
         break;

      case 'force-close-quote-buffers':
         await runPromoForceCloseQuoteBuffers(ctx, sendOpts);
         break;

      default:
         throw new Error(`unknown command: ${cmd}`);
   }

   console.log(`[promo-admin] ${cmd} ok`);
}

main().catch((error) => {
   console.error(error);
   process.exit(1);
});
