/**
 * Encoders and decoders for aggregator instruction payloads and on-chain account data.
 *
 * @see https://www.solanakit.com/docs/concepts/codecs
 */

import {
   fixDecoderSize,
   fixEncoderSize,
   getAddressDecoder,
   getAddressEncoder,
   type Decoder,
   type Encoder,
   getBytesDecoder,
   getBytesEncoder,
   getI64Decoder,
   getI64Encoder,
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
   ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR,
   CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR,
   CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR,
   CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR,
   FILL_BET_IX_DISCRIMINATOR,
   FILL_PARLAY_IX_DISCRIMINATOR,
   GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR,
   GET_QUOTE_PROXY_IX_DISCRIMINATOR,
   FORCE_CLOSE_PDA_IX_DISCRIMINATOR,
   GRADE_BETS_IX_DISCRIMINATOR,
   INIT_PROGRAM_IX_DISCRIMINATOR,
   MM_FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
   MM_GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
   DEREGISTER_MM_IX_DISCRIMINATOR,
   REGISTER_MM_IX_DISCRIMINATOR,
   REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR,
   SETTLE_BET_IX_DISCRIMINATOR,
   SETTLE_PARLAY_IX_DISCRIMINATOR,
   WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR,
   WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR,
} from './instructions.js';

import {
   BetResult,
   MM_RETURN_DATA_LEN,
   Sport,
   type AddLineToNettingIxData,
   type BetAccountData,
   type BetFiller,
   type ConfigPdaData,
   type DecodedAggregatorInstruction,
   type EventGameState,
   type EventId,
   type EventStateData,
   type FillBetIxData,
   type FillParlayIxData,
   type FillParlayQuoteIxData,
   type FillQuoteIxData,
   type GetQuoteIxData,
   type GetQuoteParlayIxData,
   type MarketId,
   type MmAccountConfig,
   type MmEncumbrancePdaData,
   type MmListPdaData,
   type MmMarketDataPdaData,
   type MmParlayQuoteBuffer,
   type MmQuoteBuffer,
   type MmReturnData,
   type ProxyQuoteData,
   PROXY_QUOTE_DATA_LEN,
   type NettingLine,
   type NettingPdaAccountData,
   type NettingPdaDataHeader,
   type ParlayBetAccountData,
   type ParlayLegWire,
   type RemoveLineFromNettingIxData,
   ADD_LINE_TO_LIABILITY_NETTING_IX_LEN,
   BET_ACCOUNT_LEN,
   CONFIG_PDA_LEN,
   EVENT_ID_WIRE_SIZE,
   EVENT_STATE_LEN,
   FILL_BET_IX_DATA_LEN,
   FILL_PARLAY_IX_DATA_LEN,
   FILL_QUOTE_IX_WIRE_LEN,
   FILL_QUOTE_PARLAY_IX_WIRE_LEN,
   GET_QUOTE_IX_WIRE_LEN,
   GET_QUOTE_PARLAY_IX_WIRE_LEN,
   MM_ACCOUNT_CONFIG_MIN_LEN,
   MM_ENCUMBRANCE_PDA_LEN,
   MM_LIST_HEADER_LEN,
   MM_MARKET_DATA_PDA_MIN_LEN,
   MM_PARLAY_QUOTE_BUFFER_LEN,
   MM_QUOTE_BUFFER_LEN,
   MAX_PARLAY_LEGS,
   NETTING_ACCOUNT_ALLOC_LEN,
   NETTING_DEFAULT_LINE_CAPACITY,
   NETTING_HEADER_LEN,
   NETTING_LINE_LEN,
   PARLAY_LEG_TABLE_LEN,
   PARLAY_LEG_WIRE_LEN,
   PARLAY_BET_ACCOUNT_DISCRIMINATOR,
   PARLAY_BET_ACCOUNT_LEN,
   REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN,
} from './types.js';

import { validateFillParlayIxData, validateGetQuoteParlayIxData } from './validate.js';

/** Rust `EventGameState.game_phase`: up to 4 ASCII bytes, NUL-padded (`other.rs`). Space is encoded as `0` on the wire. */
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
   fixEncoderSize(transformEncoder(getBytesEncoder(), (s: string) => encodeGamePhaseAscii4(s)), 4);

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

const getBoolU8Encoder = (): Encoder<boolean> =>
   transformEncoder(getU8Encoder(), (v: boolean) => (v ? 1 : 0));

