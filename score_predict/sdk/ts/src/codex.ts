import { getAddressDecoder, getAddressEncoder, type Address } from '@solana/kit';

import {
   CREATE_PREDICTION_IX_DATA_LEN,
   PREDICTION_ACCOUNT_LEN,
   TWEET_LINK_LEN,
} from './constants.js';
import type { PredictionAccountData } from './types.js';

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

export const PREDICTION_ACCOUNT_WIRE_OFFSETS = {
   discriminator: 0,
   bump: 1,
   predictionId: 2,
   contestId: 10,
   owner: 14,
   timestamp: 46,
   prediction: 50,
   openBet: 52,
   tweetLink: 84,
} as const;

function encodeTweetLink(value: string): Uint8Array {
   const out = new Uint8Array(TWEET_LINK_LEN);
   const encoded = new TextEncoder().encode(value);
   out.set(encoded.subarray(0, Math.min(encoded.length, TWEET_LINK_LEN)));
   return out;
}

function decodeTweetLink(bytes: Uint8Array, offset: number): string {
   const slice = bytes.subarray(offset, offset + TWEET_LINK_LEN);
   let end = slice.length;
   while (end > 0 && slice[end - 1] === 0) {
      end--;
   }
   return new TextDecoder().decode(slice.subarray(0, end));
}

export function decodePredictionAccountData(bytes: Uint8Array): PredictionAccountData {
   if (bytes.length < PREDICTION_ACCOUNT_LEN) {
      throw new RangeError(`prediction account data too short: ${bytes.length}`);
   }
   const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
   const ownerBytes = bytes.subarray(PREDICTION_ACCOUNT_WIRE_OFFSETS.owner, PREDICTION_ACCOUNT_WIRE_OFFSETS.owner + 32);
   const openBetBytes = bytes.subarray(PREDICTION_ACCOUNT_WIRE_OFFSETS.openBet, PREDICTION_ACCOUNT_WIRE_OFFSETS.openBet + 32);
   return {
      discriminator: bytes[PREDICTION_ACCOUNT_WIRE_OFFSETS.discriminator]!,
      bump: bytes[PREDICTION_ACCOUNT_WIRE_OFFSETS.bump]!,
      predictionId: view.getBigUint64(PREDICTION_ACCOUNT_WIRE_OFFSETS.predictionId, true),
      contestId: view.getUint32(PREDICTION_ACCOUNT_WIRE_OFFSETS.contestId, true),
      owner: addressDecoder.decode(ownerBytes),
      timestamp: view.getUint32(PREDICTION_ACCOUNT_WIRE_OFFSETS.timestamp, true),
      prediction: [bytes[50]!, bytes[51]!] as const,
      openBet: addressDecoder.decode(openBetBytes),
      tweetLink: decodeTweetLink(bytes, PREDICTION_ACCOUNT_WIRE_OFFSETS.tweetLink),
   };
}

export function encodeCreatePredictionIxData(params: Readonly<{
   predictionId: bigint;
   contestId: number;
   prediction: readonly [number, number];
   openBet: Address;
   tweetLink: string;
}>): Uint8Array {
   const out = new Uint8Array(CREATE_PREDICTION_IX_DATA_LEN);
   const view = new DataView(out.buffer);
   view.setBigUint64(0, params.predictionId, true);
   view.setUint32(8, params.contestId >>> 0, true);
   out[12] = params.prediction[0]! & 0xff;
   out[13] = params.prediction[1]! & 0xff;
   out.set(new Uint8Array(addressEncoder.encode(params.openBet)), 14);
   out.set(encodeTweetLink(params.tweetLink), 46);
   return out;
}
