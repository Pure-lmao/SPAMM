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
   getArrayDecoder,
   getArrayEncoder,
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

import { ADDRESS_LEN, MAX_NUMBER_OF_MMS, MAX_FREEBET_ALLOWED_MMS, MAX_FREEBET_ALLOWED_OPERATORS, U32_LEN } from './constants.js';

import {
   BetResult,
   MM_RETURN_DATA_LEN,
   Sport,
   type AddLineToNettingIxData,
   type BetAccountData,
   type BetFiller,
   type CashoutAccountData,
   type CashoutEscrow,
   type CashoutParlayAccountData,
   type CashoutParlayLeg,
   type CashoutSnapshot,
   type ConfigPdaData,
   type EventGameState,
   type EventId,
   type EventStateData,
   type FillBetIxData,
   type FillCashoutIxData,
   type FillParlayCashoutIxData,
   type FillRfqBetIxBody,
   type FillRfqBetIxData,
   type FillRfqCashoutIxData,
   type FillRfqParlayCashoutIxBody,
   type FillRfqParlayCashoutIxData,
   type FillRfqParlayIxBody,
   type FillRfqParlayIxData,
   type RfqBetMessageInput,
   type RfqCashoutMessageInput,
   type RfqCashoutParlayMessageInput,
   type RfqParlayMessageInput,
   type FillParlayIxData,
   type FillParlayQuoteIxData,
   type FillQuoteIxData,
   type FillCashoutQuoteIxData,
   type FillCashoutQuoteParlayIxData,
   type GetQuoteIxData,
   type GetCashoutQuoteIxData,
   type GetCashoutQuoteParlayIxData,
   type GetQuoteParlayIxData,
   type MarketId,
   type MmAccountConfig,
   type MmEncumbrancePdaData,
   type MmListPdaData,
   type MmMarketDataPdaData,
   type MmParlayQuoteBuffer,
   type MmQuoteBuffer,
   type MmReturnData,
   type ProxyCashoutQuoteData,
   type ProxyMarketMmQuotes,
   type ProxyQuoteData,
   type ProxyParlayQuoteData,
   type GetParlayQuoteReturnWire,
   MARKET_QUOTES_PROXY_RETURN_MAX,
   PROXY_CASHOUT_QUOTE_DATA_LEN,
   PROXY_MARKET_SIDE_ODDS_WIRE_LEN,
   PROXY_PARLAY_QUOTE_HEADER_LEN,
   proxyParlayQuoteDataLen,
   PROXY_QUOTE_DATA_LEN,
   type NettingLine,
   type NettingPdaAccountData,
   type NettingPdaDataHeader,
   type ParlayBetAccountData,
   type ParlayLegQuoted,
   type ParlayLegSel,
   type ParlayLegWire,
   type RemoveLineFromNettingIxData,
   BET_ACCOUNT_DISCRIMINATOR,
   BET_ACCOUNT_HEADER_LEN,
   BET_ACCOUNT_MIN_LEN,
   BET_FILLER_WIRE_LEN,
   betAccountLen,
   CASHOUT_ACCOUNT_DISCRIMINATOR,
   CASHOUT_ACCOUNT_HEADER_LEN,
   CASHOUT_ACCOUNT_MIN_LEN,
   cashoutAccountLen,
   CASHOUT_ESCROW_DISCRIMINATOR,
   CASHOUT_ESCROW_LEN,
   CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR,
   CASHOUT_PARLAY_ACCOUNT_MIN_LEN,
   CASHOUT_PARLAY_HEADER_LEN,
   CASHOUT_PARLAY_LEG_WIRE_LEN,
   cashoutParlayAccountLen,
   CONFIG_PDA_DISCRIMINATOR,
   CONFIG_PDA_LEN,
   EVENT_STATE_DISCRIMINATOR,
   EVENT_STATE_HEADER_LEN,
   FILL_CASHOUT_IX_DATA_LEN,
   FILL_PARLAY_CASHOUT_IX_HEADER_LEN,
   FILL_RFQ_BET_IX_BODY_LEN,
   FILL_RFQ_BET_IX_DATA_LEN,
   FILL_RFQ_CASHOUT_IX_DATA_LEN,
   FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN,
   FILL_RFQ_PARLAY_IX_HEADER_LEN,
   RFQ_BET_MESSAGE_KIND,
   RFQ_BET_MESSAGE_LEN,
   RFQ_CASHOUT_MESSAGE_KIND,
   RFQ_CASHOUT_MESSAGE_LEN,
   RFQ_CASHOUT_PARLAY_MESSAGE_KIND,
   RFQ_PARLAY_MESSAGE_KIND,
   RFQ_SIGNATURE_LEN,
   FILL_QUOTE_IX_WIRE_LEN,
   FILL_QUOTE_PARLAY_IX_WIRE_LEN,
   GET_CASHOUT_QUOTE_IX_WIRE_LEN,
   FILL_CASHOUT_QUOTE_IX_WIRE_LEN,
   GET_CASHOUT_QUOTE_PARLAY_IX_HEADER_LEN,
   getCashoutQuoteParlayIxWireLen,
   FILL_CASHOUT_QUOTE_PARLAY_IX_WIRE_LEN,
   GET_QUOTE_IX_WIRE_LEN,
   GET_QUOTE_PARLAY_IX_HEADER_LEN,
   MM_CONFIG_PDA_HEADER_LEN,
   MM_ENCUMBRANCE_PDA_LEN,
   MM_LIST_HEADER_LEN,
   MM_MARKET_DATA_PDA_MIN_LEN,
   MM_PARLAY_QUOTE_BUFFER_LEN,
   MM_QUOTE_BUFFER_LEN,
   MAX_PARLAY_LEGS,
   MAX_RFQ_PARLAY_LEGS,
   NETTING_ACCOUNT_ALLOC_LEN,
   NETTING_MAX_LINE_CAPACITY,
   NETTING_HEADER_LEN,
   NETTING_LINE_LEN,
   PARLAY_LEG_QUOTED_LEN,
   PARLAY_LEG_SEL_LEN,
   PARLAY_LEG_TABLE_LEN,
   PARLAY_LEG_WIRE_LEN,
   PARLAY_BET_ACCOUNT_DISCRIMINATOR,
   PARLAY_BET_ACCOUNT_MIN_LEN,
   PARLAY_BET_HEADER_LEN,
   PARLAY_QUOTE_RETURN_HEADER_LEN,
   FILL_PARLAY_IX_HEADER_LEN,
   fillParlayCashoutIxDataLen,
   fillParlayIxDataLen,
   fillRfqParlayCashoutIxDataLen,
   fillRfqParlayIxBodyLen,
   fillRfqParlayIxDataLen,
   getQuoteParlayIxWireLen,
   FREEBET_ACCOUNT_DISCRIMINATOR,
   FREEBET_ACCOUNT_HEADER_LEN,
   FREEBET_ISSUER_DISCRIMINATOR,
   FREEBET_ISSUER_LEN,
   ISSUE_FREEBET_IX_HEADER_LEN,
   FreebetState,
   type FreebetAccountData,
   type FreebetIssuer,
   type IssueFreebetIxData,
   freebetAccountLen,
   issueFreebetIxDataLen,
   parlayBetAccountLen,
   parlayQuoteReturnWireLen,
   rfqCashoutParlayMessageLen,
   rfqParlayMessageLen,
} from './types.js';

import {
   validateFillCashoutIxData,
   validateFillParlayCashoutIxData,
   validateFillParlayIxData,
   validateFillRfqBetIxData,
   validateFillRfqCashoutIxData,
   validateFillRfqParlayCashoutIxData,
   validateFillRfqParlayIxData,
   validateGetQuoteParlayIxData,
   validateIssueFreebetIxData,
} from './validate.js';

import {
   MM_FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
   MM_GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
   MM_GET_CASHOUT_QUOTE_IX_DISCRIMINATOR,
   MM_FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR,
   MM_GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
   MM_FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
} from './constants.js';

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

const addrEncoder = getAddressEncoder();
const addrDecoder = getAddressDecoder();
const amountDecoder = getU64Decoder();
const oddsDecoder = getU32BigintDecoder();

function sportFromWire(b: number): Sport {
   switch (b) {
      case Sport.Invalid:
         return Sport.Invalid;
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
      case Sport.Tennis:
         return Sport.Tennis;
      case Sport.Cs2:
         return Sport.Cs2;
      case Sport.Dota:
         return Sport.Dota;
      case Sport.Lol:
         return Sport.Lol;
      case Sport.Valorant:
         return Sport.Valorant;
      default:
         throw new RangeError(`invalid Sport wire byte: ${b}`);
   }
}

function sportToWire(s: Sport): number {
   switch (s) {
      case Sport.Invalid:
      case Sport.Soccer:
      case Sport.AmericanFootball:
      case Sport.Baseball:
      case Sport.Basketball:
      case Sport.IceHockey:
      case Sport.Tennis:
      case Sport.Cs2:
      case Sport.Dota:
      case Sport.Lol:
      case Sport.Valorant:
         return s;
      default:
         throw new RangeError(`invalid Sport enum value: ${s}`);
   }
}

const getSportU8Encoder = (): Encoder<Sport> =>
   transformEncoder(getU8Encoder(), (s: Sport) => sportToWire(s));

const getSportU8Decoder = (): Decoder<Sport> => transformDecoder(getU8Decoder(), sportFromWire);

