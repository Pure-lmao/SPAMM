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
   type Address,
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
   FILL_RFQ_BET_IX_DISCRIMINATOR,
   FILL_RFQ_PARLAY_IX_DISCRIMINATOR,
   GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR,
   GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR,
   GET_QUOTE_PROXY_IX_DISCRIMINATOR,
   FORCE_CLOSE_PDA_IX_DISCRIMINATOR,
   GRADE_BETS_IX_DISCRIMINATOR,
   GRADE_PARLAY_IX_DISCRIMINATOR,
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
   type FillRfqBetIxBody,
   type FillRfqBetIxData,
   type FillRfqParlayIxBody,
   type FillRfqParlayIxData,
   type RfqBetMessageInput,
   type RfqParlayMessageInput,
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
   type ProxyMarketMmQuotes,
   type ProxyQuoteData,
   type ProxyParlayQuoteData,
   MARKET_QUOTES_PROXY_RETURN_MAX,
   PROXY_MARKET_SIDE_ODDS_WIRE_LEN,
   PROXY_PARLAY_QUOTE_DATA_LEN,
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
   FILL_RFQ_BET_IX_BODY_LEN,
   FILL_RFQ_BET_IX_DATA_LEN,
   FILL_RFQ_PARLAY_IX_BODY_LEN,
   FILL_RFQ_PARLAY_IX_DATA_LEN,
   RFQ_BET_MESSAGE_LEN,
   RFQ_PARLAY_MESSAGE_LEN,
   RFQ_SIGNED_PARLAY_LEG_LEN,
   RFQ_SIGNED_PARLAY_LEG_TABLE_LEN,
   FILL_PARLAY_IX_DATA_LEN,
   RFQ_SIGNATURE_LEN,
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

import { validateFillParlayIxData, validateFillRfqBetIxData, validateFillRfqParlayIxData, validateGetQuoteParlayIxData } from './validate.js';

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
      ['operator', getAddressEncoder()],
   ]);

export const getMarketIdDecoder = (): Decoder<MarketId> =>
   getStructDecoder([
      ['eventId', getEventIdDecoder()],
      ['player', getU64Decoder()],
      ['mkt', getU16Decoder()],
      ['period', getU8Decoder()],
      ['isPregame', getBoolU8Decoder()],
      ['operator', getAddressDecoder()],
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
      ['timestamp', getU32Encoder()],
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
      ['timestamp', getU32Decoder()],
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
   return getNettingPdaAccountDataDecoder().decode(new Uint8Array(data));
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
   out.set(getNettingPdaAccountDataEncoder().encode(account), 0);
   return out;
};

const getNettingPdaAccountDataEncoder = (): Encoder<NettingPdaAccountData> =>
   transformEncoder(
      getStructEncoder([
         ['header', getNettingPdaHeaderEncoder()],
         ['linesBytes', getBytesEncoder()],
      ]),
      (account) => {
         const { lines, ...header } = account;
         const lineEnc = getNettingLineEncoder();
         const linesBytes = new Uint8Array(lines.length * NETTING_LINE_LEN);
         for (let i = 0; i < lines.length; i++) {
            linesBytes.set(new Uint8Array(lineEnc.encode(lines[i]!)), i * NETTING_LINE_LEN);
         }
         return { header, linesBytes };
      },
   );

const getNettingPdaAccountDataDecoder = (): Decoder<NettingPdaAccountData> =>
   transformDecoder(
      getStructDecoder([
         ['header', getNettingPdaHeaderDecoder()],
         ['linesBytes', getBytesDecoder()],
      ]),
      (wire) => {
         const n = wire.header.numberOfLines;
         if (n > NETTING_DEFAULT_LINE_CAPACITY) {
            throw new RangeError(`numberOfLines ${n} exceeds capacity ${NETTING_DEFAULT_LINE_CAPACITY}`);
         }
         const expectedLinesLen = n * NETTING_LINE_LEN;
         if (wire.linesBytes.length < expectedLinesLen) {
            throw new RangeError(
               `netting lines bytes ${wire.linesBytes.length} < expected ${expectedLinesLen}`,
            );
         }
         const lineDec = getNettingLineDecoder();
         const lines: NettingLine[] = [];
         for (let i = 0; i < n; i++) {
            const off = i * NETTING_LINE_LEN;
            lines.push(lineDec.decode(wire.linesBytes.subarray(off, off + NETTING_LINE_LEN)));
         }
         return { ...wire.header, lines };
      },
   );

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
      ['rfqSigner', getAddressEncoder()],
   ]);

export const getMmAccountConfigDecoder = (): Decoder<MmAccountConfig> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['admin', getAddressDecoder()],
      ['rfqSigner', getAddressDecoder()],
   ]);

