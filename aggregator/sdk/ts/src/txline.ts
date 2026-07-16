/**
 * TxLINE (txoracle) helpers for `settle_with_tx_line` — `validate_stat` encoding and PDAs.
 *
 * @see https://txline-docs.txodds.com/documentation/programs/mainnet
 */

import {
   fixDecoderSize,
   fixEncoderSize,
   getArrayDecoder,
   getArrayEncoder,
   getBytesDecoder,
   getBytesEncoder,
   getEnumDecoder,
   getEnumEncoder,
   getI32Decoder,
   getI32Encoder,
   getI64Decoder,
   getI64Encoder,
   getOptionDecoder,
   getOptionEncoder,
   getProgramDerivedAddress,
   getStructDecoder,
   getStructEncoder,
   getU16Encoder,
   getU32Decoder,
   getU32Encoder,
   getU8Decoder,
   getU8Encoder,
   isSome,
   none,
   some,
   address,
   type Address,
   type Decoder,
   type Encoder,
   type ReadonlyUint8Array,
   transformDecoder,
   transformEncoder,
} from '@solana/kit';

/** TxLINE program (mainnet). */
export const TXLINE_PROGRAM_ID: Address = address(
   '9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA',
);

/** TxLINE program (devnet). */
export const TXLINE_PROGRAM_ID_DEVNET: Address = address(
   '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J',
);

/** Maps SPAMM `MarketId.period` → TxLINE score period (`txline.rs::get_required_period`). */
export function getRequiredTxlinePeriod(period: number, sport: number): number {
   if (sport === 1) {
      switch (period) {
         case 0:
            return 100;
         case 1:
            return 5;
         case 2:
            return 3;
         default:
            return 99;
      }
   }
   return 99;
}

/** Anchor `validate_stat` instruction discriminator (IDL v1.4.7). */
export const VALIDATE_STAT_IX_DISCRIMINATOR = [107, 197, 232, 90, 191, 136, 105, 185] as const;

const ANCHOR_IX_DISCRIMINATOR_LEN = 8;
const MS_PER_DAY = 86_400_000;
const u16Encoder = getU16Encoder();

export type Hash32 = Uint8Array & { readonly length: 32 };

export enum BinaryExpression {
   Add = 0,
   Subtract = 1,
}

export enum Comparison {
   GreaterThan = 0,
   LessThan = 1,
   EqualTo = 2,
}

export type ProofNode = {
   hash: Hash32;
   isRightSibling: boolean;
};

export type ScoreStat = {
   key: number;
   value: number;
   period: number;
};

export type ScoresUpdateStats = {
   updateCount: number;
   minTimestamp: bigint;
   maxTimestamp: bigint;
};

export type ScoresBatchSummary = {
   fixtureId: bigint;
   updateStats: ScoresUpdateStats;
   eventsSubTreeRoot: Hash32;
};

export type StatTerm = {
   statToProve: ScoreStat;
   eventStatRoot: Hash32;
   statProof: ProofNode[];
};

export type TraderPredicate = {
   threshold: number;
   comparison: Comparison;
};

export type ValidateStatIxData = {
   ts: bigint;
   fixtureSummary: ScoresBatchSummary;
   fixtureProof: ProofNode[];
   mainTreeProof: ProofNode[];
   predicate: TraderPredicate;
   statA: StatTerm;
   statB: StatTerm | null;
   op: BinaryExpression | null;
};

/** TxLINE `/api/scores/stat-validation` JSON shape (subset used for settlement). */
export type TxlineStatValidationApiResponse = {
   ts: number | bigint;
   summary: {
      fixtureId: number | bigint;
      updateStats: {
         updateCount: number;
         minTimestamp: number | bigint;
         maxTimestamp: number | bigint;
      };
      eventStatsSubTreeRoot: ReadonlyUint8Array | number[];
   };
   subTreeProof: readonly { hash: ReadonlyUint8Array | number[]; isRightSibling: boolean }[];
   mainTreeProof: readonly { hash: ReadonlyUint8Array | number[]; isRightSibling: boolean }[];
   statToProve: ScoreStat;
   statToProve2?: ScoreStat;
   eventStatRoot: ReadonlyUint8Array | number[];
   statProof: readonly { hash: ReadonlyUint8Array | number[]; isRightSibling: boolean }[];
   statProof2?: readonly { hash: ReadonlyUint8Array | number[]; isRightSibling: boolean }[];
};