function betResultFromWire(b: number): BetResult {
   if (!Number.isInteger(b) || b < BetResult.Pending || b > BetResult.CashedOut) {
      throw new RangeError(`invalid BetResult wire byte: ${b}`);
   }
   return b as BetResult;
}

const getBetResultU8Encoder = (): Encoder<BetResult> =>
   transformEncoder(getU8Encoder(), (r: BetResult) => {
      if (!Number.isInteger(r) || r < BetResult.Pending || r > BetResult.CashedOut) {
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
      ['reservedProfit', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['isPotentiallyNetted', getBoolU8Encoder()],
   ]);

const getBetFillerWireDecoder = (): Decoder<BetFiller> =>
   getStructDecoder([
      ['mmAddress', getAddressDecoder()],
      ['amount', getU64Decoder()],
      ['reservedProfit', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['isPotentiallyNetted', getBoolU8Decoder()],
   ]);

const getBetAccountHeaderDecoder = (): Decoder<Omit<BetAccountData, 'fillers'>> =>
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
      ['freebetId', getU32Decoder()],
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
      ['result', getBetResultU8Decoder()],
      ['numFillers', getU8Decoder()],
   ]);

function encodeLiveBetFillersBytes(fillers: readonly BetFiller[], numFillers: number): Uint8Array {
   if (numFillers < 1 || numFillers > MAX_NUMBER_OF_MMS) {
      throw new RangeError(`bet numFillers invalid: ${numFillers}`);
   }
   if (fillers.length < numFillers) {
      throw new RangeError(`bet fillers length ${fillers.length} < numFillers ${numFillers}`);
   }
   const enc = getBetFillerWireEncoder();
   const out = new Uint8Array(numFillers * BET_FILLER_WIRE_LEN);
   for (let i = 0; i < numFillers; i++) {
      out.set(enc.encode(fillers[i]!), i * BET_FILLER_WIRE_LEN);
   }
   return out;
}

function decodeLiveBetFillersBytes(bytes: ReadonlyUint8Array, numFillers: number): BetFiller[] {
   if (numFillers < 1 || numFillers > MAX_NUMBER_OF_MMS) {
      throw new RangeError(`bet numFillers invalid: ${numFillers}`);
   }
   const expected = numFillers * BET_FILLER_WIRE_LEN;
   if (bytes.length !== expected) {
      throw new RangeError(`bet fillers bytes ${bytes.length}; expected ${expected}`);
   }
   const dec = getBetFillerWireDecoder();
   const fillers: BetFiller[] = [];
   for (let i = 0; i < numFillers; i++) {
      const off = i * BET_FILLER_WIRE_LEN;
      fillers.push(dec.decode(bytes.subarray(off, off + BET_FILLER_WIRE_LEN)));
   }
   return fillers;
}

/** On-chain layout: `BetAccountHeader` + `BetFiller` × `numFillers`. */
export const getBetAccountDataEncoder = (): Encoder<BetAccountData> =>
   transformEncoder(
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
         ['freebetId', getU32Encoder()],
         ['eventStateSequence', getU16Encoder()],
         ['eventGameState', getEventGameStateEncoder()],
         ['result', getBetResultU8Encoder()],
         ['numFillers', getU8Encoder()],
         ['fillersBytes', getBytesEncoder()],
      ]),
      (data) => ({
         discriminator: data.discriminator,
         bump: data.bump,
         owner: data.owner,
         feepayer: data.feepayer,
         betId: data.betId,
         marketId: data.marketId,
         side: data.side,
         amount: data.amount,
         payout: data.payout,
         timestamp: data.timestamp,
         freebetId: data.freebetId,
         eventStateSequence: data.eventStateSequence,
         eventGameState: data.eventGameState,
         result: data.result,
         numFillers: data.numFillers,
         fillersBytes: encodeLiveBetFillersBytes(data.fillers, data.numFillers),
      }),
   );

export const getBetAccountDataDecoder = (): Decoder<BetAccountData> =>
   transformDecoder(
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
         ['freebetId', getU32Decoder()],
         ['eventStateSequence', getU16Decoder()],
         ['eventGameState', getEventGameStateDecoder()],
         ['result', getBetResultU8Decoder()],
         ['numFillers', getU8Decoder()],
         ['fillersBytes', getBytesDecoder()],
      ]),
      (decoded) => ({
         discriminator: decoded.discriminator,
         bump: decoded.bump,
         owner: decoded.owner,
         feepayer: decoded.feepayer,
         betId: decoded.betId,
         marketId: decoded.marketId,
         side: decoded.side,
         amount: decoded.amount,
         payout: decoded.payout,
         timestamp: decoded.timestamp,
         freebetId: decoded.freebetId,
         eventStateSequence: decoded.eventStateSequence,
         eventGameState: decoded.eventGameState,
         result: decoded.result,
         numFillers: decoded.numFillers,
         fillers: decodeLiveBetFillersBytes(decoded.fillersBytes, decoded.numFillers),
      }),
   );

export const decodeBetAccountData = (data: ReadonlyUint8Array): BetAccountData =>
   decodeBetAccountDataStrict(data);

export const getNettingLineEncoder = (): Encoder<NettingLine> =>
   getStructEncoder([
      ['period', getU8Encoder()],
      ['mkt', getU16Encoder()],
      ['open0', getI64Encoder()],
      ['open1', getI64Encoder()],
   ]);

export const getNettingLineDecoder = (): Decoder<NettingLine> =>
   getStructDecoder([
      ['period', getU8Decoder()],
      ['mkt', getU16Decoder()],
      ['open0', getI64Decoder()],
      ['open1', getI64Decoder()],
   ]);

export const getNettingPdaHeaderEncoder = (): Encoder<NettingPdaDataHeader> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['eventId', getEventIdEncoder()],
      ['openHome', getI64Encoder()],
      ['openAway', getI64Encoder()],
      ['openDraw', getI64Encoder()],
      ['numberOfLines', getU8Encoder()],
   ]);

export const getNettingPdaHeaderDecoder = (): Decoder<NettingPdaDataHeader> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['eventId', getEventIdDecoder()],
      ['openHome', getI64Decoder()],
      ['openAway', getI64Decoder()],
      ['openDraw', getI64Decoder()],
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
   if (lines.length > NETTING_MAX_LINE_CAPACITY) {
      throw new RangeError(`at most ${NETTING_MAX_LINE_CAPACITY} netting lines`);
   }
   const occupied = NETTING_HEADER_LEN + lines.length * NETTING_LINE_LEN;
   const out = new Uint8Array(Math.max(NETTING_ACCOUNT_ALLOC_LEN, occupied));
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
         if (n > NETTING_MAX_LINE_CAPACITY) {
            throw new RangeError(`numberOfLines ${n} exceeds capacity ${NETTING_MAX_LINE_CAPACITY}`);
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
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['numberOfMms', getU16Encoder()],
      ['mmProgramAddresses', getArrayEncoder(addrEncoder, { size: 'remainder' })],
   ]);

const getMmListPdaDataDecoder = (): Decoder<MmListPdaData> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['numberOfMms', getU16Decoder()],
      ['mmProgramAddresses', getArrayDecoder(addrDecoder, { size: 'remainder' })],
   ]);