const getMmListPdaDataEncoder = (): Encoder<MmListPdaData> =>
   transformEncoder(
      getStructEncoder([
         ['discriminator', getU8Encoder()],
         ['numberOfMms', getU16Encoder()],
         ['mmProgramAddressesBytes', getBytesEncoder()],
      ]),
      (list) => {
         if (list.numberOfMms !== list.mmProgramAddresses.length) {
            throw new RangeError('numberOfMms must match mmProgramAddresses.length');
         }
         const addrEnc = getAddressEncoder();
         const mmProgramAddressesBytes = new Uint8Array(list.mmProgramAddresses.length * 32);
         for (let i = 0; i < list.mmProgramAddresses.length; i++) {
            mmProgramAddressesBytes.set(addrEnc.encode(list.mmProgramAddresses[i]!), i * 32);
         }
         return {
            discriminator: list.discriminator,
            numberOfMms: list.numberOfMms,
            mmProgramAddressesBytes,
         };
      },
   );

const getMmListPdaDataDecoder = (): Decoder<MmListPdaData> =>
   transformDecoder(
      getStructDecoder([
         ['discriminator', getU8Decoder()],
         ['numberOfMms', getU16Decoder()],
         ['mmProgramAddressesBytes', getBytesDecoder()],
      ]),
      (wire) => {
         const n = wire.numberOfMms;
         const expectedLen = n * 32;
         if (wire.mmProgramAddressesBytes.length !== expectedLen) {
            throw new RangeError(
               `mm_list addresses bytes ${wire.mmProgramAddressesBytes.length} !== expected ${expectedLen}`,
            );
         }
         const addrDec = getAddressDecoder();
         const mmProgramAddresses: Address[] = [];
         for (let i = 0; i < n; i++) {
            const off = i * 32;
            mmProgramAddresses.push(
               addrDec.decode(wire.mmProgramAddressesBytes.subarray(off, off + 32)),
            );
         }
         return {
            discriminator: wire.discriminator,
            numberOfMms: n,
            mmProgramAddresses,
         };
      },
   );

export const decodeMmListPdaData = (data: ReadonlyUint8Array): MmListPdaData => {
   if (data.length < MM_LIST_HEADER_LEN) {
      throw new RangeError(`mm_list data too short: ${data.length}`);
   }
   const decoded = getMmListPdaDataDecoder().decode(new Uint8Array(data));
   const expectLen = MM_LIST_HEADER_LEN + decoded.numberOfMms * 32;
   if (data.length !== expectLen) {
      throw new RangeError(`mm_list data length ${data.length} !== expected ${expectLen}`);
   }
   return decoded;
};

