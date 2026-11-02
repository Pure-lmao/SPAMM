import { createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/kit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


export async function loadKeypairSignerFromJsonFile(filePath: string): Promise<KeyPairSigner> {
   const file = Bun.file(filePath);
   const raw = JSON.parse(await file.text()) as number[];
   const secretKeyBytes = Uint8Array.from(raw);
   if (secretKeyBytes.length !== 64) {
      throw new Error(`Expected 64-byte Solana keypair JSON at ${filePath}`);
   }
   return createKeyPairSignerFromBytes(secretKeyBytes);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MARKET_OPERATOR_SIGNER = await loadKeypairSignerFromJsonFile(
   path.join(__dirname, 'YLmo_admin_keypair.json'),
);

export const PROMO_ADMIN_SIGNER = await loadKeypairSignerFromJsonFile(
   path.join(__dirname, 'market_maker/client/admin_keypair.json'),
);