export const decodeMmListPdaData = (data: ReadonlyUint8Array): MmListPdaData => {
   if (data.length < MM_LIST_HEADER_LEN) {
      throw new RangeError(`mm_list data too short: ${data.length}`);
   }
   const decoded = getMmListPdaDataDecoder().decode(new Uint8Array(data));
   const expectLen = MM_LIST_HEADER_LEN + decoded.numberOfMms * ADDRESS_LEN;
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

export const getProxyCashoutQuoteDataDecoder = (): Decoder<ProxyCashoutQuoteData> =>
   getStructDecoder([
      ['mmAddress', getAddressDecoder()],
      ['maxPayment', getU64Decoder()],
   ]);

export const getProxyCashoutQuoteDataEncoder = (): Encoder<ProxyCashoutQuoteData> =>
   getStructEncoder([
      ['mmAddress', getAddressEncoder()],
      ['maxPayment', getU64Encoder()],
   ]);

/** Return data from aggregator `get_cashout_quote_proxy` / `get_parlay_cashout_quote_proxy`. */
export function decodeProxyCashoutQuoteReturnData(data: ReadonlyUint8Array): ProxyCashoutQuoteData[] {
   if (data.length % PROXY_CASHOUT_QUOTE_DATA_LEN !== 0) {
      throw new RangeError(
         `proxy cashout quote return data len ${data.length} is not a multiple of ${PROXY_CASHOUT_QUOTE_DATA_LEN}`,
      );
   }
   const decoder = getProxyCashoutQuoteDataDecoder();
   const quotes: ProxyCashoutQuoteData[] = [];
   const bytes = new Uint8Array(data);
   for (let offset = 0; offset < bytes.length; offset += PROXY_CASHOUT_QUOTE_DATA_LEN) {
      quotes.push(decoder.decode(bytes.subarray(offset, offset + PROXY_CASHOUT_QUOTE_DATA_LEN)));
   }
   return quotes;
}

export const getProxyParlayQuoteDataDecoder = (): Decoder<ProxyParlayQuoteData> =>
   getStructDecoder([
      ['mmAddress', addrDecoder],
      ['maxAmount', amountDecoder],
      ['oddsScaled', oddsDecoder],
      ['numLegs', getU8Decoder()],
      ['legOdds', getArrayDecoder(oddsDecoder, { size: 'remainder' })],
   ]);

/**
 * Return data from aggregator `get_parlay_quote_proxy` (0..N × `ProxyParlayQuoteData`).
 *
 * Entries are packed back-to-back with only `numLegs` leg odds each
 * (`mm_quote.rs::proxy_parlay_quote_data_len`), so entry size varies per MM.
 */
export function decodeProxyParlayQuoteReturnData(data: ReadonlyUint8Array): ProxyParlayQuoteData[] {
   const decoder = getProxyParlayQuoteDataDecoder();
   const quotes: ProxyParlayQuoteData[] = [];

   let offset = 0;
   while (offset < data.length) {
      const remaining = data.length - offset;
      if (remaining < PROXY_PARLAY_QUOTE_HEADER_LEN) {
         throw new RangeError(
            `parlay proxy quote entry ${quotes.length} truncated: ${remaining} bytes < header ${PROXY_PARLAY_QUOTE_HEADER_LEN}`,
         );
      }
      const numLegs = data[offset + PROXY_PARLAY_QUOTE_HEADER_LEN - 1]!;
      if (numLegs > MAX_PARLAY_LEGS) {
         throw new RangeError(
            `parlay proxy quote entry ${quotes.length} numLegs ${numLegs} > ${MAX_PARLAY_LEGS}`,
         );
      }
      const entryLen = proxyParlayQuoteDataLen(numLegs);
      if (remaining < entryLen) {
         throw new RangeError(
            `parlay proxy quote entry ${quotes.length} truncated: ${remaining} bytes < entry ${entryLen}`,
         );
      }
      quotes.push(decoder.decode(data.subarray(offset, offset + entryLen)));
      offset += entryLen;
   }

   return quotes;
}

const getProxyMarketMmQuotesEntryDecoder = (numSides: number): Decoder<ProxyMarketMmQuotes> =>
   getStructDecoder([
      ['mmAddress', addrDecoder],
      ['oddsScaled', getArrayDecoder(oddsDecoder, { size: numSides })],
   ]);

/** Return data from aggregator `get_market_quotes_proxy` (fixed-size MM chunks; `numSides` from `mkt`). */
export function decodeMarketQuotesProxyReturnData(
   data: ReadonlyUint8Array,
   numSides: number,
): ProxyMarketMmQuotes[] {
   if (numSides <= 0) {
      throw new RangeError('numSides must be positive');
   }
   const entryLen = ADDRESS_LEN + numSides * PROXY_MARKET_SIDE_ODDS_WIRE_LEN;
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

/** Encode only `numLegs` live fill/quote selection legs (no padding). */
export function encodeLiveParlayLegSelsBytes(legs: readonly ParlayLegSel[], numLegs: number): Uint8Array {
   if (numLegs < 1 || legs.length < numLegs) {
      throw new RangeError('encodeLiveParlayLegSelsBytes: invalid legs / numLegs');
   }
   const enc = getParlayLegSelEncoder();
   const out = new Uint8Array(numLegs * PARLAY_LEG_SEL_LEN);
   for (let i = 0; i < numLegs; i++) {
      out.set(enc.encode(legs[i]!), i * PARLAY_LEG_SEL_LEN);
   }
   return out;
}

/** Decode `numLegs` live fill/quote selection legs from unpadded wire bytes. */
export function decodeLiveParlayLegSelsBytes(bytes: ReadonlyUint8Array, numLegs: number): ParlayLegSel[] {
   const expected = numLegs * PARLAY_LEG_SEL_LEN;
   if (bytes.length !== expected) {
      throw new RangeError(`live parlay sel bytes ${bytes.length}; expected ${expected} for ${numLegs} legs`);
   }
   const dec = getParlayLegSelDecoder();
   const legs: ParlayLegSel[] = [];
   for (let i = 0; i < numLegs; i++) {
      const off = i * PARLAY_LEG_SEL_LEN;
      legs.push(dec.decode(bytes.subarray(off, off + PARLAY_LEG_SEL_LEN)));
   }
   return legs;
}

/** Encode only `numLegs` live RFQ quoted legs (no padding). */
export function encodeLiveParlayLegQuotedBytes(legs: readonly ParlayLegQuoted[], numLegs: number): Uint8Array {
   if (numLegs < 1 || legs.length < numLegs) {
      throw new RangeError('encodeLiveParlayLegQuotedBytes: invalid legs / numLegs');
   }
   const enc = getParlayLegQuotedEncoder();
   const out = new Uint8Array(numLegs * PARLAY_LEG_QUOTED_LEN);
   for (let i = 0; i < numLegs; i++) {
      out.set(enc.encode(legs[i]!), i * PARLAY_LEG_QUOTED_LEN);
   }
   return out;
}

/** Decode `numLegs` live RFQ quoted legs from unpadded wire bytes. */
export function decodeLiveParlayLegQuotedBytes(
   bytes: ReadonlyUint8Array,
   numLegs: number,
): ParlayLegQuoted[] {
   const expected = numLegs * PARLAY_LEG_QUOTED_LEN;
   if (bytes.length !== expected) {
      throw new RangeError(`live parlay quoted bytes ${bytes.length}; expected ${expected} for ${numLegs} legs`);
   }
   const dec = getParlayLegQuotedDecoder();
   const legs: ParlayLegQuoted[] = [];
   for (let i = 0; i < numLegs; i++) {
      const off = i * PARLAY_LEG_QUOTED_LEN;
      legs.push(dec.decode(bytes.subarray(off, off + PARLAY_LEG_QUOTED_LEN)));
   }
   return legs;
}

/** Encode only `numLegs` live stored parlay-account legs (no padding). */
export function encodeLiveParlayLegsBytes(legs: readonly ParlayLegWire[], numLegs: number): Uint8Array {
   if (numLegs < 1 || legs.length < numLegs) {
      throw new RangeError('encodeLiveParlayLegsBytes: invalid legs / numLegs');
   }
   const enc = getParlayLegWireEncoder();
   const out = new Uint8Array(numLegs * PARLAY_LEG_WIRE_LEN);
   for (let i = 0; i < numLegs; i++) {
      out.set(enc.encode(legs[i]!), i * PARLAY_LEG_WIRE_LEN);
   }
   return out;
}

/** Decode `numLegs` live stored parlay-account legs from unpadded wire bytes. */
export function decodeLiveParlayLegsBytes(bytes: ReadonlyUint8Array, numLegs: number): ParlayLegWire[] {
   const expected = numLegs * PARLAY_LEG_WIRE_LEN;
   if (bytes.length !== expected) {
      throw new RangeError(`live parlay legs bytes ${bytes.length}; expected ${expected} for ${numLegs} legs`);
   }
   const dec = getParlayLegWireDecoder();
   const legs: ParlayLegWire[] = [];
   for (let i = 0; i < numLegs; i++) {
      const off = i * PARLAY_LEG_WIRE_LEN;
      legs.push(dec.decode(bytes.subarray(off, off + PARLAY_LEG_WIRE_LEN)));
   }
   return legs;
}

function decodeParlayLegTableBytes(table: ReadonlyUint8Array): ParlayLegQuoted[] {
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

function decodeParlayLegsFromTable(numLegs: number, legsTable: ReadonlyUint8Array): ParlayLegQuoted[] {
   if (numLegs < 2 || numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`parlay numLegs invalid: ${numLegs}`);
   }
   return decodeParlayLegTableBytes(legsTable).slice(0, numLegs);
}

const getParlayBetAccountHeaderDecoder = (): Decoder<Omit<ParlayBetAccountData, 'legs'>> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['owner', getAddressDecoder()],
      ['feepayer', getAddressDecoder()],
      ['betId', getU64Decoder()],
      ['amount', getU64Decoder()],
      ['payout', getU64Decoder()],
      ['timestamp', getU32Decoder()],
      ['freebetId', getU32Decoder()],
      ['fillerAddress', getAddressDecoder()],
      ['result', getBetResultU8Decoder()],
      ['numLegs', getU8Decoder()],
   ]);

export const getFillParlayIxDataEncoder = (): Encoder<FillParlayIxData> =>
   getStructEncoder([
      ['betId', getU64Encoder()],
      ['amount', getU64Encoder()],
      ['minOddsScaled', getU32BigintEncoder('minOddsScaled')],
      ['numLegs', getU8Encoder()],
      ['legs', getArrayEncoder(getParlayLegSelEncoder(), { size: 'remainder' })],
   ]);

export const getFillParlayIxDataDecoder = (): Decoder<FillParlayIxData> =>
   getStructDecoder([
      ['betId', getU64Decoder()],
      ['amount', getU64Decoder()],
      ['minOddsScaled', getU32BigintDecoder()],
      ['numLegs', getU8Decoder()],
      ['legs', getArrayDecoder(getParlayLegSelDecoder(), { size: 'remainder' })],
   ]);

export function encodeFillParlayIxData(data: FillParlayIxData): Uint8Array {
   validateFillParlayIxData(data);
   const out = getFillParlayIxDataEncoder().encode(data);
   const expected = fillParlayIxDataLen(data.numLegs);
   if (out.length !== expected) {
      throw new RangeError(`fill_parlay body len ${out.length}; expected ${expected}`);
   }
   return new Uint8Array(out);
}