export const encodeMmListPdaData = (list: MmListPdaData): Uint8Array => {
   return new Uint8Array(getMmListPdaDataEncoder().encode(list));
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

const getProxyParlayQuoteDataWireDecoder = () =>
   getStructDecoder([
      ['mmAddress', getAddressDecoder()],
      ['maxAmount', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['numLegs', getU8Decoder()],
      ['legOdds0', getU32BigintDecoder()],
      ['legOdds1', getU32BigintDecoder()],
      ['legOdds2', getU32BigintDecoder()],
      ['legOdds3', getU32BigintDecoder()],
      ['legOdds4', getU32BigintDecoder()],
   ]);

const getProxyParlayQuoteDataDecoder = (): Decoder<ProxyParlayQuoteData> =>
   transformDecoder(getProxyParlayQuoteDataWireDecoder(), (row) => ({
      mmAddress: row.mmAddress,
      maxAmount: row.maxAmount,
      oddsScaled: row.oddsScaled,
      numLegs: row.numLegs,
      legOdds: [row.legOdds0, row.legOdds1, row.legOdds2, row.legOdds3, row.legOdds4],
   }));

/** Return data from aggregator `get_parlay_quote_proxy` (0..N × `ProxyParlayQuoteData`). */
export function decodeProxyParlayQuoteReturnData(data: ReadonlyUint8Array): ProxyParlayQuoteData[] {
   if (data.length % PROXY_PARLAY_QUOTE_DATA_LEN !== 0) {
      throw new RangeError(
         `parlay proxy quote return data len ${data.length} is not a multiple of ${PROXY_PARLAY_QUOTE_DATA_LEN}`,
      );
   }
   const decoder = getProxyParlayQuoteDataDecoder();
   const quotes: ProxyParlayQuoteData[] = [];
   const bytes = new Uint8Array(data);
   for (let offset = 0; offset < bytes.length; offset += PROXY_PARLAY_QUOTE_DATA_LEN) {
      quotes.push(decoder.decode(bytes.subarray(offset, offset + PROXY_PARLAY_QUOTE_DATA_LEN)));
   }
   return quotes;
}

const getProxyMarketMmQuotesEntryDecoder = (numSides: number): Decoder<ProxyMarketMmQuotes> => {
   const entryLen = 32 + numSides * PROXY_MARKET_SIDE_ODDS_WIRE_LEN;
   return transformDecoder(fixDecoderSize(getBytesDecoder(), entryLen), (raw) => {
      const mmAddress = getAddressDecoder().decode(raw.subarray(0, 32));
      const oddsScaled: bigint[] = [];
      const oddsDec = getU32BigintDecoder();
      for (let s = 0; s < numSides; s++) {
         const off = 32 + s * PROXY_MARKET_SIDE_ODDS_WIRE_LEN;
         oddsScaled.push(oddsDec.decode(raw.subarray(off, off + PROXY_MARKET_SIDE_ODDS_WIRE_LEN)));
      }
      return { mmAddress, oddsScaled };
   });
};

/** Return data from aggregator `get_market_quotes_proxy` (fixed-size MM chunks; `numSides` from `mkt`). */
export function decodeMarketQuotesProxyReturnData(
   data: ReadonlyUint8Array,
   numSides: number,
): ProxyMarketMmQuotes[] {
   if (numSides <= 0) {
      throw new RangeError('numSides must be positive');
   }
   const entryLen = 32 + numSides * PROXY_MARKET_SIDE_ODDS_WIRE_LEN;
   if (data.length === 0 || data.length % entryLen !== 0) {
      throw new RangeError(
         `market quotes return data len ${data.length} is not a multiple of ${entryLen}`,
      );
   }
   if (data.length > MARKET_QUOTES_PROXY_RETURN_MAX) {
      throw new RangeError(`market quotes return data exceeds ${MARKET_QUOTES_PROXY_RETURN_MAX} bytes`);
   }
   const decoder = getProxyMarketMmQuotesEntryDecoder(numSides);
   const quotes: ProxyMarketMmQuotes[] = [];
   const bytes = new Uint8Array(data);
   for (let offset = 0; offset < bytes.length; offset += entryLen) {
      quotes.push(decoder.decode(bytes.subarray(offset, offset + entryLen)));
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
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['result', getBetResultU8Encoder()],
   ]);

export const getParlayLegWireDecoder = (): Decoder<ParlayLegWire> =>
   getStructDecoder([
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['result', getBetResultU8Decoder()],
   ]);

/** Pad `ParlayLegTable` wire to `MAX_PARLAY_LEGS` slots; unused slots are zero. */
export function padParlayLegTableBytes(legs: readonly ParlayLegWire[], numLegs: number): Uint8Array {
   if (numLegs < 1 || numLegs > MAX_PARLAY_LEGS || legs.length < numLegs) {
      throw new RangeError('padParlayLegTableBytes: invalid legs / numLegs');
   }
   const enc = getParlayLegWireEncoder();
   const out = new Uint8Array(PARLAY_LEG_TABLE_LEN);
   for (let i = 0; i < MAX_PARLAY_LEGS; i++) {
      if (i < numLegs) {
         out.set(enc.encode(legs[i]!), i * PARLAY_LEG_WIRE_LEN);
      }
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

function decodeParlayLegsFromTable(numLegs: number, legsTable: ReadonlyUint8Array): readonly ParlayLegWire[] {
   if (numLegs < 2 || numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`parlay numLegs invalid: ${numLegs}`);
   }
   return decodeParlayLegTableBytes(legsTable).slice(0, numLegs);
}

const getParlayBetAccountDataDecoder = (): Decoder<ParlayBetAccountData> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['owner', getAddressDecoder()],
      ['feepayer', getAddressDecoder()],
      ['betId', getU64Decoder()],
      ['amount', getU64Decoder()],
      ['payout', getU64Decoder()],
      ['timestamp', getU32Decoder()],
      ['fillerAddress', getAddressDecoder()],
      ['result', getBetResultU8Decoder()],
      ['numLegs', getU8Decoder()],
      ['legs', getParlayLegTableWireDecoder()],
   ]);

export const getFillParlayIxDataEncoder = (): Encoder<FillParlayIxData> =>
   transformEncoder(
      getStructEncoder([
         ['betId', getU64Encoder()],
         ['amount', getU64Encoder()],
         ['minOddsScaled', getU32BigintEncoder('minOddsScaled')],
         ['numLegs', getU8Encoder()],
         ['legsTable', fixEncoderSize(getBytesEncoder(), PARLAY_LEG_TABLE_LEN)],
      ]),
      (data) => ({
         betId: data.betId,
         amount: data.amount,
         minOddsScaled: data.minOddsScaled,
         numLegs: data.numLegs,
         legsTable: padParlayLegTableBytes(data.legs, data.numLegs),
      }),
   );

export const getFillParlayIxDataDecoder = (): Decoder<FillParlayIxData> =>
   transformDecoder(
      getStructDecoder([
         ['betId', getU64Decoder()],
         ['amount', getU64Decoder()],
         ['minOddsScaled', getU32BigintDecoder()],
         ['numLegs', getU8Decoder()],
         ['legsTable', fixDecoderSize(getBytesDecoder(), PARLAY_LEG_TABLE_LEN)],
      ]),
      (decoded) => ({
         betId: decoded.betId,
         amount: decoded.amount,
         minOddsScaled: decoded.minOddsScaled,
         numLegs: decoded.numLegs,
         legs: decodeParlayLegsFromTable(decoded.numLegs, decoded.legsTable),
      }),
   );

export function encodeFillParlayIxData(data: FillParlayIxData): Uint8Array {
   validateFillParlayIxData(data);
   const out = getFillParlayIxDataEncoder().encode(data);
   if (out.length !== FILL_PARLAY_IX_DATA_LEN) {
      throw new RangeError(`fill_parlay body len ${out.length}; expected ${FILL_PARLAY_IX_DATA_LEN}`);
   }
   return new Uint8Array(out);
}

export function decodeFillParlayIxData(data: ReadonlyUint8Array): FillParlayIxData {
   if (data.length !== FILL_PARLAY_IX_DATA_LEN) {
      throw new RangeError(`fill_parlay body len ${data.length}; expected ${FILL_PARLAY_IX_DATA_LEN}`);
   }
   return getFillParlayIxDataDecoder().decode(new Uint8Array(data));
}

export const getGetQuoteParlayIxDataEncoder = (): Encoder<GetQuoteParlayIxData> =>
   transformEncoder(
      getStructEncoder([
         ['instructionDiscriminator', getU8Encoder()],
         ['amount', getU64Encoder()],
         ['oddsScaled', getU32BigintEncoder('oddsScaled')],
         ['numLegs', getU8Encoder()],
         ['legsTable', fixEncoderSize(getBytesEncoder(), PARLAY_LEG_TABLE_LEN)],
      ]),
      (ix) => ({
         instructionDiscriminator: ix.instructionDiscriminator,
         amount: ix.amount,
         oddsScaled: ix.oddsScaled,
         numLegs: ix.numLegs,
         legsTable: padParlayLegTableBytes(ix.legs, ix.numLegs),
      }),
   );

export const getGetQuoteParlayIxDataDecoder = (): Decoder<GetQuoteParlayIxData> =>
   transformDecoder(
      getStructDecoder([
         ['instructionDiscriminator', getU8Decoder()],
         ['amount', getU64Decoder()],
         ['oddsScaled', getU32BigintDecoder()],
         ['numLegs', getU8Decoder()],
         ['legsTable', fixDecoderSize(getBytesDecoder(), PARLAY_LEG_TABLE_LEN)],
      ]),
      (decoded) => ({
         instructionDiscriminator: decoded.instructionDiscriminator,
         amount: decoded.amount,
         oddsScaled: decoded.oddsScaled,
         numLegs: decoded.numLegs,
         legs: decodeParlayLegsFromTable(decoded.numLegs, decoded.legsTable),
      }),
   );

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
   const out = getGetQuoteParlayIxDataEncoder().encode(ix);
   if (out.length !== GET_QUOTE_PARLAY_IX_WIRE_LEN) {
      throw new RangeError(`get_quote_parlay wire len ${out.length}`);
   }
   return new Uint8Array(out);
}

