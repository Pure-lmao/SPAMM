/**
 * Encoders and decoders for market-maker instruction payloads and on-chain account data.
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
   EVENT_STATE_HEADER_LEN,
   FILL_QUOTE_IX_WIRE_LEN,
   FILL_QUOTE_PARLAY_IX_WIRE_LEN,
   FILL_CASHOUT_QUOTE_IX_WIRE_LEN,
   FILL_CASHOUT_QUOTE_PARLAY_IX_WIRE_LEN,
   GET_QUOTE_IX_WIRE_LEN,
   GET_QUOTE_PARLAY_IX_HEADER_LEN,
   GET_CASHOUT_QUOTE_IX_WIRE_LEN,
   GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN,
   getQuoteParlayIxWireLen,
   getCashoutQuoteParlayIxWireLen,
   INIT_PROGRAM_IX_DATA_LEN,
   MARKET_ID_WIRE_SIZE,
   MM_CONFIG_PDA_HEADER_LEN,
   MM_ORACLE_ACCOUNT_LEN,
   MM_PARLAY_QUOTE_BUFFER_HEADER_LEN,
   MM_PARLAY_QUOTE_BUFFER_LEN,
   MM_QUOTE_BUFFER_LEN,
   PARLAY_LEG_QUOTED_LEN,
   PARLAY_LEG_SEL_LEN,
   PARLAY_LEG_TABLE_LEN,
   FILL_RFQ_IX_WIRE_LEN,
   UPDATE_ORACLE_IX_PAYLOAD_LEN,
   UPDATE_EVENT_STATE_IX_PAYLOAD_LEN,
   type DecodedMarketMakerInstruction,
   type EventGameState,
   type EventId,
   type EventStateData,
   type FillParlayQuoteIxData,
   type FillQuoteIxData,
   type FillCashoutQuoteIxData,
   type FillCashoutQuoteParlayIxData,
   type FillRfqIxData,
   type GetCashoutQuoteIxData,
   type GetCashoutQuoteParlayIxData,
   type GetQuoteIxData,
   type GetQuoteParlayIxData,
   type InitProgramIxData,
   type MmAccountConfig,
   type MmOracleMarketData,
   type MmParlayQuoteBuffer,
   type MmQuoteBuffer,
   type ParlayLegQuoted,
   type ParlayLegSel,
   type ParlayLegWire,
   type MmReturnData,
   type GetParlayQuoteReturnWire,
   PARLAY_QUOTE_RETURN_HEADER_LEN,
   parlayQuoteReturnWireLen,
} from './types.js';

import { MAX_PARLAY_LEGS } from './constants.js';

import { validateFillParlayQuoteIxData, validateGetQuoteParlayIxData } from './validate.js';

export const UPDATE_ORACLE_BODY_IX_DISCRIMINATOR = 0;
// admin — 100–101
export const INIT_PROGRAM_IX_DISCRIMINATOR = 100;
export const SET_RFQ_SIGNER_IX_DISCRIMINATOR = 101;
// event / market — 110–114
export const INIT_EVENT_IX_DISCRIMINATOR = 110;
export const INIT_MARKET_IX_DISCRIMINATOR = 111;
export const CLOSE_EVENT_IX_DISCRIMINATOR = 112;
export const CLOSE_MARKET_IX_DISCRIMINATOR = 113;
/** `update_event_state` — must match `UPDATE_EVENT_STATE_IX_DISCRIMINATOR` in the MM program. */
export const UPDATE_EVENT_STATE_IX_DISCRIMINATOR = 114;
// auction CPI — 120–123
export const GET_QUOTE_IX_DISCRIMINATOR = 120;
export const FILL_QUOTE_IX_DISCRIMINATOR = 121;
export const GET_QUOTE_PARLAY_IX_DISCRIMINATOR = 122;
export const FILL_QUOTE_PARLAY_IX_DISCRIMINATOR = 123;
// RFQ CPI — 130–131
export const MM_FILL_BET_RFQ_IX_DISCRIMINATOR = 130;
export const MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR = 131;
// cashout CPI — 140–145
export const GET_CASHOUT_QUOTE_IX_DISCRIMINATOR = 140;
export const FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR = 141;
export const GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR = 142;
export const FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR = 143;
export const FILL_CASHOUT_RFQ_IX_DISCRIMINATOR = 144;
export const FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR = 145;
// funds — 150
export const WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR = 150;
// dev tooling
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