export function decodeFillParlayIxData(data: ReadonlyUint8Array): FillParlayIxData {
   if (data.length < FILL_PARLAY_IX_HEADER_LEN) {
      throw new RangeError(`fill_parlay body len ${data.length} < header ${FILL_PARLAY_IX_HEADER_LEN}`);
   }
   const numLegs = data[FILL_PARLAY_IX_HEADER_LEN - 1]!;
   const expected = fillParlayIxDataLen(numLegs);
   if (data.length !== expected) {
      throw new RangeError(`fill_parlay body len ${data.length}; expected ${expected} for ${numLegs} legs`);
   }
   return getFillParlayIxDataDecoder().decode(new Uint8Array(data));
}

export const getGetQuoteParlayIxDataEncoder = (): Encoder<GetQuoteParlayIxData> =>
   getStructEncoder([
      ['instructionDiscriminator', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['numLegs', getU8Encoder()],
      ['legs', getArrayEncoder(getParlayLegSelEncoder(), { size: 'remainder' })],
   ]);

export const getGetQuoteParlayIxDataDecoder = (): Decoder<GetQuoteParlayIxData> =>
   getStructDecoder([
      ['instructionDiscriminator', getU8Decoder()],
      ['amount', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['numLegs', getU8Decoder()],
      ['legs', getArrayDecoder(getParlayLegSelDecoder(), { size: 'remainder' })],
   ]);

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
   const expected = getQuoteParlayIxWireLen(ix.numLegs);
   if (out.length !== expected) {
      throw new RangeError(`get_quote_parlay wire len ${out.length}; expected ${expected}`);
   }
   return new Uint8Array(out);
}

export function decodeGetQuoteParlayIxData(data: ReadonlyUint8Array): GetQuoteParlayIxData {
   if (data.length < GET_QUOTE_PARLAY_IX_HEADER_LEN) {
      throw new RangeError(`get_quote_parlay wire len ${data.length} < header ${GET_QUOTE_PARLAY_IX_HEADER_LEN}`);
   }
   const numLegs = data[GET_QUOTE_PARLAY_IX_HEADER_LEN - 1]!;
   const expected = getQuoteParlayIxWireLen(numLegs);
   if (data.length !== expected) {
      throw new RangeError(`get_quote_parlay wire len ${data.length}; expected ${expected} for ${numLegs} legs`);
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

const getFillRfqBetIxBodyEncoder = (): Encoder<FillRfqBetIxBody> =>
   getStructEncoder([
      ['betId', getU64Encoder()],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['maxStake', getU64Encoder()],
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
   getStructEncoder([
      ['betId', getU64Encoder()],
      ['amount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['maxStake', getU64Encoder()],
      ['offerExpiry', getU32Encoder()],
      ['numLegs', getU8Encoder()],
      ['legs', getArrayEncoder(getParlayLegQuotedEncoder(), { size: 'remainder' })],
   ]);

const getFillRfqParlayIxBodyDecoder = (): Decoder<FillRfqParlayIxBody> =>
   getStructDecoder([
      ['betId', getU64Decoder()],
      ['amount', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['maxStake', getU64Decoder()],
      ['offerExpiry', getU32Decoder()],
      ['numLegs', getU8Decoder()],
      ['legs', getArrayDecoder(getParlayLegQuotedDecoder(), { size: 'remainder' })],
   ]);

/** Remainder arrays consume to end-of-buffer, so trailing RFQ signatures are decoded from a sliced body. */
function decodeRfqSignedAfterBody<TBody extends object>(
   bodyDecoder: Decoder<TBody>,
   data: ReadonlyUint8Array,
): TBody & { signature: ReadonlyUint8Array } {
   const bodyLen = data.length - RFQ_SIGNATURE_LEN;
   return {
      ...bodyDecoder.decode(data.subarray(0, bodyLen)),
      signature: data.subarray(bodyLen),
   };
}

export function encodeFillRfqParlayIxBody(data: FillRfqParlayIxBody): Uint8Array {
   const out = getFillRfqParlayIxBodyEncoder().encode(data);
   const expected = fillRfqParlayIxBodyLen(data.numLegs);
   if (out.length !== expected) {
      throw new RangeError(`fillRfqParlay body len ${out.length}; expected ${expected}`);
   }
   return new Uint8Array(out);
}

export const getRfqBetMessageEncoder = (): Encoder<RfqBetMessageInput> =>
   transformEncoder(
      getStructEncoder([
         ['networkDomain', getU8Encoder()],
         ['messageKind', getU8Encoder()],
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
      ]),
      (input) => ({
         ...input,
         messageKind: RFQ_BET_MESSAGE_KIND,
      }),
   );

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
         ['messageKind', getU8Encoder()],
         ['user', getAddressEncoder()],
         ['betId', getU64Encoder()],
         ['maxStake', getU64Encoder()],
         ['oddsScaled', getU32BigintEncoder('oddsScaled')],
         ['offerExpiry', getU32Encoder()],
         ['mmProgramId', getAddressEncoder()],
         ['numLegs', getU8Encoder()],
         ['legs', getArrayEncoder(getParlayLegQuotedEncoder(), { size: 'remainder' })],
      ]),
      (input) => ({
         ...input,
         messageKind: RFQ_PARLAY_MESSAGE_KIND,
      }),
   );

/** Canonical ed25519 message bytes for a parlay RFQ quote (live legs only, no padding). */
export function encodeRfqParlayMessageBytes(input: RfqParlayMessageInput): Uint8Array {
   const out = getRfqParlayMessageEncoder().encode(input);
   const expected = rfqParlayMessageLen(input.numLegs);
   if (out.length !== expected) {
      throw new RangeError(`rfq parlay message len ${out.length}; expected ${expected}`);
   }
   return new Uint8Array(out);
}

export const getRfqCashoutMessageEncoder = (): Encoder<RfqCashoutMessageInput> =>
   transformEncoder(
      getStructEncoder([
         ['networkDomain', getU8Encoder()],
         ['messageKind', getU8Encoder()],
         ['user', getAddressEncoder()],
         ['origBetId', getU64Encoder()],
         ['cashoutId', getU64Encoder()],
         ['amount', getU64Encoder()],
         ['maxPayment', getU64Encoder()],
         ['offerExpiry', getU32Encoder()],
         ['eventStateSequence', getU16Encoder()],
         ['eventGameState', getEventGameStateEncoder()],
         ['mmProgramId', getAddressEncoder()],
      ]),
      (input) => ({
         networkDomain: input.networkDomain,
         messageKind: RFQ_CASHOUT_MESSAGE_KIND,
         user: input.user,
         origBetId: input.origBetId,
         cashoutId: input.cashoutId,
         amount: input.amount,
         maxPayment: input.maxPayment,
         offerExpiry: input.offerExpiry,
         eventStateSequence: input.eventStateSequence,
         eventGameState: input.eventGameState,
         mmProgramId: input.mmProgramId,
      }),
   );

/** Canonical ed25519 message bytes for a single-bet cashout RFQ quote. */
export function encodeRfqCashoutMessageBytes(input: RfqCashoutMessageInput): Uint8Array {
   const out = getRfqCashoutMessageEncoder().encode(input);
   if (out.length !== RFQ_CASHOUT_MESSAGE_LEN) {
      throw new RangeError(`rfq cashout message len ${out.length}; expected ${RFQ_CASHOUT_MESSAGE_LEN}`);
   }
   return new Uint8Array(out);
}

export const getCashoutSnapshotEncoder = (): Encoder<CashoutSnapshot> =>
   getStructEncoder([
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
   ]);

export const getCashoutSnapshotDecoder = (): Decoder<CashoutSnapshot> =>
   getStructDecoder([
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
   ]);

export const getRfqCashoutParlayMessageEncoder = (): Encoder<RfqCashoutParlayMessageInput> =>
   transformEncoder(
      getStructEncoder([
         ['networkDomain', getU8Encoder()],
         ['messageKind', getU8Encoder()],
         ['user', getAddressEncoder()],
         ['origBetId', getU64Encoder()],
         ['cashoutId', getU64Encoder()],
         ['amount', getU64Encoder()],
         ['maxPayment', getU64Encoder()],
         ['offerExpiry', getU32Encoder()],
         ['mmProgramId', getAddressEncoder()],
         ['numLegs', getU8Encoder()],
         ['snapshots', getArrayEncoder(getCashoutSnapshotEncoder(), { size: 'remainder' })],
      ]),
      (input) => ({
         ...input,
         messageKind: RFQ_CASHOUT_PARLAY_MESSAGE_KIND,
         snapshots: input.snapshots.slice(0, input.numLegs),
      }),
   );

/** Canonical ed25519 message bytes for a parlay cashout RFQ quote. */
export function encodeRfqCashoutParlayMessageBytes(input: RfqCashoutParlayMessageInput): Uint8Array {
   const out = getRfqCashoutParlayMessageEncoder().encode(input);
   const expected = rfqCashoutParlayMessageLen(input.numLegs);
   if (out.length !== expected) {
      throw new RangeError(`rfq cashout parlay message len ${out.length}; expected ${expected}`);
   }
   return new Uint8Array(out);
}

export const getFillCashoutIxDataEncoder = (): Encoder<FillCashoutIxData> =>
   getStructEncoder([
      ['origBetId', getU64Encoder()],
      ['cashoutId', getU64Encoder()],
      ['amount', getU64Encoder()],
      ['minPayout', getU64Encoder()],
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
   ]);

export const getFillCashoutIxDataDecoder = (): Decoder<FillCashoutIxData> =>
   getStructDecoder([
      ['origBetId', getU64Decoder()],
      ['cashoutId', getU64Decoder()],
      ['amount', getU64Decoder()],
      ['minPayout', getU64Decoder()],
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
   ]);

export function encodeFillCashoutIxData(data: FillCashoutIxData): Uint8Array {
   validateFillCashoutIxData(data);
   const out = getFillCashoutIxDataEncoder().encode(data);
   if (out.length !== FILL_CASHOUT_IX_DATA_LEN) {
      throw new RangeError(`fillCashout payload length ${out.length}`);
   }
   return new Uint8Array(out);
}

export function decodeFillCashoutIxData(data: ReadonlyUint8Array): FillCashoutIxData {
   if (data.length !== FILL_CASHOUT_IX_DATA_LEN) {
      throw new RangeError(`fillCashout: expected ${FILL_CASHOUT_IX_DATA_LEN} bytes`);
   }
   return getFillCashoutIxDataDecoder().decode(new Uint8Array(data));
}

export const getFillParlayCashoutIxDataEncoder = (): Encoder<FillParlayCashoutIxData> =>
   getStructEncoder([
      ['origBetId', getU64Encoder()],
      ['cashoutId', getU64Encoder()],
      ['amount', getU64Encoder()],
      ['minPayout', getU64Encoder()],
      ['numLegs', getU8Encoder()],
      ['snapshots', getArrayEncoder(getCashoutSnapshotEncoder(), { size: 'remainder' })],
   ]);

export const getFillParlayCashoutIxDataDecoder = (): Decoder<FillParlayCashoutIxData> =>
   getStructDecoder([
      ['origBetId', getU64Decoder()],
      ['cashoutId', getU64Decoder()],
      ['amount', getU64Decoder()],
      ['minPayout', getU64Decoder()],
      ['numLegs', getU8Decoder()],
      ['snapshots', getArrayDecoder(getCashoutSnapshotDecoder(), { size: 'remainder' })],
   ]);

export function encodeFillParlayCashoutIxData(data: FillParlayCashoutIxData): Uint8Array {
   validateFillParlayCashoutIxData(data);
   const out = getFillParlayCashoutIxDataEncoder().encode(data);
   const expected = fillParlayCashoutIxDataLen(data.numLegs);
   if (out.length !== expected) {
      throw new RangeError(`fillParlayCashout: expected ${expected} bytes for ${data.numLegs} legs`);
   }
   return new Uint8Array(out);
}

export function decodeFillParlayCashoutIxData(data: ReadonlyUint8Array): FillParlayCashoutIxData {
   if (data.length < FILL_PARLAY_CASHOUT_IX_HEADER_LEN) {
      throw new RangeError(`fillParlayCashout: expected at least ${FILL_PARLAY_CASHOUT_IX_HEADER_LEN} bytes`);
   }
   const numLegs = data[FILL_PARLAY_CASHOUT_IX_HEADER_LEN - 1]!;
   if (numLegs < 2 || numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`fillParlayCashout: numLegs must be in [2, ${MAX_PARLAY_LEGS}]`);
   }
   const expected = fillParlayCashoutIxDataLen(numLegs);
   if (data.length !== expected) {
      throw new RangeError(`fillParlayCashout: expected ${expected} bytes for ${numLegs} legs`);
   }
   return getFillParlayCashoutIxDataDecoder().decode(new Uint8Array(data));
}

export const getFillRfqCashoutIxDataEncoder = (): Encoder<FillRfqCashoutIxData> =>
   getStructEncoder([
      ['origBetId', getU64Encoder()],
      ['cashoutId', getU64Encoder()],
      ['amount', getU64Encoder()],
      ['minPayout', getU64Encoder()],
      ['maxPayment', getU64Encoder()],
      ['offerExpiry', getU32Encoder()],
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['signature', fixEncoderSize(getBytesEncoder(), RFQ_SIGNATURE_LEN)],
   ]);

export const getFillRfqCashoutIxDataDecoder = (): Decoder<FillRfqCashoutIxData> =>
   getStructDecoder([
      ['origBetId', getU64Decoder()],
      ['cashoutId', getU64Decoder()],
      ['amount', getU64Decoder()],
      ['minPayout', getU64Decoder()],
      ['maxPayment', getU64Decoder()],
      ['offerExpiry', getU32Decoder()],
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
      ['signature', fixDecoderSize(getBytesDecoder(), RFQ_SIGNATURE_LEN)],
   ]);

export function encodeFillRfqCashoutIxData(data: FillRfqCashoutIxData): Uint8Array {
   validateFillRfqCashoutIxData(data);
   const out = getFillRfqCashoutIxDataEncoder().encode(data);
   if (out.length !== FILL_RFQ_CASHOUT_IX_DATA_LEN) {
      throw new RangeError(`fillRfqCashout body length ${out.length}`);
   }
   return new Uint8Array(out);
}

export function decodeFillRfqCashoutIxData(data: ReadonlyUint8Array): FillRfqCashoutIxData {
   if (data.length !== FILL_RFQ_CASHOUT_IX_DATA_LEN) {
      throw new RangeError(`fillRfqCashout: expected ${FILL_RFQ_CASHOUT_IX_DATA_LEN} bytes`);
   }
   return getFillRfqCashoutIxDataDecoder().decode(new Uint8Array(data));
}

const getFillRfqParlayCashoutIxBodyDecoder = (): Decoder<FillRfqParlayCashoutIxBody> =>
   getStructDecoder([
      ['origBetId', getU64Decoder()],
      ['cashoutId', getU64Decoder()],
      ['amount', getU64Decoder()],
      ['minPayout', getU64Decoder()],
      ['maxPayment', getU64Decoder()],
      ['offerExpiry', getU32Decoder()],
      ['numLegs', getU8Decoder()],
      ['snapshots', getArrayDecoder(getCashoutSnapshotDecoder(), { size: 'remainder' })],
   ]);

export const getFillRfqParlayCashoutIxDataEncoder = (): Encoder<FillRfqParlayCashoutIxData> =>
   getStructEncoder([
      ['origBetId', getU64Encoder()],
      ['cashoutId', getU64Encoder()],
      ['amount', getU64Encoder()],
      ['minPayout', getU64Encoder()],
      ['maxPayment', getU64Encoder()],
      ['offerExpiry', getU32Encoder()],
      ['numLegs', getU8Encoder()],
      ['snapshots', getArrayEncoder(getCashoutSnapshotEncoder(), { size: 'remainder' })],
      ['signature', fixEncoderSize(getBytesEncoder(), RFQ_SIGNATURE_LEN)],
   ]);

export const getFillRfqParlayCashoutIxDataDecoder = (): Decoder<FillRfqParlayCashoutIxData> =>
   transformDecoder(getBytesDecoder(), (data) =>
      decodeRfqSignedAfterBody(getFillRfqParlayCashoutIxBodyDecoder(), data),
   );

export function encodeFillRfqParlayCashoutIxData(data: FillRfqParlayCashoutIxData): Uint8Array {
   validateFillRfqParlayCashoutIxData(data);
   const out = getFillRfqParlayCashoutIxDataEncoder().encode(data);
   const expected = fillRfqParlayCashoutIxDataLen(data.numLegs);
   if (out.length !== expected) {
      throw new RangeError(`fillRfqParlayCashout: expected ${expected} bytes`);
   }
   return new Uint8Array(out);
}

export function decodeFillRfqParlayCashoutIxData(data: ReadonlyUint8Array): FillRfqParlayCashoutIxData {
   if (data.length < FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN + RFQ_SIGNATURE_LEN) {
      throw new RangeError('fillRfqParlayCashout: payload too short');
   }
   const numLegs = data[FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN - 1]!;
   const expected = fillRfqParlayCashoutIxDataLen(numLegs);
   if (data.length !== expected) {
      throw new RangeError(`fillRfqParlayCashout: expected ${expected} bytes`);
   }
   return getFillRfqParlayCashoutIxDataDecoder().decode(new Uint8Array(data));
}

export const getCashoutEscrowEncoder = (): Encoder<CashoutEscrow> =>
   getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['bump', getU8Encoder()],
      ['owner', getAddressEncoder()],
      ['feepayer', getAddressEncoder()],
      ['origBetId', getU64Encoder()],
      ['cashoutId', getU64Encoder()],
      ['timestamp', getU32Encoder()],
      ['amount', getU64Encoder()],
      ['payoutRemoved', getU64Encoder()],
      ['payment', getU64Encoder()],
      ['marketMaker', getAddressEncoder()],
      ['isParlay', getBoolU8Encoder()],
   ]);

export const getCashoutEscrowDecoder = (): Decoder<CashoutEscrow> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['owner', getAddressDecoder()],
      ['feepayer', getAddressDecoder()],
      ['origBetId', getU64Decoder()],
      ['cashoutId', getU64Decoder()],
      ['timestamp', getU32Decoder()],
      ['amount', getU64Decoder()],
      ['payoutRemoved', getU64Decoder()],
      ['payment', getU64Decoder()],
      ['marketMaker', getAddressDecoder()],
      ['isParlay', getBoolU8Decoder()],
   ]);

