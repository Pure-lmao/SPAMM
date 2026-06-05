import { address, getAddressEncoder } from '@solana/kit';

const DOMAIN = new TextEncoder().encode('spamm-score-predict-entry-id/v1');
const addressEncoder = getAddressEncoder();

/** FNV-1a 64-bit over `data`; result is never `0n`. */
function fnv1a64(data: Uint8Array): bigint {
   let h = 0xcbf29ce484222325n;
   const prime = 0x100000001b3n;
   const mask = 0xffffffffffffffffn;
   for (const b of data) {
      h ^= BigInt(b);
      h = (h * prime) & mask;
   }
   return h === 0n ? 1n : h;
}

/**
 * Stable entry id for tweet + on-chain `prediction_id` from contest, pick, and wallet.
 * Same inputs always yield the same id (including after leaving the page).
 */
export function deterministicPredictionId(
   contestId: number,
   prediction: readonly [number, number],
   ownerAddress: string,
): bigint {
   const ownerBytes = new Uint8Array(addressEncoder.encode(address(ownerAddress)));
   const payload = new Uint8Array(DOMAIN.length + 4 + 2 + ownerBytes.length);
   payload.set(DOMAIN, 0);
   const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
   view.setUint32(DOMAIN.length, contestId >>> 0, true);
   payload[DOMAIN.length + 4] = prediction[0]! & 0xff;
   payload[DOMAIN.length + 5] = prediction[1]! & 0xff;
   payload.set(ownerBytes, DOMAIN.length + 6);
   return fnv1a64(payload);
}
