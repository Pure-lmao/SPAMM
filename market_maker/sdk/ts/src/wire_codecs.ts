/**
 * Shared `EventId` / `MarketId` wire codecs (PDA seeds, instruction tails).
 *
 * @see https://www.solanakit.com/docs/concepts/codecs
 */

import {
   getAddressDecoder,
   getAddressEncoder,
   getStructDecoder,
   getStructEncoder,
   getU16Decoder,
   getU16Encoder,
   getU64Decoder,
   getU64Encoder,
   getU8Decoder,
   getU8Encoder,
   type Decoder,
   type Encoder,
   transformDecoder,
   transformEncoder,
} from '@solana/kit';

import { Sport, type EventId, type MarketId } from './types.js';

const getBoolU8Encoder = (): Encoder<boolean> =>
   transformEncoder(getU8Encoder(), (v: boolean) => (v ? 1 : 0));

const getBoolU8Decoder = (): Decoder<boolean> =>
   transformDecoder(getU8Decoder(), (n: number) => {
      if (n !== 0 && n !== 1) {
         throw new RangeError(`boolean wire byte must be 0 or 1, got ${n}`);
      }
      return n !== 0;
   });

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

export function encodeEventIdWire(eventId: EventId): Uint8Array {
   return new Uint8Array(getEventIdEncoder().encode(eventId));
}