export const decodeCashoutEscrow = (data: ReadonlyUint8Array): CashoutEscrow => {
   if (data.length !== CASHOUT_ESCROW_LEN) {
      throw new RangeError(`cashout escrow len ${data.length}; expected ${CASHOUT_ESCROW_LEN}`);
   }
   const decoded = getCashoutEscrowDecoder().decode(new Uint8Array(data));
   if (decoded.discriminator !== CASHOUT_ESCROW_DISCRIMINATOR) {
      throw new RangeError(
         `cashout escrow discriminator ${decoded.discriminator}; expected ${CASHOUT_ESCROW_DISCRIMINATOR}`,
      );
   }
   return decoded;
};

const getCashoutAccountHeaderDecoder = (): Decoder<Omit<CashoutAccountData, 'fillers'>> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['mm', getAddressDecoder()],
      ['feepayer', getAddressDecoder()],
      ['origOwner', getAddressDecoder()],
      ['origBetId', getU64Decoder()],
      ['cashoutId', getU64Decoder()],
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['amount', getU64Decoder()],
      ['payout', getU64Decoder()],
      ['timestamp', getU32Decoder()],
      ['origEventStateSequence', getU16Decoder()],
      ['origEventGameState', getEventGameStateDecoder()],
      ['cashoutEventStateSequence', getU16Decoder()],
      ['cashoutEventGameState', getEventGameStateDecoder()],
      ['result', getBetResultU8Decoder()],
      ['numFillers', getU8Decoder()],
   ]);