const getBoolU8Decoder = (): Decoder<boolean> =>
   transformDecoder(getU8Decoder(), (n: number) => {
      if (n !== 0 && n !== 1) {
         throw new RangeError(`boolean wire byte must be 0 or 1, got ${n}`);
      }
      return n !== 0;
   });

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

function sportFromWire(b: number): Sport {
   switch (b) {
      case Sport.None:
         return Sport.None;
      case Sport.Soccer:
         return Sport.Soccer;
      case Sport.AmericanFootball:
         return Sport.AmericanFootball;
      case Sport.Baseball:
         return Sport.Baseball;
      case Sport.Basketball:
         return Sport.Basketball;
      case Sport.IceHockey:
         return Sport.IceHockey;
      default:
         throw new RangeError(`invalid Sport wire byte: ${b}`);
   }
}

function sportToWire(s: Sport): number {
   switch (s) {
      case Sport.Soccer:
      case Sport.AmericanFootball:
      case Sport.Baseball:
      case Sport.Basketball:
      case Sport.IceHockey:
         return s;
      default:
         throw new RangeError(`invalid Sport enum value: ${s}`);
   }
}

const getSportU8Encoder = (): Encoder<Sport> =>
   transformEncoder(getU8Encoder(), (s: Sport) => sportToWire(s));

const getSportU8Decoder = (): Decoder<Sport> => transformDecoder(getU8Decoder(), sportFromWire);

function betResultFromWire(b: number): BetResult {
   if (!Number.isInteger(b) || b < BetResult.Pending || b > BetResult.RolledBack) {
      throw new RangeError(`invalid BetResult wire byte: ${b}`);
   }
   return b as BetResult;
}

const getBetResultU8Encoder = (): Encoder<BetResult> =>
   transformEncoder(getU8Encoder(), (r: BetResult) => {
      if (!Number.isInteger(r) || r < BetResult.Pending || r > BetResult.RolledBack) {
         throw new RangeError(`invalid BetResult: ${r}`);
      }
      return r as number;
   });

const getBetResultU8Decoder = (): Decoder<BetResult> => transformDecoder(getU8Decoder(), betResultFromWire);

export const getEventIdEncoder = (): Encoder<EventId> =>
   getStructEncoder([
      ['event', getU64Encoder()],
      ['league', getU16Encoder()],
      ['sport', getSportU8Encoder()],
   ]);

export const getEventIdDecoder = (): Decoder<EventId> =>
   getStructDecoder([
      ['event', getU64Decoder()],
      ['league', getU16Decoder()],
      ['sport', getSportU8Decoder()],
   ]);

export const getMarketIdEncoder = (): Encoder<MarketId> =>
   getStructEncoder([
      ['eventId', getEventIdEncoder()],
      ['player', getU64Encoder()],
      ['mkt', getU16Encoder()],
      ['period', getU8Encoder()],
      ['isPregame', getBoolU8Encoder()],
   ]);

export const getMarketIdDecoder = (): Decoder<MarketId> =>
   getStructDecoder([
      ['eventId', getEventIdDecoder()],
      ['player', getU64Decoder()],
      ['mkt', getU16Decoder()],
      ['period', getU8Decoder()],
      ['isPregame', getBoolU8Decoder()],
   ]);

const getBetFillerWireEncoder = (): Encoder<BetFiller> =>
   getStructEncoder([
      ['mmAddress', getAddressEncoder()],
      ['amount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['isPotentiallyNetted', getBoolU8Encoder()],
      ['encumbranceDelta', getI64Encoder()],
   ]);

const getBetFillerWireDecoder = (): Decoder<BetFiller> =>
   getStructDecoder([
      ['mmAddress', getAddressDecoder()],
      ['amount', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['isPotentiallyNetted', getBoolU8Decoder()],
      ['encumbranceDelta', getI64Decoder()],
   ]);

/** On-chain layout matches `BetAccountDataZc` (`account_bet.rs` `to_zc`). */
export const getBetAccountDataEncoder = (): Encoder<BetAccountData> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['owner', getAddressEncoder()],
      ['feepayer', getAddressEncoder()],
      ['betId', getU64Encoder()],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['payout', getU64Encoder()],
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['result', getBetResultU8Encoder()],
      ['filler0', getBetFillerWireEncoder()],
      ['filler1', getBetFillerWireEncoder()],
      ['filler2', getBetFillerWireEncoder()],
      ['filler3', getBetFillerWireEncoder()],
      ['filler4', getBetFillerWireEncoder()],
   ]);

