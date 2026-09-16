import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** `promo/backend/src/scripts` → `promo/backend`. */
const PROMO_BACKEND_ROOT = resolve(import.meta.dir, '../..');
const API_ROOT = resolve(import.meta.dir, '../../../../api');

function loadEnvFile(filePath: string): void {
   if (!existsSync(filePath)) {
      return;
   }
   for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
         continue;
      }
      const eq = trimmed.indexOf('=');
      if (eq <= 0) {
         continue;
      }
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key] !== undefined) {
         continue;
      }
      let value = trimmed.slice(eq + 1).trim();
      if (
         (value.startsWith('"') && value.endsWith('"')) ||
         (value.startsWith("'") && value.endsWith("'"))
      ) {
         value = value.slice(1, -1);
      }
      process.env[key] = value;
   }
}

loadEnvFile(resolve(PROMO_BACKEND_ROOT, '.env'));
loadEnvFile(resolve(API_ROOT, '.env'));
