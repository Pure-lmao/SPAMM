import { address, type Address } from '@solana/kit';
import type { SendAdminOptions } from '../adminRun';
import { DEFAULT_MARKET_OPERATOR } from '../constants';
import { MAX_PROMO_ALLOWED } from '../codex';

export function parseFlags(argv: string[]): Record<string, string> {
   const out: Record<string, string> = {};
   for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!;
      if (!arg.startsWith('--')) {
         continue;
      }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
         out[key] = next;
         i++;
      } else {
         out[key] = 'true';
      }
   }
   return out;
}

export function parseSendOptions(flags: Record<string, string>): SendAdminOptions {
   return {
      dryRun: flags['dry-run'] === 'true' || flags['dry-run'] === '1' || flags.dry === 'true',
   };
}

export function positionalCommand(argv: string[]): string | undefined {
   return argv.find((a) => !a.startsWith('--'));
}

export function parseOperatorFlag(flags: Record<string, string>): Address {
   const raw = flags.operator?.trim();
   if (!raw) {
      return DEFAULT_MARKET_OPERATOR;
   }
   return address(raw);
}

/** `--allow <pk>` (repeatable) and/or comma-separated `--allow a,b`. */
export function parseAllowList(argv: string[]): Address[] {
   const out: Address[] = [];
   const seen = new Set<string>();
   for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!;
      if (arg !== '--allow' && arg !== '--allowed') {
         continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
         throw new Error('--allow requires one or more comma-separated pubkeys');
      }
      i++;
      for (const part of next.split(',')) {
         const trimmed = part.trim();
         if (!trimmed) {
            continue;
         }
         const pk = address(trimmed);
         if (seen.has(pk)) {
            continue;
         }
         seen.add(pk);
         out.push(pk);
      }
   }
   if (out.length > MAX_PROMO_ALLOWED) {
      throw new Error(`--allow list too long (${out.length} > ${MAX_PROMO_ALLOWED})`);
   }
   return out;
}