export const getBetAccountDataDecoder = (): Decoder<BetAccountData> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['owner', getAddressDecoder()],
      ['feepayer', getAddressDecoder()],
      ['betId', getU64Decoder()],
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['amount', getU64Decoder()],
      ['payout', getU64Decoder()],
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
      ['result', getBetResultU8Decoder()],
      ['filler0', getBetFillerWireDecoder()],
      ['filler1', getBetFillerWireDecoder()],
      ['filler2', getBetFillerWireDecoder()],
      ['filler3', getBetFillerWireDecoder()],
      ['filler4', getBetFillerWireDecoder()],
   ]);

export const decodeBetAccountData = (data: ReadonlyUint8Array): BetAccountData =>
   getBetAccountDataDecoder().decode(new Uint8Array(data));

export const getNettingLineEncoder = (): Encoder<NettingLine> =>
   getStructEncoder([
      ['period', getU8Encoder()],
      ['mkt', getU16Encoder()],
      ['outcome0', getI64Encoder()],
      ['outcome1', getI64Encoder()],
   ]);

export const getNettingLineDecoder = (): Decoder<NettingLine> =>
   getStructDecoder([
      ['period', getU8Decoder()],
      ['mkt', getU16Decoder()],
      ['outcome0', getI64Decoder()],
      ['outcome1', getI64Decoder()],
   ]);

export const getNettingPdaHeaderEncoder = (): Encoder<NettingPdaDataHeader> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['eventId', getEventIdEncoder()],
      ['home', getI64Encoder()],
      ['away', getI64Encoder()],
      ['draw', getI64Encoder()],
      ['numberOfLines', getU8Encoder()],
   ]);

export const getNettingPdaHeaderDecoder = (): Decoder<NettingPdaDataHeader> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['eventId', getEventIdDecoder()],
      ['home', getI64Decoder()],
      ['away', getI64Decoder()],
      ['draw', getI64Decoder()],
      ['numberOfLines', getU8Decoder()],
   ]);

export const decodeNettingPdaAccountData = (data: ReadonlyUint8Array): NettingPdaAccountData => {
   if (data.length < NETTING_HEADER_LEN) {
      throw new RangeError(`netting account data length ${data.length} < header ${NETTING_HEADER_LEN}`);
   }
   const header = getNettingPdaHeaderDecoder().decode(new Uint8Array(data.subarray(0, NETTING_HEADER_LEN)));
   const n = header.numberOfLines;
   if (n > NETTING_DEFAULT_LINE_CAPACITY) {
      throw new RangeError(`numberOfLines ${n} exceeds capacity ${NETTING_DEFAULT_LINE_CAPACITY}`);
   }
   const linesEnd = NETTING_HEADER_LEN + n * NETTING_LINE_LEN;
   if (data.length < linesEnd) {
      throw new RangeError(`netting account data length ${data.length} < lines end ${linesEnd}`);
   }
   const lineDec = getNettingLineDecoder();
   const lines: NettingLine[] = [];
   for (let i = 0; i < n; i++) {
      const off = NETTING_HEADER_LEN + i * NETTING_LINE_LEN;
      lines.push(lineDec.decode(new Uint8Array(data.subarray(off, off + NETTING_LINE_LEN))));
   }
   return { ...header, lines };
};

export const encodeNettingPdaAccountData = (account: NettingPdaAccountData): Uint8Array => {
   const { lines, ...header } = account;
   if (lines.length !== header.numberOfLines) {
      throw new RangeError('lines.length must match header.numberOfLines');
   }
   if (lines.length > NETTING_DEFAULT_LINE_CAPACITY) {
      throw new RangeError(`at most ${NETTING_DEFAULT_LINE_CAPACITY} netting lines`);
   }
   const total = NETTING_HEADER_LEN + lines.length * NETTING_LINE_LEN;
   if (total > NETTING_ACCOUNT_ALLOC_LEN) {
      throw new RangeError('encoded netting account exceeds NETTING_ACCOUNT_ALLOC_LEN');
   }
   const out = new Uint8Array(NETTING_ACCOUNT_ALLOC_LEN);
   const head = getNettingPdaHeaderEncoder().encode(header);
   out.set(new Uint8Array(head), 0);
   const lineEnc = getNettingLineEncoder();
   for (let i = 0; i < lines.length; i++) {
      out.set(new Uint8Array(lineEnc.encode(lines[i]!)), NETTING_HEADER_LEN + i * NETTING_LINE_LEN);
   }
   return out;
};

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

export const getConfigPdaDataEncoder = (): Encoder<ConfigPdaData> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['status', getU8Encoder()],
      ['authority', getAddressEncoder()],
   ]);