export const decodeCashoutAccountDataStrict = (data: ReadonlyUint8Array): CashoutAccountData => {
   if (data.length < CASHOUT_ACCOUNT_MIN_LEN) {
      throw new RangeError(`cashout account len ${data.length} < min ${CASHOUT_ACCOUNT_MIN_LEN}`);
   }
   const header = getCashoutAccountHeaderDecoder().decode(
      new Uint8Array(data.subarray(0, CASHOUT_ACCOUNT_HEADER_LEN)),
   );
   if (header.discriminator !== CASHOUT_ACCOUNT_DISCRIMINATOR) {
      throw new RangeError(
         `cashout discriminator ${header.discriminator}; expected ${CASHOUT_ACCOUNT_DISCRIMINATOR}`,
      );
   }
   if (header.numFillers < 1 || header.numFillers > MAX_NUMBER_OF_MMS) {
      throw new RangeError(`cashout numFillers ${header.numFillers}`);
   }
   const expected = cashoutAccountLen(header.numFillers);
   if (data.length !== expected) {
      throw new RangeError(
         `cashout account len ${data.length}; expected ${expected} for ${header.numFillers} fillers`,
      );
   }
   const fillers = decodeLiveBetFillersBytes(data.subarray(CASHOUT_ACCOUNT_HEADER_LEN), header.numFillers);
   return { ...header, fillers };
};

const getCashoutParlayLegDecoder = (): Decoder<CashoutParlayLeg> =>
   getStructDecoder([
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['origEventStateSequence', getU16Decoder()],
      ['origEventGameState', getEventGameStateDecoder()],
      ['cashoutEventStateSequence', getU16Decoder()],
      ['cashoutEventGameState', getEventGameStateDecoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['result', getBetResultU8Decoder()],
   ]);

function decodeLiveCashoutParlayLegsBytes(
   bytes: ReadonlyUint8Array,
   numLegs: number,
): CashoutParlayLeg[] {
   const expected = numLegs * CASHOUT_PARLAY_LEG_WIRE_LEN;
   if (bytes.length !== expected) {
      throw new RangeError(`cashout parlay legs len ${bytes.length}; expected ${expected}`);
   }
   const dec = getCashoutParlayLegDecoder();
   const legs: CashoutParlayLeg[] = [];
   for (let i = 0; i < numLegs; i++) {
      const off = i * CASHOUT_PARLAY_LEG_WIRE_LEN;
      legs.push(dec.decode(bytes.subarray(off, off + CASHOUT_PARLAY_LEG_WIRE_LEN)));
   }
   return legs;
}

const getCashoutParlayHeaderDecoder = (): Decoder<Omit<CashoutParlayAccountData, 'legs'>> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['mm', getAddressDecoder()],
      ['feepayer', getAddressDecoder()],
      ['origOwner', getAddressDecoder()],
      ['origBetId', getU64Decoder()],
      ['cashoutId', getU64Decoder()],
      ['amount', getU64Decoder()],
      ['payout', getU64Decoder()],
      ['timestamp', getU32Decoder()],
      ['result', getBetResultU8Decoder()],
      ['originalFillerAddress', getAddressDecoder()],
      ['numLegs', getU8Decoder()],
   ]);

export const decodeCashoutParlayAccountDataStrict = (
   data: ReadonlyUint8Array,
): CashoutParlayAccountData => {
   if (data.length < CASHOUT_PARLAY_ACCOUNT_MIN_LEN) {
      throw new RangeError(
         `cashout parlay account len ${data.length} < min ${CASHOUT_PARLAY_ACCOUNT_MIN_LEN}`,
      );
   }
   const header = getCashoutParlayHeaderDecoder().decode(
      new Uint8Array(data.subarray(0, CASHOUT_PARLAY_HEADER_LEN)),
   );
   if (header.discriminator !== CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR) {
      throw new RangeError(
         `cashout parlay discriminator ${header.discriminator}; expected ${CASHOUT_PARLAY_ACCOUNT_DISCRIMINATOR}`,
      );
   }
   if (header.numLegs < 2 || header.numLegs > MAX_RFQ_PARLAY_LEGS) {
      throw new RangeError(`cashout parlay numLegs ${header.numLegs}`);
   }
   const expected = cashoutParlayAccountLen(header.numLegs);
   if (data.length !== expected) {
      throw new RangeError(
         `cashout parlay account len ${data.length}; expected ${expected} for ${header.numLegs} legs`,
      );
   }
   return {
      ...header,
      legs: decodeLiveCashoutParlayLegsBytes(data.subarray(CASHOUT_PARLAY_HEADER_LEN), header.numLegs),
   };
};

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

export const getAddLineToNettingIxPayloadEncoder = (): Encoder<AddLineToNettingIxData> =>
   getStructEncoder([
      ['eventId', getEventIdEncoder()],
      ['period', getU8Encoder()],
      ['mkt', getU16Encoder()],
   ]);

export const getAddLineToNettingIxPayloadDecoder = (): Decoder<AddLineToNettingIxData> =>
   getStructDecoder([
      ['eventId', getEventIdDecoder()],
      ['period', getU8Decoder()],
      ['mkt', getU16Decoder()],
   ]);

export const getRemoveLineFromNettingIxPayloadEncoder = (): Encoder<RemoveLineFromNettingIxData> =>
   getAddLineToNettingIxPayloadEncoder() as Encoder<RemoveLineFromNettingIxData>;

export const getRemoveLineFromNettingIxPayloadDecoder = (): Decoder<RemoveLineFromNettingIxData> =>
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

