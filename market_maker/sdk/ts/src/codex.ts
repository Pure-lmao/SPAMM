/**
 * Encoders and decoders for market-maker instruction payloads and on-chain account data.
 *
 * `fill_quote` is **not** exposed here (aggregator CPI only).
 *
 * @see https://www.solanakit.com/docs/concepts/codecs
 */

import {
   fixDecoderSize,
   fixEncoderSize,
   getAddressDecoder,
   getAddressEncoder,
   getBytesDecoder,
   getBytesEncoder,
   type Decoder,
   type Encoder,
   getStructDecoder,
   getStructEncoder,
   getU16Decoder,
   getU16Encoder,
   getU32Decoder,
   getU32Encoder,
   getU64Decoder,
   getU64Encoder,
   getU8Decoder,
   getU8Encoder,
   type ReadonlyUint8Array,
   transformDecoder,
   transformEncoder,
} from '@solana/kit';

import {
   getEventIdDecoder,
   getEventIdEncoder,
   getMarketIdDecoder,
   getMarketIdEncoder,
} from './wire_codecs.js';

import {
   EVENT_ID_WIRE_SIZE,
   EVENT_STATE_LEN,
   GET_QUOTE_IX_WIRE_LEN,
   INIT_PROGRAM_IX_DATA_LEN,
   MARKET_ID_WIRE_SIZE,
   MM_ACCOUNT_CONFIG_MIN_LEN,
   MM_ORACLE_ACCOUNT_LEN_THREE_OUTCOME,
   MM_ORACLE_ACCOUNT_LEN_TWO_OUTCOME,
   MM_QUOTE_BUFFER_LEN,
   UPDATE_ORACLE_IX_PAYLOAD_LEN_THREE_OUTCOME,
   UPDATE_ORACLE_IX_PAYLOAD_LEN_TWO_OUTCOME,
   UPDATE_EVENT_STATE_IX_PAYLOAD_LEN,
   type DecodedMarketMakerInstruction,
   type EventId,
   type EventStateData,
   type GetQuoteIxData,
   type InitProgramIxData,
   type MmAccountConfig,
   type MmOracleMarketData,
   type MmOracleMarketDataThreeOutcome,
   type MmOracleMarketDataTwoOutcome,
   type MmQuoteBuffer,
   MmReturnData,
} from './types.js';

export const UPDATE_ORACLE_BODY_IX_DISCRIMINATOR = 0;
export const INIT_PROGRAM_IX_DISCRIMINATOR = 1;
export const GET_QUOTE_IX_DISCRIMINATOR = 5;
export const INIT_EVENT_IX_DISCRIMINATOR = 7;
export const INIT_MARKET_IX_DISCRIMINATOR = 8;
export const CLOSE_EVENT_IX_DISCRIMINATOR = 9;
export const CLOSE_MARKET_IX_DISCRIMINATOR = 10;
/** `update_event_state` — must match `UPDATE_EVENT_STATE_IX_DISCRIMINATOR` in the MM program. */
export const UPDATE_EVENT_STATE_IX_DISCRIMINATOR = 11;
export const FORCE_CLOSE_PDA_IX_DISCRIMINATOR = 255;

const getBytes32Encoder = () => fixEncoderSize(getBytesEncoder(), 32);
const getBytes32Decoder = () => fixDecoderSize(getBytesDecoder(), 32);

const getBytes32FlexibleEncoder = (): Encoder<ReadonlyUint8Array | Uint8Array> =>
   transformEncoder(getBytes32Encoder(), (v: ReadonlyUint8Array | Uint8Array) => new Uint8Array(v));

const U32_MAX = 0xffff_ffffn;

function assertU32Bigint(label: string, v: bigint): number {
   if (typeof v !== 'bigint') {
      throw new TypeError(`${label} must be a bigint`);
   }
   if (v < 0n || v > U32_MAX) {
      throw new RangeError(`${label} must be in [0, 2**32-1]`);
   }
   return Number(v);
}