const getBoolU8Encoder = (): Encoder<boolean> =>
   transformEncoder(getU8Encoder(), (v: boolean) => (v ? 1 : 0));

const getBoolU8Decoder = (): Decoder<boolean> =>
   transformDecoder(getU8Decoder(), (n: number) => {
      if (n !== 0 && n !== 1) {
         throw new RangeError(`boolean wire byte must be 0 or 1, got ${n}`);
      }
      return n !== 0;
   });

const getHash32Encoder = (): Encoder<Hash32> =>
   transformEncoder(fixEncoderSize(getBytesEncoder(), 32), (hash: Hash32) => {
      if (hash.length !== 32) {
         throw new RangeError(`hash must be 32 bytes, got ${hash.length}`);
      }
      return hash;
   });

const getHash32Decoder = (): Decoder<Hash32> =>
   transformDecoder(fixDecoderSize(getBytesDecoder(), 32), (bytes: ReadonlyUint8Array) => new Uint8Array(bytes) as Hash32);

const getScoreStatEncoder = (): Encoder<ScoreStat> =>
   getStructEncoder([
      ['key', getU32Encoder()],
      ['value', getI32Encoder()],
      ['period', getI32Encoder()],
   ]);

const getScoreStatDecoder = (): Decoder<ScoreStat> =>
   getStructDecoder([
      ['key', getU32Decoder()],
      ['value', getI32Decoder()],
      ['period', getI32Decoder()],
   ]);

const getProofNodeEncoder = (): Encoder<ProofNode> =>
   getStructEncoder([
      ['hash', getHash32Encoder()],
      ['isRightSibling', getBoolU8Encoder()],
   ]);

const getProofNodeDecoder = (): Decoder<ProofNode> =>
   getStructDecoder([
      ['hash', getHash32Decoder()],
      ['isRightSibling', getBoolU8Decoder()],
   ]);

const getScoresUpdateStatsEncoder = (): Encoder<ScoresUpdateStats> =>
   getStructEncoder([
      ['updateCount', getI32Encoder()],
      ['minTimestamp', getI64Encoder()],
      ['maxTimestamp', getI64Encoder()],
   ]);

const getScoresUpdateStatsDecoder = (): Decoder<ScoresUpdateStats> =>
   getStructDecoder([
      ['updateCount', getI32Decoder()],
      ['minTimestamp', getI64Decoder()],
      ['maxTimestamp', getI64Decoder()],
   ]);

const getScoresBatchSummaryEncoder = (): Encoder<ScoresBatchSummary> =>
   getStructEncoder([
      ['fixtureId', getI64Encoder()],
      ['updateStats', getScoresUpdateStatsEncoder()],
      ['eventsSubTreeRoot', getHash32Encoder()],
   ]);

const getScoresBatchSummaryDecoder = (): Decoder<ScoresBatchSummary> =>
   getStructDecoder([
      ['fixtureId', getI64Decoder()],
      ['updateStats', getScoresUpdateStatsDecoder()],
      ['eventsSubTreeRoot', getHash32Decoder()],
   ]);

const getStatTermEncoder = (): Encoder<StatTerm> =>
   getStructEncoder([
      ['statToProve', getScoreStatEncoder()],
      ['eventStatRoot', getHash32Encoder()],
      ['statProof', getArrayEncoder(getProofNodeEncoder())],
   ]);

const getStatTermDecoder = (): Decoder<StatTerm> =>
   getStructDecoder([
      ['statToProve', getScoreStatDecoder()],
      ['eventStatRoot', getHash32Decoder()],
      ['statProof', getArrayDecoder(getProofNodeDecoder())],
   ]);