export const getFillRfqBetIxDataEncoder = (): Encoder<FillRfqBetIxData> =>
   getStructEncoder([
      ['betId', getU64Encoder()],
      ['marketId', getMarketIdEncoder()],
      ['side', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['eventStateSequence', getU16Encoder()],
      ['eventGameState', getEventGameStateEncoder()],
      ['maxStake', getU64Encoder()],
      ['offerExpiry', getU32Encoder()],
      ['signature', fixEncoderSize(getBytesEncoder(), RFQ_SIGNATURE_LEN)],
   ]);

export function encodeFillRfqBetIxData(data: FillRfqBetIxData): Uint8Array {
   validateFillRfqBetIxData(data);
   const out = getFillRfqBetIxDataEncoder().encode(data);
   if (out.length !== FILL_RFQ_BET_IX_DATA_LEN) {
      throw new RangeError(`fillRfqBet data len ${out.length}; expected ${FILL_RFQ_BET_IX_DATA_LEN}`);
   }
   return new Uint8Array(out);
}

export const getFillRfqBetIxDataDecoder = (): Decoder<FillRfqBetIxData> =>
   getStructDecoder([
      ['betId', getU64Decoder()],
      ['marketId', getMarketIdDecoder()],
      ['side', getU8Decoder()],
      ['amount', getU64Decoder()],
      ['oddsScaled', getU32BigintDecoder()],
      ['eventStateSequence', getU16Decoder()],
      ['eventGameState', getEventGameStateDecoder()],
      ['maxStake', getU64Decoder()],
      ['offerExpiry', getU32Decoder()],
      ['signature', fixDecoderSize(getBytesDecoder(), RFQ_SIGNATURE_LEN)],
   ]);

export const getFillRfqParlayIxDataEncoder = (): Encoder<FillRfqParlayIxData> =>
   getStructEncoder([
      ['betId', getU64Encoder()],
      ['amount', getU64Encoder()],
      ['oddsScaled', getU32BigintEncoder('oddsScaled')],
      ['maxStake', getU64Encoder()],
      ['offerExpiry', getU32Encoder()],
      ['numLegs', getU8Encoder()],
      ['legs', getArrayEncoder(getParlayLegQuotedEncoder(), { size: 'remainder' })],
      ['signature', fixEncoderSize(getBytesEncoder(), RFQ_SIGNATURE_LEN)],
   ]);

export const getFillRfqParlayIxDataDecoder = (): Decoder<FillRfqParlayIxData> =>
   transformDecoder(getBytesDecoder(), (data) =>
      decodeRfqSignedAfterBody(getFillRfqParlayIxBodyDecoder(), data),
   );

export function encodeFillRfqParlayIxData(data: FillRfqParlayIxData): Uint8Array {
   validateFillRfqParlayIxData(data);
   const out = getFillRfqParlayIxDataEncoder().encode(data);
   const expected = fillRfqParlayIxDataLen(data.numLegs);
   if (out.length !== expected) {
      throw new RangeError(`fillRfqParlay data len ${out.length}; expected ${expected}`);
   }
   return new Uint8Array(out);
}

export function decodeFillRfqParlayIxData(rest: ReadonlyUint8Array): FillRfqParlayIxData {
   if (rest.length < FILL_RFQ_PARLAY_IX_HEADER_LEN + RFQ_SIGNATURE_LEN) {
      throw new RangeError(`fillRfqParlay: data too short (${rest.length} bytes)`);
   }
   const bodyLen = rest.length - RFQ_SIGNATURE_LEN;
   const numLegs = rest[FILL_RFQ_PARLAY_IX_HEADER_LEN - 1]!;
   const expectedBody = fillRfqParlayIxBodyLen(numLegs);
   if (bodyLen !== expectedBody) {
      throw new RangeError(`fillRfqParlay body len ${bodyLen}; expected ${expectedBody} for ${numLegs} legs`);
   }
   return getFillRfqParlayIxDataDecoder().decode(new Uint8Array(rest));
}

export function concatDiscriminator(disc: number, payload: ReadonlyUint8Array | Uint8Array): Uint8Array {
   const p = new Uint8Array(payload);
   const out = new Uint8Array(1 + p.length);
   out[0] = disc & 0xff;
   out.set(p, 1);
   return out;
}

export function concatDiscriminatorU32Prefix(
   disc: number,
   freebetId: number,
   payload: ReadonlyUint8Array | Uint8Array,
): Uint8Array {
   if (!Number.isInteger(freebetId) || freebetId < 1 || freebetId > 0xffff_ffff) {
      throw new RangeError(`freebetId must be a u32 in [1, 2^32-1] (${freebetId})`);
   }
   const p = new Uint8Array(payload);
   const idBytes = getU32Encoder().encode(freebetId);
   const out = new Uint8Array(1 + 4 + p.length);
   out[0] = disc & 0xff;
   out.set(idBytes, 1);
   out.set(p, 5);
   return out;
}

export function parseU32Prefix(rest: ReadonlyUint8Array): { freebetId: number; body: Uint8Array } {
   if (rest.length < U32_LEN) {
      throw new RangeError(`freebet fill: expected ${U32_LEN}-byte freebetId prefix`);
   }
   const freebetId = getU32Decoder().decode(rest.subarray(0, U32_LEN));
   return { freebetId, body: new Uint8Array(rest.subarray(U32_LEN)) };
}

const getIssueFreebetIxHeaderEncoder = () =>
   getStructEncoder([
      ['freebetId', getU32Encoder()],
      ['expiry', getU32Encoder()],
      ['amount', getU64Encoder()],
      ['minOddsScaled', getU32BigintEncoder('minOddsScaled')],
      ['maxOddsScaled', getU32BigintEncoder('maxOddsScaled')],
      ['minLegs', getU8Encoder()],
      ['numMms', getU8Encoder()],
      ['numOperators', getU8Encoder()],
   ]);

const getIssueFreebetIxHeaderDecoder = () =>
   getStructDecoder([
      ['freebetId', getU32Decoder()],
      ['expiry', getU32Decoder()],
      ['amount', getU64Decoder()],
      ['minOddsScaled', getU32BigintDecoder()],
      ['maxOddsScaled', getU32BigintDecoder()],
      ['minLegs', getU8Decoder()],
      ['numMms', getU8Decoder()],
      ['numOperators', getU8Decoder()],
   ]);

function decodeAddressList(data: Uint8Array, offset: number, count: number): Address[] {
   const out: Address[] = [];
   for (let i = 0; i < count; i++) {
      const start = offset + i * ADDRESS_LEN;
      out.push(addrDecoder.decode(data.subarray(start, start + ADDRESS_LEN)));
   }
   return out;
}

function writeAddressList(out: Uint8Array, offset: number, addrs: readonly Address[]): number {
   let off = offset;
   for (const a of addrs) {
      out.set(addrEncoder.encode(a), off);
      off += ADDRESS_LEN;
   }
   return off;
}

export function encodeIssueFreebetIxData(data: IssueFreebetIxData): Uint8Array {
   validateIssueFreebetIxData(data);
   const expected = issueFreebetIxDataLen(data.allowedMms.length, data.allowedOperators.length);
   const header = getIssueFreebetIxHeaderEncoder().encode({
      freebetId: data.freebetId,
      expiry: data.expiry,
      amount: data.amount,
      minOddsScaled: data.minOddsScaled,
      maxOddsScaled: data.maxOddsScaled,
      minLegs: data.minLegs,
      numMms: data.allowedMms.length,
      numOperators: data.allowedOperators.length,
   });
   const out = new Uint8Array(expected);
   out.set(header, 0);
   let off = ISSUE_FREEBET_IX_HEADER_LEN;
   off = writeAddressList(out, off, data.allowedMms);
   writeAddressList(out, off, data.allowedOperators);
   if (out.length !== expected) {
      throw new RangeError(`issue_freebet body len ${out.length}; expected ${expected}`);
   }
   return out;
}

export function decodeIssueFreebetIxData(data: ReadonlyUint8Array): IssueFreebetIxData {
   if (data.length < ISSUE_FREEBET_IX_HEADER_LEN) {
      throw new RangeError(`issue_freebet body len ${data.length} < header ${ISSUE_FREEBET_IX_HEADER_LEN}`);
   }
   const bytes = new Uint8Array(data);
   const header = getIssueFreebetIxHeaderDecoder().decode(bytes.subarray(0, ISSUE_FREEBET_IX_HEADER_LEN));
   const expected = issueFreebetIxDataLen(header.numMms, header.numOperators);
   if (bytes.length !== expected) {
      throw new RangeError(`issue_freebet body len ${bytes.length}; expected ${expected}`);
   }
   if (header.numMms > MAX_FREEBET_ALLOWED_MMS) {
      throw new RangeError(`freebet numMms ${header.numMms} > ${MAX_FREEBET_ALLOWED_MMS}`);
   }
   if (header.numOperators > MAX_FREEBET_ALLOWED_OPERATORS) {
      throw new RangeError(
         `freebet numOperators ${header.numOperators} > ${MAX_FREEBET_ALLOWED_OPERATORS}`,
      );
   }
   let off = ISSUE_FREEBET_IX_HEADER_LEN;
   const allowedMms = decodeAddressList(bytes, off, header.numMms);
   off += header.numMms * ADDRESS_LEN;
   const allowedOperators = decodeAddressList(bytes, off, header.numOperators);
   return {
      freebetId: header.freebetId,
      expiry: header.expiry,
      amount: header.amount,
      minOddsScaled: header.minOddsScaled,
      maxOddsScaled: header.maxOddsScaled,
      minLegs: header.minLegs,
      allowedMms,
      allowedOperators,
   };
}

export const getIssueFreebetIxDataEncoder = (): { encode: (data: IssueFreebetIxData) => Uint8Array } => ({
   encode: encodeIssueFreebetIxData,
});

export const getIssueFreebetIxDataDecoder = (): { decode: (data: ReadonlyUint8Array) => IssueFreebetIxData } => ({
   decode: decodeIssueFreebetIxData,
});

export const getFreebetIssuerDecoder = (): Decoder<FreebetIssuer> =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['auth', addrDecoder],
      ['openCount', getU32Decoder()],
   ]);

export const decodeFreebetIssuer = (data: ReadonlyUint8Array): FreebetIssuer => {
   if (data.length !== FREEBET_ISSUER_LEN) {
      throw new RangeError(`freebet issuer len ${data.length}; expected ${FREEBET_ISSUER_LEN}`);
   }
   const decoded = getFreebetIssuerDecoder().decode(new Uint8Array(data));
   if (decoded.discriminator !== FREEBET_ISSUER_DISCRIMINATOR) {
      throw new RangeError(
         `freebet issuer discriminator ${decoded.discriminator}; expected ${FREEBET_ISSUER_DISCRIMINATOR}`,
      );
   }
   return decoded;
};

const getFreebetStateDecoder = (): Decoder<FreebetState> =>
   transformDecoder(getU8Decoder(), (n: number) => {
      if (n === FreebetState.Available) {
         return FreebetState.Available;
      }
      if (n === FreebetState.Used) {
         return FreebetState.Used;
      }
      throw new RangeError(`freebet state ${n}`);
   });

const getFreebetAccountHeaderDecoder = () =>
   getStructDecoder([
      ['discriminator', getU8Decoder()],
      ['bump', getU8Decoder()],
      ['state', getFreebetStateDecoder()],
      ['numMms', getU8Decoder()],
      ['minLegs', getU8Decoder()],
      ['numOperators', getU8Decoder()],
      ['freebetId', getU32Decoder()],
      ['expiry', getU32Decoder()],
      ['minOddsScaled', getU32BigintDecoder()],
      ['maxOddsScaled', getU32BigintDecoder()],
      ['amount', getU64Decoder()],
      ['issuerAuth', addrDecoder],
      ['user', addrDecoder],
   ]);