const getU32BigintEncoder = (label: string): Encoder<bigint> =>
   transformEncoder(getU32Encoder(), (v: bigint) => assertU32Bigint(label, v));

const getU32BigintDecoder = (): Decoder<bigint> =>
   transformDecoder(getU32Decoder(), (n: number) => BigInt(n >>> 0));

export { encodeEventIdWire, getEventIdDecoder, getEventIdEncoder, getMarketIdDecoder, getMarketIdEncoder } from './wire_codecs.js';


const getMmOracleTwoOutcomeStructEncoder = (): Encoder<Omit<MmOracleMarketDataTwoOutcome, 'kind'>> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['sequence', getU32BigintEncoder('sequence')],
      ['odds0', getU32BigintEncoder('odds0')],
      ['odds1', getU32BigintEncoder('odds1')],
   ]);

const getMmOracleTwoOutcomeStructDecoder = (): Decoder<Omit<MmOracleMarketDataTwoOutcome, 'kind'>> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['sequence', getU32BigintDecoder()],
      ['odds0', getU32BigintDecoder()],
      ['odds1', getU32BigintDecoder()],
   ]);

const getMmOracleThreeOutcomeStructEncoder = (): Encoder<Omit<MmOracleMarketDataThreeOutcome, 'kind'>> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['sequence', getU32BigintEncoder('sequence')],
      ['odds0', getU32BigintEncoder('odds0')],
      ['odds1', getU32BigintEncoder('odds1')],
      ['odds2', getU32BigintEncoder('odds2')],
   ]);

const getMmOracleThreeOutcomeStructDecoder = (): Decoder<Omit<MmOracleMarketDataThreeOutcome, 'kind'>> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['sequence', getU32BigintDecoder()],
      ['odds0', getU32BigintDecoder()],
      ['odds1', getU32BigintDecoder()],
      ['odds2', getU32BigintDecoder()],
   ]);

export function encodeMmOracleMarketDataTwoOutcome(data: Omit<MmOracleMarketDataTwoOutcome, 'kind'>): Uint8Array {
   const out = getMmOracleTwoOutcomeStructEncoder().encode(data);
   if (out.length !== MM_ORACLE_ACCOUNT_LEN_TWO_OUTCOME) {
      throw new RangeError(`oracle two-outcome wire len ${out.length}`);
   }
   return new Uint8Array(out);
}

export function encodeMmOracleMarketDataThreeOutcome(data: Omit<MmOracleMarketDataThreeOutcome, 'kind'>): Uint8Array {
   const out = getMmOracleThreeOutcomeStructEncoder().encode(data);
   if (out.length !== MM_ORACLE_ACCOUNT_LEN_THREE_OUTCOME) {
      throw new RangeError(`oracle three-outcome wire len ${out.length}`);
   }
   return new Uint8Array(out);
}

export function decodeMmOracleMarketData(data: ReadonlyUint8Array): MmOracleMarketData {
   if (data.length === MM_ORACLE_ACCOUNT_LEN_TWO_OUTCOME) {
      const d = getMmOracleTwoOutcomeStructDecoder().decode(new Uint8Array(data));
      return { kind: 'twoOutcome', ...d };
   }
   if (data.length === MM_ORACLE_ACCOUNT_LEN_THREE_OUTCOME) {
      const d = getMmOracleThreeOutcomeStructDecoder().decode(new Uint8Array(data));
      return { kind: 'threeOutcome', ...d };
   }
   throw new RangeError(
      `oracle account len ${data.length}; expected ${MM_ORACLE_ACCOUNT_LEN_TWO_OUTCOME} or ${MM_ORACLE_ACCOUNT_LEN_THREE_OUTCOME}`,
   );
}

