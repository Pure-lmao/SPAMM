const RANDOM_EXCLUSIVE_MAX = 1_000_000_000n;
const U64_MAX = 18446744073709551615n;

function randomSuffix(): bigint {
   const buf = new Uint32Array(1);
   crypto.getRandomValues(buf);
   return BigInt(buf[0]! >>> 0) % RANDOM_EXCLUSIVE_MAX;
}

/** Display / on-chain `prediction_id` for tweet entry line. */
export function nextPredictionId(): bigint {
   const unixSec = BigInt(Math.floor(Date.now() / 1000));
   const suffix = randomSuffix().toString().padStart(9, '0');
   const id = BigInt(`1${unixSec}${suffix}`);
   if (id > U64_MAX) {
      throw new RangeError('nextPredictionId: exceeds u64');
   }
   return id;
}
