import { getAddressDecoder, getAddressEncoder, type Address } from '@solana/kit';

import {
   ADDRESS_LEN,
   CREATE_PREDICTION_IX_DATA_LEN,
   PREDICTION_ACCOUNT_LEN,
   TWEET_LINK_LEN,
   U32_LEN,
   U64_LEN,
} from './constants.js';
import type { PredictionAccountData } from './types.js';

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

export const PREDICTION_ACCOUNT_WIRE_OFFSETS = {
   discriminator: 0,
   bump: 1,
   predictionId: 2,
   contestId: 2 + U64_LEN,
   owner: 2 + U64_LEN + U32_LEN,
   timestamp: 2 + U64_LEN + U32_LEN + ADDRESS_LEN,
   prediction: 2 + U64_LEN + U32_LEN + ADDRESS_LEN + U32_LEN,
   openBet: 2 + U64_LEN + U32_LEN + ADDRESS_LEN + U32_LEN + 2,
   tweetLink: 2 + U64_LEN + U32_LEN + ADDRESS_LEN + U32_LEN + 2 + ADDRESS_LEN,
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
   const ownerBytes = bytes.subarray(PREDICTION_ACCOUNT_WIRE_OFFSETS.owner, PREDICTION_ACCOUNT_WIRE_OFFSETS.owner + ADDRESS_LEN);
   const openBetBytes = bytes.subarray(PREDICTION_ACCOUNT_WIRE_OFFSETS.openBet, PREDICTION_ACCOUNT_WIRE_OFFSETS.openBet + ADDRESS_LEN);
   return {
      discriminator: bytes[PREDICTION_ACCOUNT_WIRE_OFFSETS.discriminator]!,
      bump: bytes[PREDICTION_ACCOUNT_WIRE_OFFSETS.bump]!,
      predictionId: view.getBigUint64(PREDICTION_ACCOUNT_WIRE_OFFSETS.predictionId, true),
      contestId: view.getUint32(PREDICTION_ACCOUNT_WIRE_OFFSETS.contestId, true),
      owner: addressDecoder.decode(ownerBytes),
      timestamp: view.getUint32(PREDICTION_ACCOUNT_WIRE_OFFSETS.timestamp, true),
      prediction: [
         bytes[PREDICTION_ACCOUNT_WIRE_OFFSETS.prediction]!,
         bytes[PREDICTION_ACCOUNT_WIRE_OFFSETS.prediction + 1]!,
      ] as const,
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
   view.setUint32(U64_LEN, params.contestId >>> 0, true);
   out[U64_LEN + U32_LEN] = params.prediction[0]! & 0xff;
   out[U64_LEN + U32_LEN + 1] = params.prediction[1]! & 0xff;
   out.set(new Uint8Array(addressEncoder.encode(params.openBet)), U64_LEN + U32_LEN + 2);
   out.set(encodeTweetLink(params.tweetLink), U64_LEN + U32_LEN + 2 + ADDRESS_LEN);
   return out;
}