export const getMmReturnDataDecoder = (): Decoder<MmReturnData> =>
   getStructDecoder([
      ['maxAmount', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
   ]);

export const getMmReturnDataEncoder = (): Encoder<MmReturnData> =>
   getStructEncoder([
      ['maxAmount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
   ]);

export const getMmQuoteBufferEncoder = (): Encoder<MmQuoteBuffer> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['isUsed', getU8Encoder()],
      ['userAddress', getAddressEncoder()],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['maxAmount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['eventStateHash', getBytes32FlexibleEncoder()],
      ['eventStateSequence', getU16Encoder()],
   ]);

export const getMmQuoteBufferDecoder = (): Decoder<MmQuoteBuffer> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['isUsed', getU8Decoder()],
      ['userAddress', getAddressDecoder()],
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['maxAmount', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['eventStateHash', getBytes32Decoder()],
      ['eventStateSequence', getU16Decoder()],
   ]);

export const getEventStateDataEncoder = (): Encoder<EventStateData> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['eventId', getEventIdEncoder()],
      ['sequence', getU16Encoder()],
      ['stateHash', getBytes32FlexibleEncoder()],
   ]);

export const getEventStateDataDecoder = (): Decoder<EventStateData> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['eventId', getEventIdDecoder()],
      ['sequence', getU16Decoder()],
      ['stateHash', getBytes32Decoder()],
   ]);

export const getMmAccountConfigEncoder = (): Encoder<MmAccountConfig> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['admin', getAddressEncoder()],
   ]);

export const getMmAccountConfigDecoder = (): Decoder<MmAccountConfig> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['admin', getAddressDecoder()],
   ]);