export const getConfigPdaDataDecoder = (): Decoder<ConfigPdaData> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['status', getU8Decoder()],
      ['authority', getAddressDecoder()],
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

export const getMmEncumbrancePdaDataEncoder = (): Encoder<MmEncumbrancePdaData> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['encumbrance', getI64Encoder()],
   ]);

export const getMmEncumbrancePdaDataDecoder = (): Decoder<MmEncumbrancePdaData> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['encumbrance', getI64Decoder()],
   ]);

export const getMmMarketDataPdaDataEncoder = (): Encoder<MmMarketDataPdaData> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
   ]);

export const getMmMarketDataPdaDataDecoder = (): Decoder<MmMarketDataPdaData> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
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

export const decodeMmListPdaData = (data: ReadonlyUint8Array): MmListPdaData => {
   if (data.length < MM_LIST_HEADER_LEN) {
      throw new RangeError(`mm_list data too short: ${data.length}`);
   }
   const discriminator = data[0]!;
   const numberOfMms = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(1, true);
   const expectLen = MM_LIST_HEADER_LEN + numberOfMms * 32;
   if (data.length !== expectLen) {
      throw new RangeError(`mm_list data length ${data.length} !== expected ${expectLen}`);
   }
   const addrDec = getAddressDecoder();
   const mmProgramAddresses = [];
   for (let i = 0; i < numberOfMms; i++) {
      const off = MM_LIST_HEADER_LEN + i * 32;
      mmProgramAddresses.push(addrDec.decode(new Uint8Array(data.subarray(off, off + 32))));
   }
   return { discriminator, numberOfMms, mmProgramAddresses };
};

export const encodeMmListPdaData = (list: MmListPdaData): Uint8Array => {
   if (list.numberOfMms !== list.mmProgramAddresses.length) {
      throw new RangeError('numberOfMms must match mmProgramAddresses.length');
   }
   const out = new Uint8Array(MM_LIST_HEADER_LEN + list.mmProgramAddresses.length * 32);
   out[0] = list.discriminator & 0xff;
   new DataView(out.buffer, out.byteOffset, out.byteLength).setUint16(1, list.numberOfMms, true);
   const addrEnc = getAddressEncoder();
   for (let i = 0; i < list.mmProgramAddresses.length; i++) {
      out.set(addrEnc.encode(list.mmProgramAddresses[i]!), MM_LIST_HEADER_LEN + i * 32);
   }
   return out;
};

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