const getNullableStatTermEncoder = (): Encoder<StatTerm | null> =>
   transformEncoder(getOptionEncoder(getStatTermEncoder()), (value: StatTerm | null) =>
      value === null ? none() : some(value),
   );

const getNullableStatTermDecoder = (): Decoder<StatTerm | null> =>
   transformDecoder(getOptionDecoder(getStatTermDecoder()), (value) => (isSome(value) ? value.value : null));

const getNullableBinaryExpressionEncoder = (): Encoder<BinaryExpression | null> =>
   transformEncoder(getOptionEncoder(getEnumEncoder(BinaryExpression)), (value: BinaryExpression | null) =>
      value === null ? none() : some(value),
   );

const getNullableBinaryExpressionDecoder = (): Decoder<BinaryExpression | null> =>
   transformDecoder(getOptionDecoder(getEnumDecoder(BinaryExpression)), (value) =>
      isSome(value) ? value.value : null,
   );

const getTraderPredicateEncoder = (): Encoder<TraderPredicate> =>
   getStructEncoder([
      ['threshold', getI32Encoder()],
      ['comparison', getEnumEncoder(Comparison)],
   ]);

const getTraderPredicateDecoder = (): Decoder<TraderPredicate> =>
   getStructDecoder([
      ['threshold', getI32Decoder()],
      ['comparison', getEnumDecoder(Comparison)],
   ]);

const getValidateStatIxPayloadEncoder = (): Encoder<ValidateStatIxData> =>
   getStructEncoder([
      ['ts', getI64Encoder()],
      ['fixtureSummary', getScoresBatchSummaryEncoder()],
      ['fixtureProof', getArrayEncoder(getProofNodeEncoder())],
      ['mainTreeProof', getArrayEncoder(getProofNodeEncoder())],
      ['predicate', getTraderPredicateEncoder()],
      ['statA', getStatTermEncoder()],
      ['statB', getNullableStatTermEncoder()],
      ['op', getNullableBinaryExpressionEncoder()],
   ]);

const getValidateStatIxPayloadDecoder = (): Decoder<ValidateStatIxData> =>
   getStructDecoder([
      ['ts', getI64Decoder()],
      ['fixtureSummary', getScoresBatchSummaryDecoder()],
      ['fixtureProof', getArrayDecoder(getProofNodeDecoder())],
      ['mainTreeProof', getArrayDecoder(getProofNodeDecoder())],
      ['predicate', getTraderPredicateDecoder()],
      ['statA', getStatTermDecoder()],
      ['statB', getNullableStatTermDecoder()],
      ['op', getNullableBinaryExpressionDecoder()],
   ]);

function concatAnchorDiscriminator(disc: readonly number[], payload: ReadonlyUint8Array | Uint8Array): Uint8Array {
   const p = new Uint8Array(payload);
   const out = new Uint8Array(ANCHOR_IX_DISCRIMINATOR_LEN + p.length);
   out.set(disc, 0);
   out.set(p, ANCHOR_IX_DISCRIMINATOR_LEN);
   return out;
}

function discriminatorMatches(data: ReadonlyUint8Array, disc: readonly number[]): boolean {
   if (data.length < ANCHOR_IX_DISCRIMINATOR_LEN) {
      return false;
   }
   for (let i = 0; i < ANCHOR_IX_DISCRIMINATOR_LEN; i++) {
      if (data[i] !== disc[i]) {
         return false;
      }
   }
   return true;
}

function ixPayload(data: ReadonlyUint8Array): Uint8Array {
   return new Uint8Array(data.subarray(ANCHOR_IX_DISCRIMINATOR_LEN));
}

export function encodeValidateStatIxData(data: ValidateStatIxData): Uint8Array {
   return concatAnchorDiscriminator(VALIDATE_STAT_IX_DISCRIMINATOR, getValidateStatIxPayloadEncoder().encode(data));
}

export function decodeValidateStatIxData(data: ReadonlyUint8Array): ValidateStatIxData {
   if (!discriminatorMatches(data, VALIDATE_STAT_IX_DISCRIMINATOR)) {
      throw new RangeError('not a validate_stat instruction');
   }
   return getValidateStatIxPayloadDecoder().decode(ixPayload(data));
}

