const BET_ID_RANDOM_EXCLUSIVE_MAX = 1_000_000_000n;
const U64_MAX = 18446744073709551615n;

/** Uniform `0n .. 999_999_999n` via `crypto.getRandomValues`. */
function randomBetIdSuffix(): bigint {
   const buf = new Uint32Array(1);
   crypto.getRandomValues(buf);
   return BigInt(buf[0]! >>> 0) % BET_ID_RANDOM_EXCLUSIVE_MAX;
}

/**
 * On-chain `betId` (`u64`): decimal concat `1` + unix seconds + 9-digit random.
 * Sorts roughly by time; fits in `u64` through year ~2286 (`1` + 10-digit ts + 9-digit random).
 */
export function nextBetId(): bigint {
   const unixSec = BigInt(Math.floor(Date.now() / 1000));
   const suffix = randomBetIdSuffix().toString().padStart(9, "0");
   const id = BigInt(`1${unixSec}${suffix}`);
   if (id > U64_MAX) {
      throw new RangeError("nextBetId: generated id exceeds u64 max");
   }
   return id;
}