export const getProxyQuoteDataDecoder = (): Decoder<ProxyQuoteData> =>
   getStructDecoder([
      ['mmAddress', getAddressDecoder()],
      ['maxAmount', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
   ]);

export const getProxyQuoteDataEncoder = (): Encoder<ProxyQuoteData> =>
   getStructEncoder([
      ['mmAddress', getAddressEncoder()],
      ['maxAmount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
   ]);

/** Return data from aggregator `get_quote_proxy` / `get_parlay_quote_proxy` (0..N × `ProxyQuoteData`). */
export function decodeProxyQuoteReturnData(data: ReadonlyUint8Array): ProxyQuoteData[] {
   if (data.length % PROXY_QUOTE_DATA_LEN !== 0) {
      throw new RangeError(
         `proxy quote return data len ${data.length} is not a multiple of ${PROXY_QUOTE_DATA_LEN}`,
      );
   }
   const decoder = getProxyQuoteDataDecoder();
   const quotes: ProxyQuoteData[] = [];
   const bytes = new Uint8Array(data);
   for (let offset = 0; offset < bytes.length; offset += PROXY_QUOTE_DATA_LEN) {
      quotes.push(decoder.decode(bytes.subarray(offset, offset + PROXY_QUOTE_DATA_LEN)));
   }
   return quotes;
}

export const getFillBetIxDataEncoder = (): Encoder<FillBetIxData> =>
   getStructEncoder([
      ['betId', getU64Encoder()],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['minOddsScaled', getU32BigintEncoder('minOddsScaled')],
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
   ]);

export const getFillBetIxDataDecoder = (): Decoder<FillBetIxData> =>
   getStructDecoder([
      ['betId', getU64Decoder()],
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['amount', getU64Decoder()],
      ['minOddsScaled', getU32BigintDecoder()],
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
   ]);

export const getParlayLegWireEncoder = (): Encoder<ParlayLegWire> =>
   getStructEncoder([
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
   ]);

export const getParlayLegWireDecoder = (): Decoder<ParlayLegWire> =>
   getStructDecoder([
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
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

function decodeParlayLegTableBytes(table: ReadonlyUint8Array): ParlayLegWire[] {
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

const getParlayLegTableWireDecoder = (): Decoder<readonly ParlayLegWire[]> =>
   transformDecoder(fixDecoderSize(getBytesDecoder(), PARLAY_LEG_TABLE_LEN), (raw: ReadonlyUint8Array) =>
      decodeParlayLegTableBytes(raw),
   );

const getParlayBetAccountDataDecoder = (): Decoder<ParlayBetAccountData> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['owner', getAddressDecoder()],
      ['feepayer', getAddressDecoder()],
      ['betId', getU64Decoder()],
      ['amount', getU64Decoder()],
      ['payout', getU64Decoder()],
      ['fillerAddress', getAddressDecoder()],
      ['result', getBetResultU8Decoder()],
      ['numLegs', getU8Decoder()],
      ['legs', getParlayLegTableWireDecoder()],
   ]);

export function encodeFillParlayIxData(data: FillParlayIxData): Uint8Array {
   validateFillParlayIxData(data);
   const out = new Uint8Array(FILL_PARLAY_IX_DATA_LEN);
   const dv = new DataView(out.buffer);
   dv.setBigUint64(0, data.betId, true);
   dv.setBigUint64(8, data.amount, true);
   dv.setUint32(16, assertU32Bigint('minOddsScaled', data.minOddsScaled), true);
   out[20] = data.numLegs & 0xff;
   out.set(padParlayLegTableBytes(data.legs, data.numLegs), 21);
   return out;
}

export function decodeFillParlayIxData(data: ReadonlyUint8Array): FillParlayIxData {
   if (data.length !== FILL_PARLAY_IX_DATA_LEN) {
      throw new RangeError(`fill_parlay body len ${data.length}; expected ${FILL_PARLAY_IX_DATA_LEN}`);
   }
   const u8 = new Uint8Array(data);
   const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
   const betId = dv.getBigUint64(0, true);
   const amount = dv.getBigUint64(8, true);
   const minOddsScaled = BigInt(dv.getUint32(16, true) >>> 0);
   const numLegs = u8[20]!;
   if (numLegs < 2 || numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`fill_parlay numLegs invalid: ${numLegs}`);
   }
   const allLegs = decodeParlayLegTableBytes(u8.subarray(21, 21 + PARLAY_LEG_TABLE_LEN));
   return {
      betId,
      amount,
      minOddsScaled,
      numLegs,
      legs: allLegs.slice(0, numLegs),
   };
}

export function encodeGetQuoteParlayIxData(ix: GetQuoteParlayIxData): Uint8Array {
   if (ix.instructionDiscriminator !== MM_GET_QUOTE_PARLAY_IX_DISCRIMINATOR) {
      throw new RangeError(
         `get_quote_parlay instructionDiscriminator must be ${MM_GET_QUOTE_PARLAY_IX_DISCRIMINATOR}`,
      );
   }
   validateGetQuoteParlayIxData(
      { amount: ix.amount, oddsScaled: ix.oddsScaled, numLegs: ix.numLegs, legs: ix.legs },
      'getQuoteParlay',
   );
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
   if (ix.instructionDiscriminator !== MM_FILL_QUOTE_PARLAY_IX_DISCRIMINATOR) {
      throw new RangeError(
         `fill_parlay_quote instructionDiscriminator must be ${MM_FILL_QUOTE_PARLAY_IX_DISCRIMINATOR}`,
      );
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

const getAddLineToNettingIxPayloadEncoder = (): Encoder<AddLineToNettingIxData> =>
   getStructEncoder([
      ['eventId', getEventIdEncoder()],
      ['period', getU8Encoder()],
      ['mkt', getU16Encoder()],
   ]);

const getAddLineToNettingIxPayloadDecoder = (): Decoder<AddLineToNettingIxData> =>
   getStructDecoder([
      ['eventId', getEventIdDecoder()],
      ['period', getU8Decoder()],
      ['mkt', getU16Decoder()],
   ]);

const getRemoveLineFromNettingIxPayloadEncoder = (): Encoder<RemoveLineFromNettingIxData> =>
   getAddLineToNettingIxPayloadEncoder() as Encoder<RemoveLineFromNettingIxData>;

const getRemoveLineFromNettingIxPayloadDecoder = (): Decoder<RemoveLineFromNettingIxData> =>
   getAddLineToNettingIxPayloadDecoder() as Decoder<RemoveLineFromNettingIxData>;

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

function concatDiscriminator(disc: number, payload: ReadonlyUint8Array | Uint8Array): Uint8Array {
   const p = new Uint8Array(payload);
   const out = new Uint8Array(1 + p.length);
   out[0] = disc & 0xff;
   out.set(p, 1);
   return out;
}

export function encodeAggregatorInstructionData(ix: DecodedAggregatorInstruction): Uint8Array {
   switch (ix.kind) {
      case 'initProgram': {
         const payload = getU64Encoder().encode(ix.recentSlot);
         if (payload.length !== 8) {
            throw new RangeError('initProgram: recentSlot encoding must be 8 bytes');
         }
         return concatDiscriminator(INIT_PROGRAM_IX_DISCRIMINATOR, payload);
      }
      case 'changeConfigStatus': {
         if (ix.status !== 0 && ix.status !== 1) {
            throw new RangeError('changeConfigStatus.status must be 0 or 1');
         }
         return new Uint8Array([CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR, ix.status]);
      }
      case 'registerMm':
         return new Uint8Array([REGISTER_MM_IX_DISCRIMINATOR]);
      case 'deregisterMm':
         return new Uint8Array([DEREGISTER_MM_IX_DISCRIMINATOR]);
      case 'fillBet': {
         const p = getFillBetIxDataEncoder().encode(ix.data);
         if (p.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`fill bet payload length ${p.length}`);
         }
         return concatDiscriminator(FILL_BET_IX_DISCRIMINATOR, p);
      }
      case 'fillParlay': {
         const p = encodeFillParlayIxData(ix.data);
         if (p.length !== FILL_PARLAY_IX_DATA_LEN) {
            throw new RangeError(`fill parlay payload length ${p.length}`);
         }
         return concatDiscriminator(FILL_PARLAY_IX_DISCRIMINATOR, p);
      }
      case 'getQuoteProxy': {
         const p = getFillBetIxDataEncoder().encode(ix.data);
         if (p.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`get quote proxy payload length ${p.length}`);
         }
         return concatDiscriminator(GET_QUOTE_PROXY_IX_DISCRIMINATOR, p);
      }
      case 'getParlayQuoteProxy': {
         const p = encodeFillParlayIxData(ix.data);
         if (p.length !== FILL_PARLAY_IX_DATA_LEN) {
            throw new RangeError(`get parlay quote proxy payload length ${p.length}`);
         }
         return concatDiscriminator(GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR, p);
      }
      case 'gradeBets': {
         if (ix.betResults.length === 0) {
            throw new RangeError('gradeBets requires at least one result byte');
         }
         return concatDiscriminator(GRADE_BETS_IX_DISCRIMINATOR, new Uint8Array(ix.betResults));
      }
      case 'settleBet':
         return new Uint8Array([SETTLE_BET_IX_DISCRIMINATOR]);
      case 'settleParlay':
         return new Uint8Array([SETTLE_PARLAY_IX_DISCRIMINATOR]);
      case 'createNettingAccount': {
         const p = getEventIdEncoder().encode(ix.eventId);
         if (p.length !== EVENT_ID_WIRE_SIZE) {
            throw new RangeError(`event id payload length ${p.length}`);
         }
         return concatDiscriminator(CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR, p);
      }
      case 'addLineToNettingAccount': {
         const p = getAddLineToNettingIxPayloadEncoder().encode(ix.data);
         if (p.length !== ADD_LINE_TO_LIABILITY_NETTING_IX_LEN) {
            throw new RangeError(`add line payload length ${p.length}`);
         }
         return concatDiscriminator(ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR, p);
      }
      case 'removeLineFromNettingAccount': {
         const p = getRemoveLineFromNettingIxPayloadEncoder().encode(ix.data);
         if (p.length !== REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN) {
            throw new RangeError(`remove line payload length ${p.length}`);
         }
         return concatDiscriminator(REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR, p);
      }
      case 'closeNettingAccount': {
         const p = getEventIdEncoder().encode(ix.eventId);
         if (p.length !== EVENT_ID_WIRE_SIZE) {
            throw new RangeError(`event id payload length ${p.length}`);
         }
         return concatDiscriminator(CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR, p);
      }
      case 'withdrawFromLiabilityAccount': {
         const p = getU64Encoder().encode(ix.amount);
         return concatDiscriminator(WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR, p);
      }
      case 'writeArbitraryData': {
         return concatDiscriminator(WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR, ix.data);
      }
      case 'forceClosePda':
         return new Uint8Array([FORCE_CLOSE_PDA_IX_DISCRIMINATOR]);
      default: {
         const _exhaustive: never = ix;
         throw new Error(`unreachable: ${String(_exhaustive)}`);
      }
   }
}

export function decodeAggregatorInstructionData(data: ReadonlyUint8Array): DecodedAggregatorInstruction {
   if (data.length === 0) {
      throw new RangeError('instruction data empty');
   }
   const disc = data[0]!;
   const rest = data.subarray(1);
   const restBytes = new Uint8Array(rest);
   switch (disc) {
      case INIT_PROGRAM_IX_DISCRIMINATOR:
         if (rest.length !== 8) {
            throw new RangeError('initProgram: expected 8-byte recentSlot (u64 le)');
         }
         return { kind: 'initProgram', recentSlot: getU64Decoder().decode(restBytes) };
      case CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR:
         if (rest.length !== 1) {
            throw new RangeError('changeConfigStatus: expected 1 byte');
         }
         if (rest[0] !== 0 && rest[0] !== 1) {
            throw new RangeError('changeConfigStatus: status must be 0 or 1');
         }
         return { kind: 'changeConfigStatus', status: rest[0] as 0 | 1 };
      case REGISTER_MM_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('registerMm: expected no payload');
         }
         return { kind: 'registerMm' };
      case DEREGISTER_MM_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('deregisterMm: expected no payload');
         }
         return { kind: 'deregisterMm' };
      case FILL_BET_IX_DISCRIMINATOR:
         if (rest.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`fillBet: expected ${FILL_BET_IX_DATA_LEN} bytes`);
         }
         return { kind: 'fillBet', data: getFillBetIxDataDecoder().decode(restBytes) };
      case FILL_PARLAY_IX_DISCRIMINATOR:
         if (rest.length !== FILL_PARLAY_IX_DATA_LEN) {
            throw new RangeError(`fillParlay: expected ${FILL_PARLAY_IX_DATA_LEN} bytes`);
         }
         return { kind: 'fillParlay', data: decodeFillParlayIxData(restBytes) };
      case GET_QUOTE_PROXY_IX_DISCRIMINATOR:
         if (rest.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`getQuoteProxy: expected ${FILL_BET_IX_DATA_LEN} bytes`);
         }
         return { kind: 'getQuoteProxy', data: getFillBetIxDataDecoder().decode(restBytes) };
      case GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR:
         if (rest.length !== FILL_PARLAY_IX_DATA_LEN) {
            throw new RangeError(`getParlayQuoteProxy: expected ${FILL_PARLAY_IX_DATA_LEN} bytes`);
         }
         return { kind: 'getParlayQuoteProxy', data: decodeFillParlayIxData(restBytes) };
      case GRADE_BETS_IX_DISCRIMINATOR:
         if (rest.length === 0) {
            throw new RangeError('gradeBets: expected at least one byte');
         }
         return { kind: 'gradeBets', betResults: new Uint8Array(rest) };
      case SETTLE_BET_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('settleBet: expected no payload');
         }
         return { kind: 'settleBet' };
      case SETTLE_PARLAY_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('settleParlay: expected no payload');
         }
         return { kind: 'settleParlay' };
      case CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR:
         if (rest.length !== EVENT_ID_WIRE_SIZE) {
            throw new RangeError(`createNettingAccount: expected ${EVENT_ID_WIRE_SIZE} bytes`);
         }
         return { kind: 'createNettingAccount', eventId: getEventIdDecoder().decode(restBytes) };
      case ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR:
         if (rest.length !== ADD_LINE_TO_LIABILITY_NETTING_IX_LEN) {
            throw new RangeError(`addLineToNettingAccount: expected ${ADD_LINE_TO_LIABILITY_NETTING_IX_LEN} bytes`);
         }
         return { kind: 'addLineToNettingAccount', data: getAddLineToNettingIxPayloadDecoder().decode(restBytes) };
      case REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR:
         if (rest.length !== REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN) {
            throw new RangeError(
               `removeLineFromNettingAccount: expected ${REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN} bytes`,
            );
         }
         return {
            kind: 'removeLineFromNettingAccount',
            data: getRemoveLineFromNettingIxPayloadDecoder().decode(restBytes),
         };
      case CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR:
         if (rest.length !== EVENT_ID_WIRE_SIZE) {
            throw new RangeError(`closeNettingAccount: expected ${EVENT_ID_WIRE_SIZE} bytes`);
         }
         return { kind: 'closeNettingAccount', eventId: getEventIdDecoder().decode(restBytes) };
      case WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR:
         if (rest.length !== 8) {
            throw new RangeError('withdrawFromLiabilityAccount: expected 8 bytes');
         }
         return { kind: 'withdrawFromLiabilityAccount', amount: getU64Decoder().decode(restBytes) };
      case WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR:
         if (rest.length === 0) {
            throw new RangeError('writeArbitraryData: expected at least one payload byte');
         }
         return { kind: 'writeArbitraryData', data: new Uint8Array(rest) };
      case FORCE_CLOSE_PDA_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('forceClosePda: expected no payload');
         }
         return { kind: 'forceClosePda' };
      default:
         throw new RangeError(`unknown instruction discriminator: ${disc}`);
   }
}