/** Coerce API proof-node hashes (number[] or bytes) into fixed 32-byte wire form. */
export function hash32FromBytes(bytes: ReadonlyUint8Array | number[]): Hash32 {
   const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
   if (arr.length !== 32) {
      throw new RangeError(`hash must be 32 bytes, got ${arr.length}`);
   }
   return arr as Hash32;
}

export function proofNodeFromApi(node: { hash: ReadonlyUint8Array | number[]; isRightSibling: boolean }): ProofNode {
   return {
      hash: hash32FromBytes(node.hash),
      isRightSibling: node.isRightSibling,
   };
}

/** Epoch day index from a millisecond timestamp (matches TxLINE API / on-chain). */
export function epochDayFromTsMs(tsMs: number | bigint): number {
   return Math.floor(Number(tsMs) / MS_PER_DAY);
}

export async function getDailyScoresRootsPda(
   epochDay: number,
   programId: Address = TXLINE_PROGRAM_ID,
): Promise<readonly [Address, number]> {
   return getProgramDerivedAddress({
      programAddress: programId,
      seeds: ['daily_scores_roots', new Uint8Array(u16Encoder.encode(epochDay))],
   });
}

export async function getDailyScoresRootsPdaFromTs(
   tsMs: number | bigint,
   programId: Address = TXLINE_PROGRAM_ID,
): Promise<readonly [Address, number]> {
   return getDailyScoresRootsPda(epochDayFromTsMs(tsMs), programId);
}

/** Map TxLINE stat-validation API JSON + predicate into `ValidateStatIxData`. */
export function validateStatIxDataFromApiResponse(
   validation: TxlineStatValidationApiResponse,
   predicate: TraderPredicate,
   options?: {
      statKey2?: number;
      op?: BinaryExpression;
   },
): ValidateStatIxData {
   const twoStat = options?.statKey2 != null;
   if (twoStat && validation.statToProve2 == null) {
      throw new Error('statKey2 requested but API returned no statToProve2');
   }

   const eventStatRoot = hash32FromBytes(validation.eventStatRoot);
   return {
      ts: BigInt(validation.summary.updateStats.minTimestamp),
      fixtureSummary: {
         fixtureId: BigInt(validation.summary.fixtureId),
         updateStats: {
            updateCount: validation.summary.updateStats.updateCount,
            minTimestamp: BigInt(validation.summary.updateStats.minTimestamp),
            maxTimestamp: BigInt(validation.summary.updateStats.maxTimestamp),
         },
         eventsSubTreeRoot: hash32FromBytes(validation.summary.eventStatsSubTreeRoot),
      },
      fixtureProof: validation.subTreeProof.map(proofNodeFromApi),
      mainTreeProof: validation.mainTreeProof.map(proofNodeFromApi),
      predicate,
      statA: {
         statToProve: validation.statToProve,
         eventStatRoot,
         statProof: validation.statProof.map(proofNodeFromApi),
      },
      statB: twoStat
         ? {
              statToProve: validation.statToProve2!,
              eventStatRoot,
              statProof: (validation.statProof2 ?? []).map(proofNodeFromApi),
           }
         : null,
      op: twoStat ? (options?.op ?? BinaryExpression.Subtract) : null,
   };
}

/** `home_goals > away_goals` — stat keys 1 and 2, subtract, threshold 0, gt. */
export const HOME_BEATS_AWAY_PREDICATE: TraderPredicate = {
   threshold: 0,
   comparison: Comparison.GreaterThan,
};

/** `home_goals <= away_goals` — stat keys 1 and 2, subtract, threshold 1, lt. */
export const HOME_NOT_BEATS_AWAY_PREDICATE: TraderPredicate = {
   threshold: 1,
   comparison: Comparison.LessThan,
};

/** `home_goals == away_goals` — stat keys 1 and 2, subtract, threshold 0, eq. */
export const HOME_EQUALS_AWAY_PREDICATE: TraderPredicate = {
   threshold: 0,
   comparison: Comparison.EqualTo,
};
