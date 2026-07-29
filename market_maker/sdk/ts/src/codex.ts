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
   FILL_QUOTE_PARLAY_IX_WIRE_LEN,
   GET_QUOTE_IX_WIRE_LEN,
   GET_QUOTE_PARLAY_IX_WIRE_LEN,
   INIT_PROGRAM_IX_DATA_LEN,
   MARKET_ID_WIRE_SIZE,
   MAX_PARLAY_LEGS,
   MM_ACCOUNT_CONFIG_MIN_LEN,
   MM_ORACLE_ACCOUNT_LEN_THREE_OUTCOME,
   MM_ORACLE_ACCOUNT_LEN_TWO_OUTCOME,
   MM_PARLAY_QUOTE_BUFFER_LEN,
   MM_QUOTE_BUFFER_LEN,
   PARLAY_LEG_TABLE_LEN,
   PARLAY_LEG_WIRE_LEN,
   FILL_RFQ_IX_WIRE_LEN,
   SET_RFQ_SIGNER_IX_DATA_LEN,
   UPDATE_ORACLE_IX_PAYLOAD_LEN_THREE_OUTCOME,
   UPDATE_ORACLE_IX_PAYLOAD_LEN_TWO_OUTCOME,
   UPDATE_EVENT_STATE_IX_PAYLOAD_LEN,
   type DecodedMarketMakerInstruction,
   type EventGameState,
   type EventId,
   type EventStateData,
   type FillParlayQuoteIxData,
   type FillRfqIxData,
   type GetQuoteIxData,
   type GetQuoteParlayIxData,
   type InitProgramIxData,
   type SetRfqSignerIxData,
   type MmAccountConfig,
   type MmOracleMarketData,
   type MmOracleMarketDataThreeOutcome,
   type MmOracleMarketDataTwoOutcome,
   type MmParlayQuoteBuffer,
   type MmQuoteBuffer,
   type ParlayLegWire,
   type MmReturnData,
   type GetParlayQuoteReturnWire,
   PARLAY_QUOTE_RETURN_WIRE_LEN,
} from './types.js';

import { validateFillParlayQuoteIxData, validateGetQuoteParlayIxData } from './validate.js';

export const UPDATE_ORACLE_BODY_IX_DISCRIMINATOR = 0;
export const INIT_PROGRAM_IX_DISCRIMINATOR = 1;
export const GET_QUOTE_IX_DISCRIMINATOR = 5;
export const GET_QUOTE_PARLAY_IX_DISCRIMINATOR = 7;
export const FILL_QUOTE_PARLAY_IX_DISCRIMINATOR = 8;
export const MM_FILL_BET_RFQ_IX_DISCRIMINATOR = 14;
export const MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR = 16;
export const SET_RFQ_SIGNER_IX_DISCRIMINATOR = 15;
export const INIT_EVENT_IX_DISCRIMINATOR = 9;
export const INIT_MARKET_IX_DISCRIMINATOR = 10;
export const CLOSE_EVENT_IX_DISCRIMINATOR = 11;
export const CLOSE_MARKET_IX_DISCRIMINATOR = 12;
/** `update_event_state` — must match `UPDATE_EVENT_STATE_IX_DISCRIMINATOR` in the MM program. */
export const UPDATE_EVENT_STATE_IX_DISCRIMINATOR = 13;
export const WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR = 254;
export const FORCE_CLOSE_PDA_IX_DISCRIMINATOR = 255;

/** Rust `EventGameState.game_phase` (`other.rs`). Space (U+0020) is stored as byte `0`; decode maps `0` → space, then trims trailing spaces. */
function encodeGamePhaseAscii4(phase: string): Uint8Array {
   const out = new Uint8Array(4);
   if (phase.length > 4) {
      throw new RangeError(`gamePhase must be at most 4 ASCII characters (got length ${phase.length})`);
   }
   for (let i = 0; i < phase.length; i++) {
      const c = phase.charCodeAt(i)!;
      if (c > 127) {
         throw new RangeError(`gamePhase must be ASCII (code ${c} at index ${i})`);
      }
      out[i] = c === 32 ? 0 : c;
   }
   return out;
}