export function decodeGetQuoteParlayIxData(data: ReadonlyUint8Array): GetQuoteParlayIxData {
   if (data.length !== GET_QUOTE_PARLAY_IX_WIRE_LEN) {
      throw new RangeError(`get_quote_parlay wire len ${data.length}`);
   }
   return getGetQuoteParlayIxDataDecoder().decode(new Uint8Array(data));
}

export const getFillParlayQuoteIxDataEncoder = (): Encoder<FillParlayQuoteIxData> =>
   getStructEncoder([
      ['instructionDiscriminator', getU8Encoder()],
      ['amountToFill', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['amountToSend', getU64Encoder()],
   ]);

export const getFillParlayQuoteIxDataDecoder = (): Decoder<FillParlayQuoteIxData> =>
   getStructDecoder([
      ['instructionDiscriminator', getU8Decoder()],
      ['amountToFill', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['amountToSend', getU64Decoder()],
   ]);

export function encodeFillParlayQuoteIxData(ix: FillParlayQuoteIxData): Uint8Array {
   if (ix.instructionDiscriminator !== MM_FILL_QUOTE_PARLAY_IX_DISCRIMINATOR) {
      throw new RangeError(
         `fill_parlay_quote instructionDiscriminator must be ${MM_FILL_QUOTE_PARLAY_IX_DISCRIMINATOR}`,
      );
   }
   const out = getFillParlayQuoteIxDataEncoder().encode(ix);
   if (out.length !== FILL_QUOTE_PARLAY_IX_WIRE_LEN) {
      throw new RangeError(`fill_parlay_quote wire len ${out.length}`);
   }
   return new Uint8Array(out);
}

export function decodeFillParlayQuoteIxData(data: ReadonlyUint8Array): FillParlayQuoteIxData {
   if (data.length !== FILL_QUOTE_PARLAY_IX_WIRE_LEN) {
      throw new RangeError(`fill_parlay_quote wire len ${data.length}`);
   }
   return getFillParlayQuoteIxDataDecoder().decode(new Uint8Array(data));
}

/** One parlay leg in an RFQ signed message (`RfqSignedParlayLeg` on-chain). */
export type RfqSignedParlayLeg = Pick<
   ParlayLegWire,
   'marketId' | 'eventGameState' | 'eventStateSequence' | 'side' | 'oddsScaled'
>;

const getRfqSignedParlayLegEncoder = (): Encoder<RfqSignedParlayLeg> =>
   getStructEncoder([
      ['marketId', getMarketIdEncoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['eventStateSequence', getU16Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['side', getU8Encoder()],
   ]);

function rfqSignedParlayLegFromWire(leg: ParlayLegWire): RfqSignedParlayLeg {
   return {
      marketId: leg.marketId,
      eventGameState: leg.eventGameState,
      eventStateSequence: leg.eventStateSequence,
      side: leg.side,
      oddsScaled: leg.oddsScaled,
   };
}

function rfqSignedParlayLegPlaceholder(): RfqSignedParlayLeg {
   return {
      marketId: {
         eventId: { event: 0n, league: 0, sport: 0 },
         player: 0n,
         mkt: 0,
         period: 0,
         isPregame: false,
         operator: '11111111111111111111111111111111' as Address,
      },
      side: 0,
      eventStateSequence: 0,
      eventGameState: { gamePhase: '', homePrimary: 0, awayPrimary: 0, homeSecondary: 0, awaySecondary: 0 },
      oddsScaled: 10_000n,
   };
}

/** Pad RFQ signed parlay leg slots to `MAX_PARLAY_LEGS`; unused slots are placeholders. */
export function padRfqSignedParlayLegTableBytes(
   legs: readonly ParlayLegWire[],
   numLegs: number,
): Uint8Array {
   if (numLegs < 1 || numLegs > MAX_PARLAY_LEGS || legs.length < numLegs) {
      throw new RangeError('padRfqSignedParlayLegTableBytes: invalid legs / numLegs');
   }
   const enc = getRfqSignedParlayLegEncoder();
   const out = new Uint8Array(RFQ_SIGNED_PARLAY_LEG_TABLE_LEN);
   for (let i = 0; i < MAX_PARLAY_LEGS; i++) {
      const leg =
         i < numLegs && legs[i] != null
            ? rfqSignedParlayLegFromWire(legs[i]!)
            : rfqSignedParlayLegPlaceholder();
      out.set(enc.encode(leg), i * RFQ_SIGNED_PARLAY_LEG_LEN);
   }
   return out;
}

const getFillRfqBetIxBodyEncoder = (): Encoder<FillRfqBetIxBody> =>
   getStructEncoder([
      ['betId', getU64Encoder()],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['maxStake', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['offerExpiry', getU32Encoder()],
   ]);

export function encodeFillRfqBetIxBody(data: FillRfqBetIxBody): Uint8Array {
   const out = getFillRfqBetIxBodyEncoder().encode(data);
   if (out.length !== FILL_RFQ_BET_IX_BODY_LEN) {
      throw new RangeError(`fillRfqBet body len ${out.length}; expected ${FILL_RFQ_BET_IX_BODY_LEN}`);
   }
   return new Uint8Array(out);
}

const getFillRfqParlayIxBodyEncoder = (): Encoder<FillRfqParlayIxBody> =>
   transformEncoder(
      getStructEncoder([
         ['betId', getU64Encoder()],
         ['amount', getU64Encoder()],
         ['numLegs', getU8Encoder()],
         ['legsTable', fixEncoderSize(getBytesEncoder(), PARLAY_LEG_TABLE_LEN)],
         ['maxStake', getU64Encoder()],
         ['oddsScaled', getU32BigintEncoder('oddsScaled')],
         ['offerExpiry', getU32Encoder()],
      ]),
      (data) => ({
         betId: data.betId,
         amount: data.amount,
         numLegs: data.numLegs,
         legsTable: padParlayLegTableBytes(data.legs, data.numLegs),
         maxStake: data.maxStake,
         oddsScaled: data.oddsScaled,
         offerExpiry: data.offerExpiry,
      }),
   );

const getFillRfqParlayIxBodyDecoder = (): Decoder<FillRfqParlayIxBody> =>
   transformDecoder(
      getStructDecoder([
         ['betId', getU64Decoder()],
         ['amount', getU64Decoder()],
         ['numLegs', getU8Decoder()],
         ['legsTable', fixDecoderSize(getBytesDecoder(), PARLAY_LEG_TABLE_LEN)],
         ['maxStake', getU64Decoder()],
         ['oddsScaled', getU32BigintDecoder()],
         ['offerExpiry', getU32Decoder()],
      ]),
      (decoded) => ({
         betId: decoded.betId,
         amount: decoded.amount,
         numLegs: decoded.numLegs,
         legs: decodeParlayLegsFromTable(decoded.numLegs, decoded.legsTable),
         maxStake: decoded.maxStake,
         oddsScaled: decoded.oddsScaled,
         offerExpiry: decoded.offerExpiry,
      }),
   );

export function encodeFillRfqParlayIxBody(data: FillRfqParlayIxBody): Uint8Array {
   const out = getFillRfqParlayIxBodyEncoder().encode(data);
   if (out.length !== FILL_RFQ_PARLAY_IX_BODY_LEN) {
      throw new RangeError(
         `fillRfqParlay body len ${out.length}; expected ${FILL_RFQ_PARLAY_IX_BODY_LEN}`,
      );
   }
   return new Uint8Array(out);
}

export const getRfqBetMessageEncoder = (): Encoder<RfqBetMessageInput> =>
   getStructEncoder([
      ['networkDomain', getU8Encoder()],
      ['user', getAddressEncoder()],
      ['betId', getU64Encoder()],
      ['marketId', getMarketIdEncoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['eventStateSequence', getU16Encoder()],
      ['side', getU8Encoder()],
      ['maxStake', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['offerExpiry', getU32Encoder()],
      ['mmProgramId', getAddressEncoder()],
   ]);

/** Canonical ed25519 message bytes for a single-bet RFQ quote. */
export function encodeRfqBetMessageBytes(input: RfqBetMessageInput): Uint8Array {
   const out = getRfqBetMessageEncoder().encode(input);
   if (out.length !== RFQ_BET_MESSAGE_LEN) {
      throw new RangeError(`rfq bet message len ${out.length}; expected ${RFQ_BET_MESSAGE_LEN}`);
   }
   return new Uint8Array(out);
}

export const getRfqParlayMessageEncoder = (): Encoder<RfqParlayMessageInput> =>
   transformEncoder(
      getStructEncoder([
         ['networkDomain', getU8Encoder()],
         ['user', getAddressEncoder()],
         ['betId', getU64Encoder()],
         ['numLegs', getU8Encoder()],
         ['legsTable', fixEncoderSize(getBytesEncoder(), RFQ_SIGNED_PARLAY_LEG_TABLE_LEN)],
         ['maxStake', getU64Encoder()],
         ['oddsScaled', getU32BigintEncoder('oddsScaled')],
         ['offerExpiry', getU32Encoder()],
         ['mmProgramId', getAddressEncoder()],
      ]),
      (input) => ({
         networkDomain: input.networkDomain,
         user: input.user,
         betId: input.betId,
         numLegs: input.numLegs,
         legsTable: padRfqSignedParlayLegTableBytes(input.legs, input.numLegs),
         maxStake: input.maxStake,
         oddsScaled: input.oddsScaled,
         offerExpiry: input.offerExpiry,
         mmProgramId: input.mmProgramId,
      }),
   );

/** Canonical ed25519 message bytes for a parlay RFQ quote (fixed `MAX_PARLAY_LEGS` leg slots). */
export function encodeRfqParlayMessageBytes(input: RfqParlayMessageInput): Uint8Array {
   const out = getRfqParlayMessageEncoder().encode(input);
   if (out.length !== RFQ_PARLAY_MESSAGE_LEN) {
      throw new RangeError(`rfq parlay message len ${out.length}; expected ${RFQ_PARLAY_MESSAGE_LEN}`);
   }
   return new Uint8Array(out);
}

export const getMmParlayQuoteBufferEncoder = (): Encoder<MmParlayQuoteBuffer> =>
   transformEncoder(
      getStructEncoder([
         ['discriminator', getU8Encoder()],
         ['isUsed', getU8Encoder()],
         ['userAddress', getAddressEncoder()],
         ['maxAmount', getU64Encoder()],
         ['oddsScaled', getU32BigintEncoder('oddsScaled')],
         ['numLegs', getU8Encoder()],
         ['legsTable', fixEncoderSize(getBytesEncoder(), PARLAY_LEG_TABLE_LEN)],
      ]),
      (data) => ({
         discriminator: data.discriminator,
         isUsed: data.isUsed,
         userAddress: data.userAddress,
         maxAmount: data.maxAmount,
         oddsScaled: data.oddsScaled,
         numLegs: data.numLegs,
         legsTable: padParlayLegTableBytes(data.legs, data.numLegs),
      }),
   );

export const getMmParlayQuoteBufferDecoder = (): Decoder<MmParlayQuoteBuffer> =>
   transformDecoder(
      getStructDecoder([
         ['discriminator', getU8Decoder()],
         ['isUsed', getU8Decoder()],
         ['userAddress', getAddressDecoder()],
         ['maxAmount', getU64Decoder()],
         ['oddsScaled', getU32BigintDecoder()],
         ['numLegs', getU8Decoder()],
         ['legsTable', fixDecoderSize(getBytesDecoder(), PARLAY_LEG_TABLE_LEN)],
      ]),
      (decoded) => ({
         discriminator: decoded.discriminator,
         isUsed: decoded.isUsed,
         userAddress: decoded.userAddress,
         maxAmount: decoded.maxAmount,
         oddsScaled: decoded.oddsScaled,
         numLegs: decoded.numLegs,
         legs: decodeParlayLegsFromTable(decoded.numLegs, decoded.legsTable).slice(
            0,
            Math.min(decoded.numLegs, MAX_PARLAY_LEGS),
         ),
      }),
   );

export function decodeMmParlayQuoteBuffer(data: ReadonlyUint8Array): MmParlayQuoteBuffer {
   if (data.length !== MM_PARLAY_QUOTE_BUFFER_LEN) {
      throw new RangeError(`mm parlay quote buffer len ${data.length}`);
   }
   return getMmParlayQuoteBufferDecoder().decode(new Uint8Array(data));
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

export const getFillRfqBetIxDataEncoder = (): Encoder<FillRfqBetIxData> =>
   transformEncoder(
      getStructEncoder([
         ['betId', getU64Encoder()],
         ['marketId', getMarketIdEncoder()],
         ['side', getU8Encoder()],
         ['amount', getU64Encoder()],
         ['eventStateSequence', getU16Encoder()],
         ['eventGameState', getEventGameStateEncoder()],
         ['maxStake', getU64Encoder()],
         ['oddsScaled', getU32BigintEncoder('oddsScaled')],
         ['offerExpiry', getU32Encoder()],
         ['signature', fixEncoderSize(getBytesEncoder(), RFQ_SIGNATURE_LEN)],
      ]),
      (data) => {
         if (data.signature.length !== RFQ_SIGNATURE_LEN) {
            throw new RangeError(`fillRfqBet.signature must be ${RFQ_SIGNATURE_LEN} bytes`);
         }
         return data;
      },
   );

export function encodeFillRfqBetIxData(data: FillRfqBetIxData): Uint8Array {
   validateFillRfqBetIxData(data);
   const out = getFillRfqBetIxDataEncoder().encode(data);
   if (out.length !== FILL_RFQ_BET_IX_DATA_LEN) {
      throw new RangeError(`fillRfqBet data len ${out.length}; expected ${FILL_RFQ_BET_IX_DATA_LEN}`);
   }
   return new Uint8Array(out);
}

export const getFillRfqParlayIxDataEncoder = (): Encoder<FillRfqParlayIxData> =>
   transformEncoder(
      getStructEncoder([
         ['body', fixEncoderSize(getBytesEncoder(), FILL_RFQ_PARLAY_IX_BODY_LEN)],
         ['signature', fixEncoderSize(getBytesEncoder(), RFQ_SIGNATURE_LEN)],
      ]),
      (data) => {
         if (data.signature.length !== RFQ_SIGNATURE_LEN) {
            throw new RangeError(`fillRfqParlay.signature must be ${RFQ_SIGNATURE_LEN} bytes`);
         }
         return {
            body: getFillRfqParlayIxBodyEncoder().encode(data),
            signature: data.signature,
         };
      },
   );

export function encodeFillRfqParlayIxData(data: FillRfqParlayIxData): Uint8Array {
   validateFillRfqParlayIxData(data);
   const out = getFillRfqParlayIxDataEncoder().encode(data);
   if (out.length !== FILL_RFQ_PARLAY_IX_DATA_LEN) {
      throw new RangeError(`fillRfqParlay data len ${out.length}; expected ${FILL_RFQ_PARLAY_IX_DATA_LEN}`);
   }
   return new Uint8Array(out);
}

export const getFillRfqBetIxDataDecoder = (): Decoder<FillRfqBetIxData> =>
   transformDecoder(
      getStructDecoder([
         ['betId', getU64Decoder()],
         ['marketId', getMarketIdDecoder()],
         ['side', getU8Decoder()],
         ['amount', getU64Decoder()],
         ['eventStateSequence', getU16Decoder()],
         ['eventGameState', getEventGameStateDecoder()],
         ['maxStake', getU64Decoder()],
         ['oddsScaled', getU32BigintDecoder()],
         ['offerExpiry', getU32Decoder()],
         ['signature', fixDecoderSize(getBytesDecoder(), RFQ_SIGNATURE_LEN)],
      ]),
      (decoded) => ({
         ...decoded,
         signature: new Uint8Array(decoded.signature),
      }),
   );


export const getFillRfqParlayIxDataDecoder = (): Decoder<FillRfqParlayIxData> =>
   transformDecoder(
      getStructDecoder([
         ['body', fixDecoderSize(getBytesDecoder(), FILL_RFQ_PARLAY_IX_BODY_LEN)],
         ['signature', fixDecoderSize(getBytesDecoder(), RFQ_SIGNATURE_LEN)],
      ]),
      (decoded) => {
         const body = getFillRfqParlayIxBodyDecoder().decode(decoded.body);
         return {
            ...body,
            signature: new Uint8Array(decoded.signature),
         };
      },
   );

function decodeFillRfqParlayIxData(rest: ReadonlyUint8Array): FillRfqParlayIxData {
   if (rest.length !== FILL_RFQ_PARLAY_IX_DATA_LEN) {
      throw new RangeError(`fillRfqParlay: expected ${FILL_RFQ_PARLAY_IX_DATA_LEN} bytes`);
   }
   return getFillRfqParlayIxDataDecoder().decode(new Uint8Array(rest));
}

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
      case 'fillRfqBet': {
         const p = encodeFillRfqBetIxData(ix.data);
         if (p.length !== FILL_RFQ_BET_IX_DATA_LEN) {
            throw new RangeError(`fill rfq bet payload length ${p.length}`);
         }
         return concatDiscriminator(FILL_RFQ_BET_IX_DISCRIMINATOR, p);
      }
      case 'fillParlay': {
         const p = encodeFillParlayIxData(ix.data);
         if (p.length !== FILL_PARLAY_IX_DATA_LEN) {
            throw new RangeError(`fill parlay payload length ${p.length}`);
         }
         return concatDiscriminator(FILL_PARLAY_IX_DISCRIMINATOR, p);
      }
      case 'fillRfqParlay': {
         const p = encodeFillRfqParlayIxData(ix.data);
         if (p.length !== FILL_RFQ_PARLAY_IX_DATA_LEN) {
            throw new RangeError(`fill rfq parlay payload length ${p.length}`);
         }
         return concatDiscriminator(FILL_RFQ_PARLAY_IX_DISCRIMINATOR, p);
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
      case 'getMarketQuotesProxy': {
         const p = getFillBetIxDataEncoder().encode(ix.data);
         if (p.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`get market quotes proxy payload length ${p.length}`);
         }
         return concatDiscriminator(GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR, p);
      }
      case 'gradeBets': {
         if (ix.betResults.length === 0) {
            throw new RangeError('gradeBets requires at least one result byte');
         }
         return concatDiscriminator(GRADE_BETS_IX_DISCRIMINATOR, new Uint8Array(ix.betResults));
      }
      case 'gradeParlay': {
         if (ix.legGradeMasks.length === 0) {
            throw new RangeError('gradeParlay requires at least one mask');
         }
         const parts: Uint8Array[] = [];
         for (const mask of ix.legGradeMasks) {
            if (mask.length !== MAX_PARLAY_LEGS) {
               throw new RangeError(`gradeParlay mask must be ${MAX_PARLAY_LEGS} bytes`);
            }
            parts.push(new Uint8Array(mask));
         }
         const body = new Uint8Array(parts.length * MAX_PARLAY_LEGS);
         for (let i = 0; i < parts.length; i++) {
            body.set(parts[i]!, i * MAX_PARLAY_LEGS);
         }
         return concatDiscriminator(GRADE_PARLAY_IX_DISCRIMINATOR, body);
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
      case FILL_RFQ_BET_IX_DISCRIMINATOR:
         if (rest.length !== FILL_RFQ_BET_IX_DATA_LEN) {
            throw new RangeError(`fillRfqBet: expected ${FILL_RFQ_BET_IX_DATA_LEN} bytes`);
         }
         return { kind: 'fillRfqBet', data: getFillRfqBetIxDataDecoder().decode(restBytes) };
      case FILL_PARLAY_IX_DISCRIMINATOR:
         if (rest.length !== FILL_PARLAY_IX_DATA_LEN) {
            throw new RangeError(`fillParlay: expected ${FILL_PARLAY_IX_DATA_LEN} bytes`);
         }
         return { kind: 'fillParlay', data: decodeFillParlayIxData(restBytes) };
      case FILL_RFQ_PARLAY_IX_DISCRIMINATOR:
         if (rest.length !== FILL_RFQ_PARLAY_IX_DATA_LEN) {
            throw new RangeError(`fillRfqParlay: expected ${FILL_RFQ_PARLAY_IX_DATA_LEN} bytes`);
         }
         return { kind: 'fillRfqParlay', data: decodeFillRfqParlayIxData(restBytes) };
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
      case GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR:
         if (rest.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`getMarketQuotesProxy: expected ${FILL_BET_IX_DATA_LEN} bytes`);
         }
         return { kind: 'getMarketQuotesProxy', data: getFillBetIxDataDecoder().decode(restBytes) };
      case GRADE_BETS_IX_DISCRIMINATOR:
         if (rest.length === 0) {
            throw new RangeError('gradeBets: expected at least one byte');
         }
         return { kind: 'gradeBets', betResults: new Uint8Array(rest) };
      case GRADE_PARLAY_IX_DISCRIMINATOR:
         if (rest.length === 0 || rest.length % MAX_PARLAY_LEGS !== 0) {
            throw new RangeError(`gradeParlay: expected non-zero multiple of ${MAX_PARLAY_LEGS} bytes`);
         }
         {
            const masks: Uint8Array[] = [];
            for (let o = 0; o < rest.length; o += MAX_PARLAY_LEGS) {
               masks.push(restBytes.subarray(o, o + MAX_PARLAY_LEGS));
            }
            return { kind: 'gradeParlay', legGradeMasks: masks };
         }
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