export const getGetQuoteIxDataEncoder = (): Encoder<GetQuoteIxData> =>
   getStructEncoder([
      ['instructionDiscriminator', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['eventStateHash', getBytes32FlexibleEncoder()],
      ['eventStateSequence', getU16Encoder()],
   ]);

export const getGetQuoteIxDataDecoder = (): Decoder<GetQuoteIxData> =>
   getStructDecoder([
      ['instructionDiscriminator', getU8Decoder()],
      ['amount', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['eventStateHash', getBytes32Decoder()],
      ['eventStateSequence', getU16Decoder()],
   ]);

const getInitProgramIxDataEncoder = (): Encoder<InitProgramIxData> =>
   getStructEncoder([['admin', getAddressEncoder()]]);

const getInitProgramIxDataDecoder = (): Decoder<InitProgramIxData> =>
   getStructDecoder([['admin', getAddressDecoder()]]);

function encodeUpdateOraclePayload(
   sequence: bigint,
   odds0: bigint,
   odds1: bigint,
   odds2?: bigint,
): Uint8Array {
   if (odds2 !== undefined) {
      return new Uint8Array(
         getStructEncoder([
            ['sequence', getU32BigintEncoder('sequence')],
            ['odds0', getU32BigintEncoder('odds0')],
            ['odds1', getU32BigintEncoder('odds1')],
            ['odds2', getU32BigintEncoder('odds2')],
         ]).encode({ sequence, odds0, odds1, odds2 }),
      );
   }
   return new Uint8Array(
      getStructEncoder([
         ['sequence', getU32BigintEncoder('sequence')],
         ['odds0', getU32BigintEncoder('odds0')],
         ['odds1', getU32BigintEncoder('odds1')],
      ]).encode({ sequence, odds0, odds1 }),
   );
}

const getUpdateOracleBodyTwoDecoder = (): Decoder<{ sequence: bigint; odds0: bigint; odds1: bigint }> =>
   getStructDecoder([
      ['sequence', getU32BigintDecoder()],
      ['odds0', getU32BigintDecoder()],
      ['odds1', getU32BigintDecoder()],
   ]);

const getUpdateOracleBodyThreeDecoder = (): Decoder<{
   sequence: bigint;
   odds0: bigint;
   odds1: bigint;
   odds2: bigint;
}> =>
   getStructDecoder([
      ['sequence', getU32BigintDecoder()],
      ['odds0', getU32BigintDecoder()],
      ['odds1', getU32BigintDecoder()],
      ['odds2', getU32BigintDecoder()],
   ]);

const getUpdateEventStateIxPayloadEncoder = (): Encoder<{
   eventId: EventId;
   sequence: number;
   stateHash: ReadonlyUint8Array | Uint8Array;
}> =>
   getStructEncoder([
      ['eventId', getEventIdEncoder()],
      ['sequence', getU16Encoder()],
      ['stateHash', getBytes32FlexibleEncoder()],
   ]);

const getUpdateEventStateIxPayloadDecoder = (): Decoder<{
   eventId: EventId;
   sequence: number;
   stateHash: ReadonlyUint8Array;
}> =>
   getStructDecoder([
      ['eventId', getEventIdDecoder()],
      ['sequence', getU16Decoder()],
      ['stateHash', getBytes32Decoder()],
   ]);

function concatDiscriminator(disc: number, payload: ReadonlyUint8Array | Uint8Array): Uint8Array {
   const p = new Uint8Array(payload);
   const out = new Uint8Array(1 + p.length);
   out[0] = disc & 0xff;
   out.set(p, 1);
   return out;
}

export function encodeMarketMakerInstructionData(ix: DecodedMarketMakerInstruction): Uint8Array {
   switch (ix.kind) {
      case 'updateOracle': {
         const p = encodeUpdateOraclePayload(ix.sequence, ix.odds0, ix.odds1, ix.odds2);
         const expected =
            ix.odds2 !== undefined
               ? UPDATE_ORACLE_IX_PAYLOAD_LEN_THREE_OUTCOME
               : UPDATE_ORACLE_IX_PAYLOAD_LEN_TWO_OUTCOME;
         if (p.length !== expected) {
            throw new RangeError(`updateOracleBody payload len ${p.length}; expected ${expected}`);
         }
         return concatDiscriminator(UPDATE_ORACLE_BODY_IX_DISCRIMINATOR, p);
      }
      case 'initProgram': {
         const p = getInitProgramIxDataEncoder().encode(ix.data);
         if (p.length !== INIT_PROGRAM_IX_DATA_LEN) {
            throw new RangeError(`initProgram payload len ${p.length}`);
         }
         return concatDiscriminator(INIT_PROGRAM_IX_DISCRIMINATOR, p);
      }
      case 'getQuote': {
         const out = getGetQuoteIxDataEncoder().encode(ix.data);
         if (out.length !== GET_QUOTE_IX_WIRE_LEN) {
            throw new RangeError(`getQuote wire len ${out.length}`);
         }
         return new Uint8Array(out);
      }
      case 'initEvent': {
         const p = getEventIdEncoder().encode(ix.eventId);
         if (p.length !== EVENT_ID_WIRE_SIZE) {
            throw new RangeError(`event id payload len ${p.length}`);
         }
         return concatDiscriminator(INIT_EVENT_IX_DISCRIMINATOR, p);
      }
      case 'initMarket': {
         const mid = getMarketIdEncoder().encode(ix.marketId);
         if (mid.length !== MARKET_ID_WIRE_SIZE) {
            throw new RangeError(`market id payload len ${mid.length}`);
         }
         const out = new Uint8Array(1 + MARKET_ID_WIRE_SIZE + ix.oracleBody.length);
         out[0] = INIT_MARKET_IX_DISCRIMINATOR & 0xff;
         out.set(new Uint8Array(mid), 1);
         out.set(ix.oracleBody, 1 + MARKET_ID_WIRE_SIZE);
         return out;
      }
      case 'updateEventState': {
         const p = getUpdateEventStateIxPayloadEncoder().encode({
            eventId: ix.eventId,
            sequence: ix.sequence,
            stateHash: ix.stateHash,
         });
         if (p.length !== UPDATE_EVENT_STATE_IX_PAYLOAD_LEN) {
            throw new RangeError(`updateEventState payload len ${p.length}; expected ${UPDATE_EVENT_STATE_IX_PAYLOAD_LEN}`);
         }
         return concatDiscriminator(UPDATE_EVENT_STATE_IX_DISCRIMINATOR, p);
      }
      case 'closeEvent': {
         const p = getEventIdEncoder().encode(ix.eventId);
         if (p.length !== EVENT_ID_WIRE_SIZE) {
            throw new RangeError(`event id payload len ${p.length}`);
         }
         return concatDiscriminator(CLOSE_EVENT_IX_DISCRIMINATOR, p);
      }
      case 'closeMarket': {
         const p = getMarketIdEncoder().encode(ix.marketId);
         if (p.length !== MARKET_ID_WIRE_SIZE) {
            throw new RangeError(`market id payload len ${p.length}`);
         }
         return concatDiscriminator(CLOSE_MARKET_IX_DISCRIMINATOR, p);
      }
      case 'forceClosePda': {
         return concatDiscriminator(FORCE_CLOSE_PDA_IX_DISCRIMINATOR, new Uint8Array([]));
      }
      default: {
         const _exhaustive: never = ix;
         throw new Error(`unreachable: ${String(_exhaustive)}`);
      }
   }
}

export function decodeMarketMakerInstructionData(data: ReadonlyUint8Array): DecodedMarketMakerInstruction {
   if (data.length === 0) {
      throw new RangeError('instruction data empty');
   }
   const disc = data[0]!;
   const rest = data.subarray(1);
   const restBytes = new Uint8Array(rest);
   switch (disc) {
      case UPDATE_ORACLE_BODY_IX_DISCRIMINATOR:
         if (rest.length === UPDATE_ORACLE_IX_PAYLOAD_LEN_TWO_OUTCOME) {
            return {
               kind: 'updateOracle',
               ...getUpdateOracleBodyTwoDecoder().decode(restBytes),
            };
         }
         if (rest.length === UPDATE_ORACLE_IX_PAYLOAD_LEN_THREE_OUTCOME) {
            return {
               kind: 'updateOracle',
               ...getUpdateOracleBodyThreeDecoder().decode(restBytes),
            };
         }
         throw new RangeError(
            `updateOracleBody: expected ${UPDATE_ORACLE_IX_PAYLOAD_LEN_TWO_OUTCOME} or ${UPDATE_ORACLE_IX_PAYLOAD_LEN_THREE_OUTCOME} payload bytes, got ${rest.length}`,
         );
      case INIT_PROGRAM_IX_DISCRIMINATOR:
         if (rest.length !== INIT_PROGRAM_IX_DATA_LEN) {
            throw new RangeError(`initProgram: expected ${INIT_PROGRAM_IX_DATA_LEN} bytes`);
         }
         return { kind: 'initProgram', data: getInitProgramIxDataDecoder().decode(restBytes) };
      case GET_QUOTE_IX_DISCRIMINATOR:
         if (data.length !== GET_QUOTE_IX_WIRE_LEN) {
            throw new RangeError(`getQuote: expected ${GET_QUOTE_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'getQuote', data: getGetQuoteIxDataDecoder().decode(new Uint8Array(data)) };
      case INIT_EVENT_IX_DISCRIMINATOR:
         if (rest.length !== EVENT_ID_WIRE_SIZE) {
            throw new RangeError(`initEvent: expected ${EVENT_ID_WIRE_SIZE} bytes`);
         }
         return { kind: 'initEvent', eventId: getEventIdDecoder().decode(restBytes) };
      case INIT_MARKET_IX_DISCRIMINATOR:
         if (rest.length < MARKET_ID_WIRE_SIZE) {
            throw new RangeError('initMarket: data too short for market_id');
         }
         return {
            kind: 'initMarket',
            marketId: getMarketIdDecoder().decode(restBytes.subarray(0, MARKET_ID_WIRE_SIZE)),
            oracleBody: new Uint8Array(rest.subarray(MARKET_ID_WIRE_SIZE)),
         };
      case UPDATE_EVENT_STATE_IX_DISCRIMINATOR:
         if (rest.length !== UPDATE_EVENT_STATE_IX_PAYLOAD_LEN) {
            throw new RangeError(
               `updateEventState: expected ${UPDATE_EVENT_STATE_IX_PAYLOAD_LEN} bytes, got ${rest.length}`,
            );
         }
         return { kind: 'updateEventState', ...getUpdateEventStateIxPayloadDecoder().decode(restBytes) };
      case CLOSE_EVENT_IX_DISCRIMINATOR:
         if (rest.length !== EVENT_ID_WIRE_SIZE) {
            throw new RangeError(`closeEvent: expected ${EVENT_ID_WIRE_SIZE} bytes`);
         }
         return { kind: 'closeEvent', eventId: getEventIdDecoder().decode(restBytes) };
      case CLOSE_MARKET_IX_DISCRIMINATOR:
         if (rest.length < MARKET_ID_WIRE_SIZE) {
            throw new RangeError('closeMarket: data too short for market_id');
         }
         return {
            kind: 'closeMarket',
            marketId: getMarketIdDecoder().decode(restBytes.subarray(0, MARKET_ID_WIRE_SIZE)),
         };
      default:
         throw new RangeError(`unknown instruction discriminator: ${disc}`);
   }
}

export function encodeGetQuoteIxData(ix: GetQuoteIxData): Uint8Array {
   const out = getGetQuoteIxDataEncoder().encode(ix);
   if (out.length !== GET_QUOTE_IX_WIRE_LEN) {
      throw new RangeError(`get_quote wire len ${out.length}`);
   }
   return new Uint8Array(out);
}

export function decodeGetQuoteIxData(data: ReadonlyUint8Array): GetQuoteIxData {
   if (data.length !== GET_QUOTE_IX_WIRE_LEN) {
      throw new RangeError(`get_quote wire len ${data.length}`);
   }
   return getGetQuoteIxDataDecoder().decode(new Uint8Array(data));
}

export const decodeMmQuoteBuffer = (data: ReadonlyUint8Array): MmQuoteBuffer => {
   if (data.length !== MM_QUOTE_BUFFER_LEN) {
      throw new RangeError(`mm quote buffer len ${data.length}`);
   }
   return getMmQuoteBufferDecoder().decode(new Uint8Array(data));
};

export const decodeEventStateData = (data: ReadonlyUint8Array): EventStateData => {
   if (data.length !== EVENT_STATE_LEN) {
      throw new RangeError(`event state len ${data.length}`);
   }
   return getEventStateDataDecoder().decode(new Uint8Array(data));
};

export const decodeMmAccountConfig = (data: ReadonlyUint8Array): MmAccountConfig => {
   if (data.length < MM_ACCOUNT_CONFIG_MIN_LEN) {
      throw new RangeError(`mm account config len ${data.length}`);
   }
   return getMmAccountConfigDecoder().decode(new Uint8Array(data.subarray(0, MM_ACCOUNT_CONFIG_MIN_LEN)));
};

/** `init_market` / CPI: raw odds body only (8 or 12 bytes), placed after the 8-byte oracle header on-chain. */
export function encodeOracleBodyTwoOutcome(odds0: bigint, odds1: bigint): Uint8Array {
   const enc = getStructEncoder([
      ['odds0', getU32BigintEncoder('odds0')],
      ['odds1', getU32BigintEncoder('odds1')],
   ]);
   return new Uint8Array(enc.encode({ odds0, odds1 }));
}

export function encodeOracleBodyThreeOutcome(odds0: bigint, odds1: bigint, odds2: bigint): Uint8Array {
   const enc = getStructEncoder([
      ['odds0', getU32BigintEncoder('odds0')],
      ['odds1', getU32BigintEncoder('odds1')],
      ['odds2', getU32BigintEncoder('odds2')],
   ]);
   return new Uint8Array(enc.encode({ odds0, odds1, odds2 }));
}