function decodeGamePhaseAscii4(bytes: ReadonlyUint8Array): string {
   if (bytes.length !== 4) {
      throw new RangeError('gamePhase wire must be 4 bytes');
   }
   let s = '';
   for (let i = 0; i < 4; i++) {
      const b = bytes[i]!;
      s += String.fromCharCode(b === 0 ? 32 : b);
   }
   while (s.length > 0 && s.charCodeAt(s.length - 1) === 32) {
      s = s.slice(0, -1);
   }
   return s;
}

const getGamePhaseAscii4Encoder = (): Encoder<string> =>
   fixEncoderSize(transformEncoder(getBytesEncoder(), (str: string) => encodeGamePhaseAscii4(str)), 4);

const getGamePhaseAscii4Decoder = (): Decoder<string> =>
   transformDecoder(fixDecoderSize(getBytesDecoder(), 4), decodeGamePhaseAscii4);

export const getEventGameStateEncoder = (): Encoder<EventGameState> =>
   getStructEncoder([
      ['gamePhase', getGamePhaseAscii4Encoder()],
      ['homePrimary', getU8Encoder()],
      ['awayPrimary', getU8Encoder()],
      ['homeSecondary', getU8Encoder()],
      ['awaySecondary', getU8Encoder()],
   ]);

export const getEventGameStateDecoder = (): Decoder<EventGameState> =>
   getStructDecoder([
      ['gamePhase', getGamePhaseAscii4Decoder()],
      ['homePrimary', getU8Decoder()],
      ['awayPrimary', getU8Decoder()],
      ['homeSecondary', getU8Decoder()],
      ['awaySecondary', getU8Decoder()],
   ]);

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

const getGetParlayQuoteReturnWireDecoder = (): Decoder<GetParlayQuoteReturnWire> =>
   transformDecoder(
      getStructDecoder([
         ['maxAmount', getU64Decoder()],
         ['oddsScaled', getU32BigintDecoder()],
         ['numLegs', getU8Decoder()],
         ['legOdds0', getU32BigintDecoder()],
         ['legOdds1', getU32BigintDecoder()],
         ['legOdds2', getU32BigintDecoder()],
         ['legOdds3', getU32BigintDecoder()],
         ['legOdds4', getU32BigintDecoder()],
      ]),
      (row) => ({
         maxAmount: row.maxAmount,
         oddsScaled: row.oddsScaled,
         numLegs: row.numLegs,
         legOdds: [row.legOdds0, row.legOdds1, row.legOdds2, row.legOdds3, row.legOdds4],
      }),
   );

/** Return data from MM `get_quote_parlay` (`GetParlayQuoteReturnWire`). */
export function decodeGetParlayQuoteReturnWire(data: ReadonlyUint8Array): GetParlayQuoteReturnWire {
   if (data.length !== PARLAY_QUOTE_RETURN_WIRE_LEN) {
      throw new RangeError(
         `get_parlay_quote return data len ${data.length}; expected ${PARLAY_QUOTE_RETURN_WIRE_LEN}`,
      );
   }
   return getGetParlayQuoteReturnWireDecoder().decode(new Uint8Array(data));
}

export const getMmQuoteBufferEncoder = (): Encoder<MmQuoteBuffer> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['isUsed', getU8Encoder()],
      ['userAddress', getAddressEncoder()],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['maxAmount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['eventGameState', getEventGameStateEncoder()],
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
      ['eventGameState', getEventGameStateDecoder()],
      ['eventStateSequence', getU16Decoder()],
   ]);

export const getEventStateDataEncoder = (): Encoder<EventStateData> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['eventId', getEventIdEncoder()],
      ['sequence', getU16Encoder()],
      ['gameState', getEventGameStateEncoder()],
   ]);

export const getEventStateDataDecoder = (): Decoder<EventStateData> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['eventId', getEventIdDecoder()],
      ['sequence', getU16Decoder()],
      ['gameState', getEventGameStateDecoder()],
   ]);

export const getMmAccountConfigEncoder = (): Encoder<MmAccountConfig> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['admin', getAddressEncoder()],
      ['rfqSigner', getAddressEncoder()],
   ]);

export const getMmAccountConfigDecoder = (): Decoder<MmAccountConfig> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['admin', getAddressDecoder()],
      ['rfqSigner', getAddressDecoder()],
   ]);

