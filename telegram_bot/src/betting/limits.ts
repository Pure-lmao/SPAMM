import type { Address } from "@solana/kit";

export type Limits = {
   minLegs: number;
   minOddsScaled: bigint;
   maxOddsScaled: bigint;
   allowedMms: readonly Address[];
   allowedOperators: readonly Address[];
};