/** Full CPI payload to SPAMM `get_quote` (first byte = `MM_GET_QUOTE_IX_DISCRIMINATOR` in `instructions.ts`). */
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

export function decodeMmReturnData(data: ReadonlyUint8Array): MmReturnData {
   if (data.length !== MM_RETURN_DATA_LEN) {
      throw new RangeError(`mm return data len ${data.length}`);
   }
   return getMmReturnDataDecoder().decode(new Uint8Array(data));
}

/** Full CPI payload to SPAMM `fill_quote` (first byte = `MM_FILL_QUOTE_IX_DISCRIMINATOR` in `instructions.ts`). */
export function encodeFillQuoteIxData(ix: FillQuoteIxData): Uint8Array {
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

export const decodeMmQuoteBuffer = (data: ReadonlyUint8Array): MmQuoteBuffer => {
   if (data.length !== MM_QUOTE_BUFFER_LEN) {
      throw new RangeError(`mm quote buffer len ${data.length}`);
   }
   return getMmQuoteBufferDecoder().decode(new Uint8Array(data));
};

export const decodeConfigPdaData = (data: ReadonlyUint8Array): ConfigPdaData => {
   if (data.length !== CONFIG_PDA_LEN) {
      throw new RangeError(`config pda len ${data.length}`);
   }
   return getConfigPdaDataDecoder().decode(new Uint8Array(data));
};

export const decodeEventStateData = (data: ReadonlyUint8Array): EventStateData => {
   if (data.length !== EVENT_STATE_LEN) {
      throw new RangeError(`event state len ${data.length}`);
   }
   return getEventStateDataDecoder().decode(new Uint8Array(data));
};

export const decodeMmEncumbrancePdaData = (data: ReadonlyUint8Array): MmEncumbrancePdaData => {
   if (data.length !== MM_ENCUMBRANCE_PDA_LEN) {
      throw new RangeError(`mm encumbrance len ${data.length}`);
   }
   return getMmEncumbrancePdaDataDecoder().decode(new Uint8Array(data));
};

export const decodeMmMarketDataPdaData = (data: ReadonlyUint8Array): MmMarketDataPdaData => {
   if (data.length < MM_MARKET_DATA_PDA_MIN_LEN) {
      throw new RangeError(`mm market data len ${data.length}`);
   }
   return getMmMarketDataPdaDataDecoder().decode(new Uint8Array(data.subarray(0, MM_MARKET_DATA_PDA_MIN_LEN)));
};

export const decodeMmAccountConfig = (data: ReadonlyUint8Array): MmAccountConfig => {
   if (data.length < MM_ACCOUNT_CONFIG_MIN_LEN) {
      throw new RangeError(`mm account config len ${data.length}`);
   }
   return getMmAccountConfigDecoder().decode(new Uint8Array(data.subarray(0, MM_ACCOUNT_CONFIG_MIN_LEN)));
};

export const decodeBetAccountDataStrict = (data: ReadonlyUint8Array): BetAccountData => {
   if (data.length !== BET_ACCOUNT_LEN) {
      throw new RangeError(`bet account len ${data.length}`);
   }
   return decodeBetAccountData(data);
};

export const decodeParlayBetAccountDataStrict = (data: ReadonlyUint8Array): ParlayBetAccountData => {
   if (data.length !== PARLAY_BET_ACCOUNT_LEN) {
      throw new RangeError(`parlay bet account len ${data.length}; expected ${PARLAY_BET_ACCOUNT_LEN}`);
   }
   const decoded = getParlayBetAccountDataDecoder().decode(new Uint8Array(data));
   if (decoded.discriminator !== PARLAY_BET_ACCOUNT_DISCRIMINATOR) {
      throw new RangeError(`parlay bet discriminator ${decoded.discriminator}; expected ${PARLAY_BET_ACCOUNT_DISCRIMINATOR}`);
   }
   if (decoded.numLegs < 2 || decoded.numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`parlay bet numLegs ${decoded.numLegs}`);
   }
   return decoded;
};