export const getGetQuoteIxDataEncoder = (): Encoder<GetQuoteIxData> =>
   getStructEncoder([
      ['instructionDiscriminator', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['eventStateSequence', getU16Encoder()],
   ]);

export const getGetQuoteIxDataDecoder = (): Decoder<GetQuoteIxData> =>
   getStructDecoder([
      ['instructionDiscriminator', getU8Decoder()],
      ['amount', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
      ['eventStateSequence', getU16Decoder()],
   ]);

export const getParlayLegWireEncoder = (): Encoder<ParlayLegWire> =>
   getStructEncoder([
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['result', getU8Encoder()],
   ]);

export const getParlayLegWireDecoder = (): Decoder<ParlayLegWire> =>
   getStructDecoder([
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['result', getU8Decoder()],
   ]);

/** Pad `ParlayLegTable` wire to `MAX_PARLAY_LEGS` slots; unused slots are zero. */
function padParlayLegTableBytes(legs: readonly ParlayLegWire[], numLegs: number): Uint8Array {
   if (numLegs < 1 || numLegs > MAX_PARLAY_LEGS || legs.length < numLegs) {
      throw new RangeError('padParlayLegTableBytes: invalid legs / numLegs');
   }
   const enc = getParlayLegWireEncoder();
   const out = new Uint8Array(PARLAY_LEG_TABLE_LEN);
   let o = 0;
   for (let i = 0; i < MAX_PARLAY_LEGS; i++) {
      if (i < numLegs) {
         out.set(enc.encode(legs[i]!), o);
      }
      o += PARLAY_LEG_WIRE_LEN;
   }
   return out;
}

function decodeParlayLegTableBytes(table: Uint8Array): ParlayLegWire[] {
   if (table.length !== PARLAY_LEG_TABLE_LEN) {
      throw new RangeError(`parlay leg table len ${table.length}`);
   }
   const dec = getParlayLegWireDecoder();
   const legs: ParlayLegWire[] = [];
   for (let i = 0; i < MAX_PARLAY_LEGS; i++) {
      const slice = table.subarray(i * PARLAY_LEG_WIRE_LEN, (i + 1) * PARLAY_LEG_WIRE_LEN);
      legs.push(dec.decode(slice));
   }
   return legs;
}

export function encodeGetQuoteParlayIxData(ix: GetQuoteParlayIxData): Uint8Array {
   validateGetQuoteParlayIxData(ix);
   if (ix.instructionDiscriminator !== GET_QUOTE_PARLAY_IX_DISCRIMINATOR) {
      throw new RangeError(`get_quote_parlay instructionDiscriminator must be ${GET_QUOTE_PARLAY_IX_DISCRIMINATOR}`);
   }
   const out = new Uint8Array(GET_QUOTE_PARLAY_IX_WIRE_LEN);
   out[0] = ix.instructionDiscriminator & 0xff;
   const dv = new DataView(out.buffer);
   dv.setBigUint64(1, ix.amount, true);
   dv.setUint32(9, assertU32Bigint('oddsScaled', ix.oddsScaled), true);
   out[13] = ix.numLegs & 0xff;
   out.set(padParlayLegTableBytes(ix.legs, ix.numLegs), 14);
   return out;
}

export function decodeGetQuoteParlayIxData(data: ReadonlyUint8Array): GetQuoteParlayIxData {
   if (data.length !== GET_QUOTE_PARLAY_IX_WIRE_LEN) {
      throw new RangeError(`get_quote_parlay wire len ${data.length}`);
   }
   const u8 = new Uint8Array(data);
   const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
   const instructionDiscriminator = u8[0]!;
   const amount = dv.getBigUint64(1, true);
   const oddsScaled = BigInt(dv.getUint32(9, true) >>> 0);
   const numLegs = u8[13]!;
   if (numLegs < 2 || numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`get_quote_parlay numLegs invalid: ${numLegs}`);
   }
   const allLegs = decodeParlayLegTableBytes(u8.subarray(14, 14 + PARLAY_LEG_TABLE_LEN));
   return {
      instructionDiscriminator,
      amount,
      oddsScaled,
      numLegs,
      legs: allLegs.slice(0, numLegs),
   };
}

export function encodeFillParlayQuoteIxData(ix: FillParlayQuoteIxData): Uint8Array {
   validateFillParlayQuoteIxData(ix);
   if (ix.instructionDiscriminator !== FILL_QUOTE_PARLAY_IX_DISCRIMINATOR) {
      throw new RangeError(`fill_parlay_quote instructionDiscriminator must be ${FILL_QUOTE_PARLAY_IX_DISCRIMINATOR}`);
   }
   const out = new Uint8Array(FILL_QUOTE_PARLAY_IX_WIRE_LEN);
   out[0] = ix.instructionDiscriminator & 0xff;
   const dv = new DataView(out.buffer);
   dv.setBigUint64(1, ix.amountToFill, true);
   dv.setUint32(9, assertU32Bigint('oddsScaled', ix.oddsScaled), true);
   dv.setBigUint64(13, ix.amountToSend, true);
   return out;
}

export function decodeFillParlayQuoteIxData(data: ReadonlyUint8Array): FillParlayQuoteIxData {
   if (data.length !== FILL_QUOTE_PARLAY_IX_WIRE_LEN) {
      throw new RangeError(`fill_parlay_quote wire len ${data.length}`);
   }
   const u8 = new Uint8Array(data);
   const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
   return {
      instructionDiscriminator: u8[0]!,
      amountToFill: dv.getBigUint64(1, true),
      oddsScaled: BigInt(dv.getUint32(9, true) >>> 0),
      amountToSend: dv.getBigUint64(13, true),
   };
}

export function decodeMmParlayQuoteBuffer(data: ReadonlyUint8Array): MmParlayQuoteBuffer {
   if (data.length !== MM_PARLAY_QUOTE_BUFFER_LEN) {
      throw new RangeError(`mm parlay quote buffer len ${data.length}`);
   }
   const u8 = new Uint8Array(data);
   const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
   const discriminator = u8[0]!;
   const isUsed = u8[1]!;
   const userSlice = u8.subarray(2, 34);
   const userAddress = getAddressDecoder().decode(userSlice);
   const maxAmount = dv.getBigUint64(34, true);
   const oddsScaled = BigInt(dv.getUint32(42, true) >>> 0);
   const numLegs = u8[46]!;
   const allLegs = decodeParlayLegTableBytes(u8.subarray(47, 47 + PARLAY_LEG_TABLE_LEN));
   return {
      discriminator,
      isUsed,
      userAddress,
      maxAmount,
      oddsScaled,
      numLegs,
      legs: allLegs.slice(0, Math.min(numLegs, MAX_PARLAY_LEGS)),
   };
}

const getInitProgramIxDataEncoder = (): Encoder<InitProgramIxData> =>
   getStructEncoder([
      ['admin', getAddressEncoder()],
      ['rfqSigner', getAddressEncoder()],
   ]);

const getInitProgramIxDataDecoder = (): Decoder<InitProgramIxData> =>
   getStructDecoder([
      ['admin', getAddressDecoder()],
      ['rfqSigner', getAddressDecoder()],
   ]);

const getSetRfqSignerIxDataEncoder = (): Encoder<SetRfqSignerIxData> =>
   getStructEncoder([['rfqSigner', getAddressEncoder()]]);

const getSetRfqSignerIxDataDecoder = (): Decoder<SetRfqSignerIxData> =>
   getStructDecoder([['rfqSigner', getAddressDecoder()]]);

export function encodeFillRfqIxData(ix: FillRfqIxData): Uint8Array {
   const out = new Uint8Array(FILL_RFQ_IX_WIRE_LEN);
   out[0] = ix.instructionDiscriminator & 0xff;
   out.set(getU64Encoder().encode(ix.amountToSend), 1);
   return out;
}

export function decodeFillRfqIxData(data: ReadonlyUint8Array): FillRfqIxData {
   if (data.length !== FILL_RFQ_IX_WIRE_LEN) {
      throw new RangeError(`fillRfq wire len ${data.length}`);
   }
   return {
      instructionDiscriminator: data[0]!,
      amountToSend: getU64Decoder().decode(data.subarray(1)),
   };
}

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
   gameState: EventGameState;
}> =>
   getStructEncoder([
      ['eventId', getEventIdEncoder()],
      ['sequence', getU16Encoder()],
      ['gameState', getEventGameStateEncoder()],
   ]);