export const decodeFreebetAccountData = (data: ReadonlyUint8Array): FreebetAccountData => {
   if (data.length < FREEBET_ACCOUNT_HEADER_LEN) {
      throw new RangeError(`freebet account len ${data.length} < header ${FREEBET_ACCOUNT_HEADER_LEN}`);
   }
   const bytes = new Uint8Array(data);
   const numMms = bytes[3]!;
   const numOperators = bytes[5]!;
   if (numMms > MAX_FREEBET_ALLOWED_MMS) {
      throw new RangeError(`freebet numMms ${numMms} > ${MAX_FREEBET_ALLOWED_MMS}`);
   }
   if (numOperators > MAX_FREEBET_ALLOWED_OPERATORS) {
      throw new RangeError(`freebet numOperators ${numOperators} > ${MAX_FREEBET_ALLOWED_OPERATORS}`);
   }
   const expected = freebetAccountLen(numMms, numOperators);
   if (bytes.length !== expected) {
      throw new RangeError(`freebet account len ${bytes.length}; expected ${expected}`);
   }
   const header = getFreebetAccountHeaderDecoder().decode(bytes.subarray(0, FREEBET_ACCOUNT_HEADER_LEN));
   if (header.discriminator !== FREEBET_ACCOUNT_DISCRIMINATOR) {
      throw new RangeError(
         `freebet discriminator ${header.discriminator}; expected ${FREEBET_ACCOUNT_DISCRIMINATOR}`,
      );
   }
   let off = FREEBET_ACCOUNT_HEADER_LEN;
   const allowedMms = decodeAddressList(bytes, off, numMms);
   off += numMms * ADDRESS_LEN;
   const allowedOperators = decodeAddressList(bytes, off, numOperators);
   return {
      discriminator: header.discriminator,
      bump: header.bump,
      state: header.state,
      numMms: header.numMms,
      minLegs: header.minLegs,
      numOperators: header.numOperators,
      freebetId: header.freebetId,
      expiry: header.expiry,
      minOddsScaled: header.minOddsScaled,
      maxOddsScaled: header.maxOddsScaled,
      amount: header.amount,
      issuerAuth: header.issuerAuth,
      user: header.user,
      allowedMms,
      allowedOperators,
   };
};

export const getFreebetAccountDataDecoder = (): { decode: (data: ReadonlyUint8Array) => FreebetAccountData } => ({
   decode: decodeFreebetAccountData,
});

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

export const getGetParlayQuoteReturnWireDecoder = (): Decoder<GetParlayQuoteReturnWire> =>
   getStructDecoder([
      ['maxAmount', amountDecoder],
      ['oddsScaled', oddsDecoder],
      ['numLegs', getU8Decoder()],
      ['legOdds', getArrayDecoder(oddsDecoder, { size: 'remainder' })],
   ]);

/** Return data from MM `get_quote_parlay` (`GetParlayQuoteReturnWire`). */
export function decodeGetParlayQuoteReturnWire(data: ReadonlyUint8Array): GetParlayQuoteReturnWire {
   if (data.length < PARLAY_QUOTE_RETURN_HEADER_LEN) {
      throw new RangeError(
         `get_parlay_quote return data len ${data.length} < header ${PARLAY_QUOTE_RETURN_HEADER_LEN}`,
      );
   }
   const numLegs = data[PARLAY_QUOTE_RETURN_HEADER_LEN - 1]!;
   if (numLegs < 2 || numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`get_parlay_quote return numLegs ${numLegs}`);
   }
   const expected = parlayQuoteReturnWireLen(numLegs);
   if (data.length !== expected) {
      throw new RangeError(`get_parlay_quote return data len ${data.length}; expected ${expected}`);
   }
   return getGetParlayQuoteReturnWireDecoder().decode(new Uint8Array(data));
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

/** Full CPI payload to MM `get_cashout_quote` (`MM_GET_CASHOUT_QUOTE_IX_DISCRIMINATOR` = 140). */
export function encodeGetCashoutQuoteIxData(ix: GetCashoutQuoteIxData): Uint8Array {
   if (ix.instructionDiscriminator !== MM_GET_CASHOUT_QUOTE_IX_DISCRIMINATOR) {
      throw new RangeError(
         `get_cashout_quote instructionDiscriminator must be ${MM_GET_CASHOUT_QUOTE_IX_DISCRIMINATOR}`,
      );
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

/** Full CPI payload to MM `fill_cashout_quote` (`MM_FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR` = 141). */
export function encodeFillCashoutQuoteIxData(ix: FillCashoutQuoteIxData): Uint8Array {
   if (ix.instructionDiscriminator !== MM_FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR) {
      throw new RangeError(
         `fill_cashout_quote instructionDiscriminator must be ${MM_FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR}`,
      );
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

/** Full CPI payload to MM `get_cashout_quote_parlay` (`MM_GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR` = 142). */
export function encodeGetCashoutQuoteParlayIxData(ix: GetCashoutQuoteParlayIxData): Uint8Array {
   if (ix.instructionDiscriminator !== MM_GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR) {
      throw new RangeError(
         `get_cashout_quote_parlay instructionDiscriminator must be ${MM_GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR}`,
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
   out.set(encodeLiveParlayLegSelsBytes(ix.legs, ix.numLegs), 26);
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
   const legs = decodeLiveParlayLegSelsBytes(u8.subarray(26), numLegs);
   return { instructionDiscriminator, amount, payout, minPayout, numLegs, legs };
}

/** Full CPI payload to MM `fill_cashout_quote_parlay` (`MM_FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR` = 143). */
export function encodeFillCashoutQuoteParlayIxData(ix: FillCashoutQuoteParlayIxData): Uint8Array {
   if (ix.instructionDiscriminator !== MM_FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR) {
      throw new RangeError(
         `fill_cashout_quote_parlay instructionDiscriminator must be ${MM_FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR}`,
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
   const decoded = getConfigPdaDataDecoder().decode(new Uint8Array(data));
   if (decoded.discriminator !== CONFIG_PDA_DISCRIMINATOR) {
      throw new RangeError(
         `config discriminator ${decoded.discriminator}; expected ${CONFIG_PDA_DISCRIMINATOR}`,
      );
   }
   return decoded;
};

export const decodeEventStateData = (data: ReadonlyUint8Array): EventStateData => {
   if (data.length < EVENT_STATE_HEADER_LEN) {
      throw new RangeError(`event state len ${data.length}`);
   }
   if (data[0] !== EVENT_STATE_DISCRIMINATOR) {
      throw new RangeError(`event state discriminator ${data[0]} != ${EVENT_STATE_DISCRIMINATOR}`);
   }
   return getEventStateDataDecoder().decode(new Uint8Array(data.subarray(0, EVENT_STATE_HEADER_LEN)));
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
   if (data.length < MM_CONFIG_PDA_HEADER_LEN) {
      throw new RangeError(`mm account config len ${data.length}`);
   }
   return getMmAccountConfigDecoder().decode(new Uint8Array(data.subarray(0, MM_CONFIG_PDA_HEADER_LEN)));
};

export const decodeBetAccountDataStrict = (data: ReadonlyUint8Array): BetAccountData => {
   if (data.length < BET_ACCOUNT_MIN_LEN) {
      throw new RangeError(`bet account len ${data.length} < min ${BET_ACCOUNT_MIN_LEN}`);
   }
   if (data.length < BET_ACCOUNT_HEADER_LEN) {
      throw new RangeError(`bet account len ${data.length} < header ${BET_ACCOUNT_HEADER_LEN}`);
   }
   const header = getBetAccountHeaderDecoder().decode(new Uint8Array(data.subarray(0, BET_ACCOUNT_HEADER_LEN)));
   if (header.discriminator !== BET_ACCOUNT_DISCRIMINATOR) {
      throw new RangeError(
         `bet discriminator ${header.discriminator}; expected ${BET_ACCOUNT_DISCRIMINATOR}`,
      );
   }
   if (header.numFillers < 1 || header.numFillers > MAX_NUMBER_OF_MMS) {
      throw new RangeError(`bet numFillers ${header.numFillers}`);
   }
   const expected = betAccountLen(header.numFillers);
   if (data.length !== expected) {
      throw new RangeError(`bet account len ${data.length}; expected ${expected} for ${header.numFillers} fillers`);
   }
   const fillers = decodeLiveBetFillersBytes(data.subarray(BET_ACCOUNT_HEADER_LEN), header.numFillers);
   return { ...header, fillers };
};

export const decodeParlayBetAccountDataStrict = (data: ReadonlyUint8Array): ParlayBetAccountData => {
   if (data.length < PARLAY_BET_ACCOUNT_MIN_LEN) {
      throw new RangeError(`parlay bet account len ${data.length} < min ${PARLAY_BET_ACCOUNT_MIN_LEN}`);
   }
   if (data.length < PARLAY_BET_HEADER_LEN) {
      throw new RangeError(`parlay bet account len ${data.length} < header ${PARLAY_BET_HEADER_LEN}`);
   }
   const header = getParlayBetAccountHeaderDecoder().decode(new Uint8Array(data.subarray(0, PARLAY_BET_HEADER_LEN)));
   if (header.discriminator !== PARLAY_BET_ACCOUNT_DISCRIMINATOR) {
      throw new RangeError(
         `parlay bet discriminator ${header.discriminator}; expected ${PARLAY_BET_ACCOUNT_DISCRIMINATOR}`,
      );
   }
   if (header.numLegs < 2 || header.numLegs > MAX_RFQ_PARLAY_LEGS) {
      throw new RangeError(`parlay bet numLegs ${header.numLegs}`);
   }
   const expected = parlayBetAccountLen(header.numLegs);
   if (data.length !== expected) {
      throw new RangeError(`parlay bet account len ${data.length}; expected ${expected} for ${header.numLegs} legs`);
   }
   const legs = decodeLiveParlayLegsBytes(data.subarray(PARLAY_BET_HEADER_LEN), header.numLegs);
   return { ...header, legs };
};
