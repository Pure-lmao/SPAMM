import { createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/kit';

export async function loadKeypairSignerFromJsonFile(filePath: string): Promise<KeyPairSigner> {
   const file = Bun.file(filePath);
   console.log('file', filePath);
   const raw = JSON.parse(await file.text()) as number[];
   const secretKeyBytes = Uint8Array.from(raw);
   if (secretKeyBytes.length !== 64) {
      throw new Error(`Expected 64-byte Solana keypair JSON at ${filePath}`);
   }
   return createKeyPairSignerFromBytes(secretKeyBytes);
}