const getUpdateEventStateIxPayloadDecoder = (): Decoder<{
   eventId: EventId;
   sequence: number;
   gameState: EventGameState;
}> =>
   getStructDecoder([
      ['eventId', getEventIdDecoder()],
      ['sequence', getU16Decoder()],
      ['gameState', getEventGameStateDecoder()],
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
      case 'getQuoteParlay': {
         const out = encodeGetQuoteParlayIxData(ix.data);
         if (out.length !== GET_QUOTE_PARLAY_IX_WIRE_LEN) {
            throw new RangeError(`getQuoteParlay wire len ${out.length}`);
         }
         return new Uint8Array(out);
      }
      case 'fillParlayQuote': {
         const out = encodeFillParlayQuoteIxData(ix.data);
         if (out.length !== FILL_QUOTE_PARLAY_IX_WIRE_LEN) {
            throw new RangeError(`fillParlayQuote wire len ${out.length}`);
         }
         return new Uint8Array(out);
      }
      case 'fillBetRfq': {
         const out = encodeFillRfqIxData(ix.data);
         if (out[0] !== MM_FILL_BET_RFQ_IX_DISCRIMINATOR) {
            throw new RangeError(`fillBetRfq disc ${out[0]}; expected ${MM_FILL_BET_RFQ_IX_DISCRIMINATOR}`);
         }
         if (out.length !== FILL_RFQ_IX_WIRE_LEN) {
            throw new RangeError(`fillBetRfq wire len ${out.length}`);
         }
         return new Uint8Array(out);
      }
      case 'fillParlayRfq': {
         const out = encodeFillRfqIxData(ix.data);
         if (out[0] !== MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR) {
            throw new RangeError(`fillParlayRfq disc ${out[0]}; expected ${MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR}`);
         }
         if (out.length !== FILL_RFQ_IX_WIRE_LEN) {
            throw new RangeError(`fillParlayRfq wire len ${out.length}`);
         }
         return new Uint8Array(out);
      }
      case 'setRfqSigner': {
         const p = getSetRfqSignerIxDataEncoder().encode(ix.data);
         if (p.length !== SET_RFQ_SIGNER_IX_DATA_LEN) {
            throw new RangeError(`setRfqSigner payload len ${p.length}`);
         }
         return concatDiscriminator(SET_RFQ_SIGNER_IX_DISCRIMINATOR, p);
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
            gameState: ix.gameState,
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
      case 'writeArbitraryData': {
         if (ix.data.length === 0) {
            throw new RangeError('writeArbitraryData: expected at least one payload byte');
         }
         return concatDiscriminator(WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR, ix.data);
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
      case GET_QUOTE_PARLAY_IX_DISCRIMINATOR:
         if (data.length !== GET_QUOTE_PARLAY_IX_WIRE_LEN) {
            throw new RangeError(`getQuoteParlay: expected ${GET_QUOTE_PARLAY_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'getQuoteParlay', data: decodeGetQuoteParlayIxData(new Uint8Array(data)) };
      case FILL_QUOTE_PARLAY_IX_DISCRIMINATOR:
         if (data.length !== FILL_QUOTE_PARLAY_IX_WIRE_LEN) {
            throw new RangeError(`fillParlayQuote: expected ${FILL_QUOTE_PARLAY_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'fillParlayQuote', data: decodeFillParlayQuoteIxData(new Uint8Array(data)) };
      case MM_FILL_BET_RFQ_IX_DISCRIMINATOR:
         if (data.length !== FILL_RFQ_IX_WIRE_LEN) {
            throw new RangeError(`fillBetRfq: expected ${FILL_RFQ_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'fillBetRfq', data: decodeFillRfqIxData(new Uint8Array(data)) };
      case MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR:
         if (data.length !== FILL_RFQ_IX_WIRE_LEN) {
            throw new RangeError(`fillParlayRfq: expected ${FILL_RFQ_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'fillParlayRfq', data: decodeFillRfqIxData(new Uint8Array(data)) };
      case SET_RFQ_SIGNER_IX_DISCRIMINATOR:
         if (rest.length !== SET_RFQ_SIGNER_IX_DATA_LEN) {
            throw new RangeError(`setRfqSigner: expected ${SET_RFQ_SIGNER_IX_DATA_LEN} bytes`);
         }
         return { kind: 'setRfqSigner', data: getSetRfqSignerIxDataDecoder().decode(restBytes) };
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
      case WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR:
         if (rest.length === 0) {
            throw new RangeError('writeArbitraryData: expected at least one payload byte');
         }
         return { kind: 'writeArbitraryData', data: new Uint8Array(rest) };
      case FORCE_CLOSE_PDA_IX_DISCRIMINATOR:
         return { kind: 'forceClosePda' };
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
