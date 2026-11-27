import { getEventGameState } from "spamm-aggregator-sdk";

export const EVENT_GAME_STATE_PG = getEventGameState("PG", 0, 0, 0, 0);
export const DEFAULT_EVENT_STATE_SEQUENCE = 1;

const BET_ID_RANDOM_EXCLUSIVE_MAX = 1_000_000_000n;
const U64_MAX = 18446744073709551615n;

function randomBetIdSuffix(): bigint {
   const buf = new Uint32Array(1);
   crypto.getRandomValues(buf);
   return BigInt(buf[0]! >>> 0) % BET_ID_RANDOM_EXCLUSIVE_MAX;
}

export function nextBetId(): bigint {
   const unixSec = BigInt(Math.floor(Date.now() / 1000));
   const suffix = randomBetIdSuffix().toString().padStart(9, "0");
   const id = BigInt(`1${unixSec}${suffix}`);
   if (id > U64_MAX) {
      throw new RangeError("nextBetId exceeds u64");
   }
   return id;
}
