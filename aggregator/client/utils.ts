import {
   type Address,
   createKeyPairSignerFromBytes,
   getAddressEncoder,
   getBase58Encoder,
   type KeyPairSigner,
   type ReadonlyUint8Array,
} from '@solana/kit';

const addressEncoder = getAddressEncoder();

function convertAddressToArray(address: Address): ReadonlyUint8Array {
   return addressEncoder.encode(address);
}

/** Bytes for `Address::new_from_array([` … `]);` — paste between `[` and `]`. */
function formatAddressAsRustNewFromArrayBody(address: Address): string {
   const bytes = convertAddressToArray(address);
   return `${Array.from(bytes, b => `0x${b.toString(16).padStart(2, '0')}`).join(', ')},`;
}
// const [addr] = await getMmParlayQuoteBufferPda("WCMM5EzCxZAEC3JhMa7zt3mTJ6jUGJCf7BB26Tw87jr" as Address);
// console.log(addr);
// console.log(formatAddressAsRustNewFromArrayBody("3z6QBMEUjJubCwbKUsMKFnKnf1twyc5bZ9gaWHNAn1nP" as Address));

const pkString = '';
/** Base58-encoded 32-byte seed or 64-byte secret key (wallet export format). */
function convertPkStringToArray(pkString: string): Uint8Array {
   const bytes = new Uint8Array(getBase58Encoder().encode(pkString));
   if (bytes.length !== 32 && bytes.length !== 64) {
      throw new Error(`Expected base58 secret to decode to 32 or 64 bytes, got ${bytes.length}`);
   }
   return bytes;
}
// console.log(convertPkStringToArray(pkString));

export async function loadKeypairSignerFromJsonFile(filePath: string): Promise<KeyPairSigner> {
   const file = Bun.file(filePath);
   const raw = JSON.parse(await file.text()) as number[];
   const secretKeyBytes = Uint8Array.from(raw);
   if (secretKeyBytes.length !== 64) {
      throw new Error(`Expected 64-byte Solana keypair JSON at ${filePath}`);
   }
   return createKeyPairSignerFromBytes(secretKeyBytes);
}