const getMmOracleStructEncoder = (): Encoder<MmOracleMarketData> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['sequence', getU32BigintEncoder('sequence')],
      ['odds0', getU32BigintEncoder('odds0')],
      ['odds1', getU32BigintEncoder('odds1')],
      ['odds2', getU32BigintEncoder('odds2')],
   ]);

const getMmOracleStructDecoder = (): Decoder<MmOracleMarketData> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['sequence', getU32BigintDecoder()],
      ['odds0', getU32BigintDecoder()],
      ['odds1', getU32BigintDecoder()],
      ['odds2', getU32BigintDecoder()],
   ]);

export function encodeMmOracleMarketData(data: MmOracleMarketData): Uint8Array {
   const out = getMmOracleStructEncoder().encode(data);
   if (out.length !== MM_ORACLE_ACCOUNT_LEN) {
      throw new RangeError(`oracle account wire len ${out.length}; expected ${MM_ORACLE_ACCOUNT_LEN}`);
   }
   return new Uint8Array(out);
}

export function decodeMmOracleMarketData(data: ReadonlyUint8Array): MmOracleMarketData {
   if (data.length !== MM_ORACLE_ACCOUNT_LEN) {
      throw new RangeError(`oracle account len ${data.length}; expected ${MM_ORACLE_ACCOUNT_LEN}`);
   }
   return getMmOracleStructDecoder().decode(new Uint8Array(data));
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


/** Return data from MM `get_quote_parlay` (`GetParlayQuoteReturnWire`). */
export function decodeGetParlayQuoteReturnWire(data: ReadonlyUint8Array): GetParlayQuoteReturnWire {
   if (data.length < PARLAY_QUOTE_RETURN_HEADER_LEN) {
      throw new RangeError(
         `get_parlay_quote return data len ${data.length} < header ${PARLAY_QUOTE_RETURN_HEADER_LEN}`,
      );
   }
   const numLegs = data[12]!;
   if (numLegs < 2 || numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`get_parlay_quote return numLegs ${numLegs}`);
   }
   const expected = parlayQuoteReturnWireLen(numLegs);
   if (data.length !== expected) {
      throw new RangeError(`get_parlay_quote return data len ${data.length}; expected ${expected}`);
   }
   const maxAmount = getU64Decoder().decode(data.subarray(0, 8));
   const oddsScaled = getU32BigintDecoder().decode(data.subarray(8, 12));
   const legOdds: bigint[] = [];
   const oddsDec = getU32BigintDecoder();
   for (let i = 0; i < numLegs; i++) {
      const off = PARLAY_QUOTE_RETURN_HEADER_LEN + i * 4;
      legOdds.push(oddsDec.decode(data.subarray(off, off + 4)));
   }
   return { maxAmount, oddsScaled, numLegs, legOdds };
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

export const getFillQuoteIxDataEncoder = (): Encoder<FillQuoteIxData> =>
   getStructEncoder([
      ['instructionDiscriminator', getU8Encoder()],
      ['amountToFill', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['eventStateSequence', getU16Encoder()],
      ['amountToSend', getU64Encoder()],
   ]);

export const getFillQuoteIxDataDecoder = (): Decoder<FillQuoteIxData> =>
   getStructDecoder([
      ['instructionDiscriminator', getU8Decoder()],
      ['amountToFill', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
      ['eventStateSequence', getU16Decoder()],
      ['amountToSend', getU64Decoder()],
   ]);

export const getGetCashoutQuoteIxDataEncoder = (): Encoder<GetCashoutQuoteIxData> =>
   getStructEncoder([
      ['instructionDiscriminator', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['payout', getU64Encoder()],
      ['minPayout', getU64Encoder()],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['eventStateSequence', getU16Encoder()],
   ]);

export const getGetCashoutQuoteIxDataDecoder = (): Decoder<GetCashoutQuoteIxData> =>
   getStructDecoder([
      ['instructionDiscriminator', getU8Decoder()],
      ['amount', getU64Decoder()],
      ['payout', getU64Decoder()],
      ['minPayout', getU64Decoder()],
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
      ['eventStateSequence', getU16Decoder()],
   ]);

export const getFillCashoutQuoteIxDataEncoder = (): Encoder<FillCashoutQuoteIxData> =>
   getStructEncoder([
      ['instructionDiscriminator', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['amountToSend', getU64Encoder()],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['eventStateSequence', getU16Encoder()],
   ]);

export const getFillCashoutQuoteIxDataDecoder = (): Decoder<FillCashoutQuoteIxData> =>
   getStructDecoder([
      ['instructionDiscriminator', getU8Decoder()],
      ['amount', getU64Decoder()],
      ['amountToSend', getU64Decoder()],
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
      ['eventStateSequence', getU16Decoder()],
   ]);

export const getFillCashoutQuoteParlayIxDataEncoder = (): Encoder<FillCashoutQuoteParlayIxData> =>
   getStructEncoder([
      ['instructionDiscriminator', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['amountToSend', getU64Encoder()],
   ]);

export const getFillCashoutQuoteParlayIxDataDecoder = (): Decoder<FillCashoutQuoteParlayIxData> =>
   getStructDecoder([
      ['instructionDiscriminator', getU8Decoder()],
      ['amount', getU64Decoder()],
      ['amountToSend', getU64Decoder()],
   ]);

export const getParlayLegSelEncoder = (): Encoder<ParlayLegSel> =>
   getStructEncoder([
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
   ]);

export const getParlayLegSelDecoder = (): Decoder<ParlayLegSel> =>
   getStructDecoder([
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
   ]);

export const getParlayLegQuotedEncoder = (): Encoder<ParlayLegQuoted> =>
   getStructEncoder([
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
   ]);

export const getParlayLegQuotedDecoder = (): Decoder<ParlayLegQuoted> =>
   getStructDecoder([
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
      ['oddsScaled', getU32BigintDecoder()],
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

/** Pad `ParlayLegTable` wire to `MAX_PARLAY_LEGS` quoted slots; unused slots are zero. MM quote buffer only. */
export function padParlayLegTableBytes(legs: readonly ParlayLegQuoted[], numLegs: number): Uint8Array {
   if (numLegs < 1 || numLegs > MAX_PARLAY_LEGS || legs.length < numLegs) {
      throw new RangeError('padParlayLegTableBytes: invalid legs / numLegs');
   }
   const enc = getParlayLegQuotedEncoder();
   const out = new Uint8Array(PARLAY_LEG_TABLE_LEN);
   for (let i = 0; i < MAX_PARLAY_LEGS; i++) {
      if (i < numLegs) {
         out.set(enc.encode(legs[i]!), i * PARLAY_LEG_QUOTED_LEN);
      }
   }
   return out;
}

/** Encode only `numLegs` live get_quote_parlay selection legs (no padding). */
export function encodeLiveParlayLegsBytes(legs: readonly ParlayLegSel[], numLegs: number): Uint8Array {
   if (numLegs < 1 || legs.length < numLegs) {
      throw new RangeError('encodeLiveParlayLegsBytes: invalid legs / numLegs');
   }
   const enc = getParlayLegSelEncoder();
   const out = new Uint8Array(numLegs * PARLAY_LEG_SEL_LEN);
   for (let i = 0; i < numLegs; i++) {
      out.set(enc.encode(legs[i]!), i * PARLAY_LEG_SEL_LEN);
   }
   return out;
}

/** Decode `numLegs` live get_quote_parlay selection legs from unpadded wire bytes. */
export function decodeLiveParlayLegsBytes(bytes: ReadonlyUint8Array, numLegs: number): readonly ParlayLegSel[] {
   const expected = numLegs * PARLAY_LEG_SEL_LEN;
   if (bytes.length !== expected) {
      throw new RangeError(`live parlay legs bytes ${bytes.length}; expected ${expected} for ${numLegs} legs`);
   }
   const dec = getParlayLegSelDecoder();
   const legs: ParlayLegSel[] = [];
   for (let i = 0; i < numLegs; i++) {
      const off = i * PARLAY_LEG_SEL_LEN;
      legs.push(dec.decode(bytes.subarray(off, off + PARLAY_LEG_SEL_LEN)));
   }
   return legs;
}

function decodeParlayLegTableBytes(table: Uint8Array): ParlayLegQuoted[] {
   if (table.length !== PARLAY_LEG_TABLE_LEN) {
      throw new RangeError(`parlay leg table len ${table.length}`);
   }
   const dec = getParlayLegQuotedDecoder();
   const legs: ParlayLegQuoted[] = [];
   for (let i = 0; i < MAX_PARLAY_LEGS; i++) {
      const slice = table.subarray(i * PARLAY_LEG_QUOTED_LEN, (i + 1) * PARLAY_LEG_QUOTED_LEN);
      legs.push(dec.decode(slice));
   }
   return legs;
}

export function encodeGetQuoteParlayIxData(ix: GetQuoteParlayIxData): Uint8Array {
   validateGetQuoteParlayIxData(ix);
   if (ix.instructionDiscriminator !== GET_QUOTE_PARLAY_IX_DISCRIMINATOR) {
      throw new RangeError(`get_quote_parlay instructionDiscriminator must be ${GET_QUOTE_PARLAY_IX_DISCRIMINATOR}`);
   }
   const expected = getQuoteParlayIxWireLen(ix.numLegs);
   const out = new Uint8Array(expected);
   out[0] = ix.instructionDiscriminator & 0xff;
   const dv = new DataView(out.buffer);
   dv.setBigUint64(1, ix.amount, true);
   dv.setUint32(9, assertU32Bigint('oddsScaled', ix.oddsScaled), true);
   out[13] = ix.numLegs & 0xff;
   out.set(encodeLiveParlayLegsBytes(ix.legs, ix.numLegs), 14);
   return out;
}

export function decodeGetQuoteParlayIxData(data: ReadonlyUint8Array): GetQuoteParlayIxData {
   if (data.length < GET_QUOTE_PARLAY_IX_HEADER_LEN) {
      throw new RangeError(`get_quote_parlay wire len ${data.length} < header ${GET_QUOTE_PARLAY_IX_HEADER_LEN}`);
   }
   const u8 = new Uint8Array(data);
   const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
   const instructionDiscriminator = u8[0]!;
   const amount = dv.getBigUint64(1, true);
   const oddsScaled = BigInt(dv.getUint32(9, true) >>> 0);
   const numLegs = u8[13]!;
   const expected = getQuoteParlayIxWireLen(numLegs);
   if (data.length !== expected) {
      throw new RangeError(`get_quote_parlay wire len ${data.length}; expected ${expected} for ${numLegs} legs`);
   }
   if (numLegs < 2 || numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`get_quote_parlay numLegs invalid: ${numLegs}`);
   }
   const legs = decodeLiveParlayLegsBytes(u8.subarray(14), numLegs);
   return {
      instructionDiscriminator,
      amount,
      oddsScaled,
      numLegs,
      legs,
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

export function encodeFillQuoteIxData(ix: FillQuoteIxData): Uint8Array {
   if (ix.instructionDiscriminator !== FILL_QUOTE_IX_DISCRIMINATOR) {
      throw new RangeError(`fill_quote instructionDiscriminator must be ${FILL_QUOTE_IX_DISCRIMINATOR}`);
   }
   const out = getFillQuoteIxDataEncoder().encode(ix);
   if (out.length !== FILL_QUOTE_IX_WIRE_LEN) {
      throw new RangeError(`fill_quote wire len ${out.length}`);
   }
   return new Uint8Array(out);
}

export function decodeFillQuoteIxData(data: ReadonlyUint8Array): FillQuoteIxData {
   if (data.length !== FILL_QUOTE_IX_WIRE_LEN) {
      throw new RangeError(`fill_quote wire len ${data.length}`);
   }
   return getFillQuoteIxDataDecoder().decode(new Uint8Array(data));
}

export function encodeGetCashoutQuoteIxData(ix: GetCashoutQuoteIxData): Uint8Array {
   if (ix.instructionDiscriminator !== GET_CASHOUT_QUOTE_IX_DISCRIMINATOR) {
      throw new RangeError(`get_cashout_quote instructionDiscriminator must be ${GET_CASHOUT_QUOTE_IX_DISCRIMINATOR}`);
   }
   const out = getGetCashoutQuoteIxDataEncoder().encode(ix);
   if (out.length !== GET_CASHOUT_QUOTE_IX_WIRE_LEN) {
      throw new RangeError(`get_cashout_quote wire len ${out.length}`);
   }
   return new Uint8Array(out);
}

export function decodeGetCashoutQuoteIxData(data: ReadonlyUint8Array): GetCashoutQuoteIxData {
   if (data.length !== GET_CASHOUT_QUOTE_IX_WIRE_LEN) {
      throw new RangeError(`get_cashout_quote wire len ${data.length}`);
   }
   return getGetCashoutQuoteIxDataDecoder().decode(new Uint8Array(data));
}

export function encodeFillCashoutQuoteIxData(ix: FillCashoutQuoteIxData): Uint8Array {
   if (ix.instructionDiscriminator !== FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR) {
      throw new RangeError(`fill_cashout_quote instructionDiscriminator must be ${FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR}`);
   }
   const out = getFillCashoutQuoteIxDataEncoder().encode(ix);
   if (out.length !== FILL_CASHOUT_QUOTE_IX_WIRE_LEN) {
      throw new RangeError(`fill_cashout_quote wire len ${out.length}`);
   }
   return new Uint8Array(out);
}

export function decodeFillCashoutQuoteIxData(data: ReadonlyUint8Array): FillCashoutQuoteIxData {
   if (data.length !== FILL_CASHOUT_QUOTE_IX_WIRE_LEN) {
      throw new RangeError(`fill_cashout_quote wire len ${data.length}`);
   }
   return getFillCashoutQuoteIxDataDecoder().decode(new Uint8Array(data));
}

export function encodeGetCashoutQuoteParlayIxData(ix: GetCashoutQuoteParlayIxData): Uint8Array {
   if (ix.instructionDiscriminator !== GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR) {
      throw new RangeError(
         `get_cashout_quote_parlay instructionDiscriminator must be ${GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR}`,
      );
   }
   if (ix.numLegs < 2 || ix.numLegs > MAX_PARLAY_LEGS || ix.legs.length < ix.numLegs) {
      throw new RangeError(`get_cashout_quote_parlay numLegs invalid: ${ix.numLegs}`);
   }
   const expected = getCashoutQuoteParlayIxWireLen(ix.numLegs);
   const out = new Uint8Array(expected);
   out[0] = ix.instructionDiscriminator & 0xff;
   const dv = new DataView(out.buffer);
   dv.setBigUint64(1, ix.amount, true);
   dv.setBigUint64(9, ix.payout, true);
   dv.setBigUint64(17, ix.minPayout, true);
   out[25] = ix.numLegs & 0xff;
   out.set(encodeLiveParlayLegsBytes(ix.legs, ix.numLegs), 26);
   return out;
}

export function decodeGetCashoutQuoteParlayIxData(data: ReadonlyUint8Array): GetCashoutQuoteParlayIxData {
   if (data.length < GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN) {
      throw new RangeError(
         `get_cashout_quote_parlay wire len ${data.length} < header ${GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN}`,
      );
   }
   const u8 = new Uint8Array(data);
   const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
   const instructionDiscriminator = u8[0]!;
   const amount = dv.getBigUint64(1, true);
   const payout = dv.getBigUint64(9, true);
   const minPayout = dv.getBigUint64(17, true);
   const numLegs = u8[25]!;
   const expected = getCashoutQuoteParlayIxWireLen(numLegs);
   if (data.length !== expected) {
      throw new RangeError(`get_cashout_quote_parlay wire len ${data.length}; expected ${expected} for ${numLegs} legs`);
   }
   if (numLegs < 2 || numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`get_cashout_quote_parlay numLegs invalid: ${numLegs}`);
   }
   const legs = [...decodeLiveParlayLegsBytes(u8.subarray(26), numLegs)];
   return { instructionDiscriminator, amount, payout, minPayout, numLegs, legs };
}

export function encodeFillCashoutQuoteParlayIxData(ix: FillCashoutQuoteParlayIxData): Uint8Array {
   if (ix.instructionDiscriminator !== FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR) {
      throw new RangeError(
         `fill_cashout_quote_parlay instructionDiscriminator must be ${FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR}`,
      );
   }
   const out = getFillCashoutQuoteParlayIxDataEncoder().encode(ix);
   if (out.length !== FILL_CASHOUT_QUOTE_PARLAY_IX_WIRE_LEN) {
      throw new RangeError(`fill_cashout_quote_parlay wire len ${out.length}`);
   }
   return new Uint8Array(out);
}

export function decodeFillCashoutQuoteParlayIxData(data: ReadonlyUint8Array): FillCashoutQuoteParlayIxData {
   if (data.length !== FILL_CASHOUT_QUOTE_PARLAY_IX_WIRE_LEN) {
      throw new RangeError(`fill_cashout_quote_parlay wire len ${data.length}`);
   }
   return getFillCashoutQuoteParlayIxDataDecoder().decode(new Uint8Array(data));
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
   const allLegs = decodeParlayLegTableBytes(
      u8.subarray(
         MM_PARLAY_QUOTE_BUFFER_HEADER_LEN,
         MM_PARLAY_QUOTE_BUFFER_HEADER_LEN + PARLAY_LEG_TABLE_LEN,
      ),
   );
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
   odds2: bigint,
): Uint8Array {
   return new Uint8Array(
      getStructEncoder([
         ['sequence', getU32BigintEncoder('sequence')],
         ['odds0', getU32BigintEncoder('odds0')],
         ['odds1', getU32BigintEncoder('odds1')],
         ['odds2', getU32BigintEncoder('odds2')],
      ]).encode({ sequence, odds0, odds1, odds2 }),
   );
}

const getUpdateOracleBodyDecoder = (): Decoder<{
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
         if (p.length !== UPDATE_ORACLE_IX_PAYLOAD_LEN) {
            throw new RangeError(`updateOracleBody payload len ${p.length}; expected ${UPDATE_ORACLE_IX_PAYLOAD_LEN}`);
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
      case 'fillQuote': {
         return encodeFillQuoteIxData(ix.data);
      }
      case 'getQuoteParlay': {
         const out = encodeGetQuoteParlayIxData(ix.data);
         const expected = getQuoteParlayIxWireLen(ix.data.numLegs);
         if (out.length !== expected) {
            throw new RangeError(`getQuoteParlay wire len ${out.length}; expected ${expected}`);
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
      case 'getCashoutQuote': {
         return encodeGetCashoutQuoteIxData(ix.data);
      }
      case 'fillCashoutQuote': {
         return encodeFillCashoutQuoteIxData(ix.data);
      }
      case 'getCashoutQuoteParlay': {
         return encodeGetCashoutQuoteParlayIxData(ix.data);
      }
      case 'fillCashoutQuoteParlay': {
         return encodeFillCashoutQuoteParlayIxData(ix.data);
      }
      case 'fillCashoutRfq': {
         const out = encodeFillRfqIxData(ix.data);
         if (out[0] !== FILL_CASHOUT_RFQ_IX_DISCRIMINATOR) {
            throw new RangeError(`fillCashoutRfq disc ${out[0]}; expected ${FILL_CASHOUT_RFQ_IX_DISCRIMINATOR}`);
         }
         if (out.length !== FILL_RFQ_IX_WIRE_LEN) {
            throw new RangeError(`fillCashoutRfq wire len ${out.length}`);
         }
         return new Uint8Array(out);
      }
      case 'fillParlayCashoutRfq': {
         const out = encodeFillRfqIxData(ix.data);
         if (out[0] !== FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR) {
            throw new RangeError(`fillParlayCashoutRfq disc ${out[0]}; expected ${FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR}`);
         }
         if (out.length !== FILL_RFQ_IX_WIRE_LEN) {
            throw new RangeError(`fillParlayCashoutRfq wire len ${out.length}`);
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
         return concatDiscriminator(SET_RFQ_SIGNER_IX_DISCRIMINATOR, new Uint8Array());
      }
      case 'initEvent': {
         const p = getEventIdEncoder().encode(ix.eventId);
         if (p.length !== EVENT_ID_WIRE_SIZE) {
            throw new RangeError(`event id payload len ${p.length}`);
         }
         const body = ix.eventBody ?? new Uint8Array();
         const out = new Uint8Array(1 + EVENT_ID_WIRE_SIZE + body.length);
         out[0] = INIT_EVENT_IX_DISCRIMINATOR & 0xff;
         out.set(new Uint8Array(p), 1);
         if (body.length > 0) {
            out.set(body, 1 + EVENT_ID_WIRE_SIZE);
         }
         return out;
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
         if (rest.length !== UPDATE_ORACLE_IX_PAYLOAD_LEN) {
            throw new RangeError(
               `updateOracleBody: expected ${UPDATE_ORACLE_IX_PAYLOAD_LEN} payload bytes, got ${rest.length}`,
            );
         }
         return {
            kind: 'updateOracle',
            ...getUpdateOracleBodyDecoder().decode(restBytes),
         };
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
      case FILL_QUOTE_IX_DISCRIMINATOR:
         if (data.length !== FILL_QUOTE_IX_WIRE_LEN) {
            throw new RangeError(`fillQuote: expected ${FILL_QUOTE_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'fillQuote', data: decodeFillQuoteIxData(new Uint8Array(data)) };
      case GET_QUOTE_PARLAY_IX_DISCRIMINATOR: {
         if (data.length < GET_QUOTE_PARLAY_IX_HEADER_LEN) {
            throw new RangeError(`getQuoteParlay: wire len ${data.length} < header ${GET_QUOTE_PARLAY_IX_HEADER_LEN}`);
         }
         const numLegs = data[13]!;
         const expected = getQuoteParlayIxWireLen(numLegs);
         if (data.length !== expected) {
            throw new RangeError(`getQuoteParlay: expected ${expected} bytes for ${numLegs} legs, got ${data.length}`);
         }
         return { kind: 'getQuoteParlay', data: decodeGetQuoteParlayIxData(new Uint8Array(data)) };
      }
      case FILL_QUOTE_PARLAY_IX_DISCRIMINATOR:
         if (data.length !== FILL_QUOTE_PARLAY_IX_WIRE_LEN) {
            throw new RangeError(`fillParlayQuote: expected ${FILL_QUOTE_PARLAY_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'fillParlayQuote', data: decodeFillParlayQuoteIxData(new Uint8Array(data)) };
      case GET_CASHOUT_QUOTE_IX_DISCRIMINATOR:
         if (data.length !== GET_CASHOUT_QUOTE_IX_WIRE_LEN) {
            throw new RangeError(`getCashoutQuote: expected ${GET_CASHOUT_QUOTE_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'getCashoutQuote', data: decodeGetCashoutQuoteIxData(new Uint8Array(data)) };
      case FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR:
         if (data.length !== FILL_CASHOUT_QUOTE_IX_WIRE_LEN) {
            throw new RangeError(`fillCashoutQuote: expected ${FILL_CASHOUT_QUOTE_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'fillCashoutQuote', data: decodeFillCashoutQuoteIxData(new Uint8Array(data)) };
      case GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR: {
         if (data.length < GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN) {
            throw new RangeError(
               `getCashoutQuoteParlay: wire len ${data.length} < header ${GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN}`,
            );
         }
         const numLegs = data[25]!;
         const expected = getCashoutQuoteParlayIxWireLen(numLegs);
         if (data.length !== expected) {
            throw new RangeError(
               `getCashoutQuoteParlay: expected ${expected} bytes for ${numLegs} legs, got ${data.length}`,
            );
         }
         return { kind: 'getCashoutQuoteParlay', data: decodeGetCashoutQuoteParlayIxData(new Uint8Array(data)) };
      }
      case FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR:
         if (data.length !== FILL_CASHOUT_QUOTE_PARLAY_IX_WIRE_LEN) {
            throw new RangeError(`fillCashoutQuoteParlay: expected ${FILL_CASHOUT_QUOTE_PARLAY_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'fillCashoutQuoteParlay', data: decodeFillCashoutQuoteParlayIxData(new Uint8Array(data)) };
      case FILL_CASHOUT_RFQ_IX_DISCRIMINATOR:
         if (data.length !== FILL_RFQ_IX_WIRE_LEN) {
            throw new RangeError(`fillCashoutRfq: expected ${FILL_RFQ_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'fillCashoutRfq', data: decodeFillRfqIxData(new Uint8Array(data)) };
      case FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR:
         if (data.length !== FILL_RFQ_IX_WIRE_LEN) {
            throw new RangeError(`fillParlayCashoutRfq: expected ${FILL_RFQ_IX_WIRE_LEN} bytes`);
         }
         return { kind: 'fillParlayCashoutRfq', data: decodeFillRfqIxData(new Uint8Array(data)) };
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
         if (rest.length !== 0) {
            throw new RangeError(`setRfqSigner: expected 0 payload bytes`);
         }
         return { kind: 'setRfqSigner' };
      case INIT_EVENT_IX_DISCRIMINATOR:
         if (rest.length < EVENT_ID_WIRE_SIZE) {
            throw new RangeError(`initEvent: expected at least ${EVENT_ID_WIRE_SIZE} bytes`);
         }
         return {
            kind: 'initEvent',
            eventId: getEventIdDecoder().decode(restBytes.subarray(0, EVENT_ID_WIRE_SIZE)),
            eventBody: new Uint8Array(rest.subarray(EVENT_ID_WIRE_SIZE)),
         };
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
   if (data.length < EVENT_STATE_HEADER_LEN) {
      throw new RangeError(`event state len ${data.length}`);
   }
   return getEventStateDataDecoder().decode(new Uint8Array(data.subarray(0, EVENT_STATE_HEADER_LEN)));
};

export const decodeMmAccountConfig = (data: ReadonlyUint8Array): MmAccountConfig => {
   if (data.length < MM_CONFIG_PDA_HEADER_LEN) {
      throw new RangeError(`mm account config len ${data.length}`);
   }
   return getMmAccountConfigDecoder().decode(new Uint8Array(data.subarray(0, MM_CONFIG_PDA_HEADER_LEN)));
};

/** `init_market` / CPI: raw odds body only (8 or 12 bytes), placed after the 6-byte oracle header on-chain. */
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
