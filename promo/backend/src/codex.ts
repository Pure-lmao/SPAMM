/**
 * Promo MM instruction encoders — layouts match `promo/program/src`.
 */

import { getAddressDecoder, getAddressEncoder, type Address } from '@solana/kit';
import {
   getEventGameStateEncoder,
   getEventIdEncoder,
   getMarketIdEncoder,
   MARKET_ID_WIRE_SIZE,
} from './spammSdk';
import type { EventGameState, EventId, MarketId } from './spammSdk';

export const INIT_PROGRAM_IX_DISCRIMINATOR = 100;
export const SET_RFQ_SIGNER_IX_DISCRIMINATOR = 101;
export const INIT_EVENT_IX_DISCRIMINATOR = 110;
export const INIT_MARKET_IX_DISCRIMINATOR = 111;
export const CLOSE_EVENT_IX_DISCRIMINATOR = 112;
export const CLOSE_MARKET_IX_DISCRIMINATOR = 113;
export const UPDATE_EVENT_STATE_IX_DISCRIMINATOR = 114;
export const SET_MARKET_MAX_AMOUNT_IX_DISCRIMINATOR = 14;
export const SET_MARKET_MAX_TOTAL_AMOUNT_IX_DISCRIMINATOR = 15;
export const WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR = 150;
export const UPDATE_ORACLE_IX_DISCRIMINATOR = 0;
export const UPDATE_STATUS_IX_DISCRIMINATOR = 2;
export const WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR = 254;
export const FORCE_CLOSE_PDA_IX_DISCRIMINATOR = 255;
export const ORACLE_ACCOUNT_DISCRIMINATOR = 100;

/** Promo init market fixed prefix (after discriminator); allowlist pubkeys follow. */
export const PROMO_INIT_MARKET_IX_HEADER_LEN = MARKET_ID_WIRE_SIZE + 4 + 4 + 1 + 3 + 8 + 8;
export const PROMO_INIT_MARKET_MAX_AMOUNT_OFFSET = MARKET_ID_WIRE_SIZE + 4 + 4 + 1 + 3;
export const PROMO_INIT_MARKET_MAX_TOTAL_AMOUNT_OFFSET = PROMO_INIT_MARKET_MAX_AMOUNT_OFFSET + 8;

/** Header 55 + 150 allowlist + 150 bettors (CPI create ≤ 10 KiB). */
export const PROMO_ORACLE_ACCOUNT_LEN = 9655;
export const MAX_PROMO_BETTORS = 150;
export const MAX_PROMO_ALLOWED = 150;
export const BETTOR_PUBKEY_LEN = 32;

const marketIdEncoder = getMarketIdEncoder();
const eventIdEncoder = getEventIdEncoder();
const eventGameStateEncoder = getEventGameStateEncoder();
const addressEncoder = getAddressEncoder();

function concatDiscriminator(disc: number, payload: Uint8Array): Uint8Array {
   const out = new Uint8Array(1 + payload.length);
   out[0] = disc & 0xff;
   out.set(payload, 1);
   return out;
}

export type PromoInitMarketPayload = {
   marketId: MarketId;
   eventStartTime: number;
   marketOutcomes: 2 | 3;
   maxAmount: bigint;
   maxTotalAmount: bigint;
   allowedAccounts: readonly Address[];
};

export function encodePromoInitMarketIxData(payload: PromoInitMarketPayload): Uint8Array {
   if (payload.allowedAccounts.length > MAX_PROMO_ALLOWED) {
      throw new RangeError(
         `allowedAccounts length ${payload.allowedAccounts.length} (want 0..=${MAX_PROMO_ALLOWED})`,
      );
   }
   const marketWire = new Uint8Array(marketIdEncoder.encode(payload.marketId));
   const body = new Uint8Array(
      PROMO_INIT_MARKET_IX_HEADER_LEN + payload.allowedAccounts.length * BETTOR_PUBKEY_LEN,
   );
   body.set(marketWire, 0);
   const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
   view.setUint32(MARKET_ID_WIRE_SIZE, payload.eventStartTime >>> 0, true);
   view.setUint32(MARKET_ID_WIRE_SIZE + 4, 0, true);
   body[MARKET_ID_WIRE_SIZE + 8] = payload.marketOutcomes;
   view.setBigUint64(PROMO_INIT_MARKET_MAX_AMOUNT_OFFSET, payload.maxAmount, true);
   view.setBigUint64(PROMO_INIT_MARKET_MAX_TOTAL_AMOUNT_OFFSET, payload.maxTotalAmount, true);
   let off = PROMO_INIT_MARKET_IX_HEADER_LEN;
   for (const acct of payload.allowedAccounts) {
      body.set(addressEncoder.encode(acct), off);
      off += BETTOR_PUBKEY_LEN;
   }
   return concatDiscriminator(INIT_MARKET_IX_DISCRIMINATOR, body);
}

export function encodePromoInitProgramIxData(admin: Address, rfqSigner: Address = admin): Uint8Array {
   const body = new Uint8Array(64);
   body.set(addressEncoder.encode(admin), 0);
   body.set(addressEncoder.encode(rfqSigner), 32);
   return concatDiscriminator(INIT_PROGRAM_IX_DISCRIMINATOR, body);
}

export function encodePromoInitEventIxData(eventId: EventId): Uint8Array {
   return concatDiscriminator(INIT_EVENT_IX_DISCRIMINATOR, new Uint8Array(eventIdEncoder.encode(eventId)));
}

export function encodePromoUpdateEventStateIxData(
   eventId: EventId,
   sequence: number,
   gameState: EventGameState,
): Uint8Array {
   const eventWire = new Uint8Array(eventIdEncoder.encode(eventId));
   const gameWire = new Uint8Array(eventGameStateEncoder.encode(gameState));
   const body = new Uint8Array(eventWire.length + 2 + gameWire.length);
   body.set(eventWire, 0);
   body[eventWire.length] = sequence & 0xff;
   body[eventWire.length + 1] = (sequence >> 8) & 0xff;
   body.set(gameWire, eventWire.length + 2);
   return concatDiscriminator(UPDATE_EVENT_STATE_IX_DISCRIMINATOR, body);
}

export function encodePromoCloseEventIxData(eventId: EventId): Uint8Array {
   return concatDiscriminator(CLOSE_EVENT_IX_DISCRIMINATOR, new Uint8Array(eventIdEncoder.encode(eventId)));
}

export function encodePromoCloseMarketIxData(marketId: MarketId): Uint8Array {
   return concatDiscriminator(CLOSE_MARKET_IX_DISCRIMINATOR, new Uint8Array(marketIdEncoder.encode(marketId)));
}

export function encodeSetMarketMaxAmountIxData(
   marketId: MarketId,
   maxAmount: bigint,
): Uint8Array {
   const marketWire = new Uint8Array(marketIdEncoder.encode(marketId));
   const body = new Uint8Array(MARKET_ID_WIRE_SIZE + 8);
   body.set(marketWire, 0);
   const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
   view.setBigUint64(MARKET_ID_WIRE_SIZE, maxAmount, true);
   return concatDiscriminator(SET_MARKET_MAX_AMOUNT_IX_DISCRIMINATOR, body);
}

export function encodeSetMarketMaxTotalAmountIxData(
   marketId: MarketId,
   maxTotalAmount: bigint,
): Uint8Array {
   const marketWire = new Uint8Array(marketIdEncoder.encode(marketId));
   const body = new Uint8Array(MARKET_ID_WIRE_SIZE + 8);
   body.set(marketWire, 0);
   const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
   view.setBigUint64(MARKET_ID_WIRE_SIZE, maxTotalAmount, true);
   return concatDiscriminator(SET_MARKET_MAX_TOTAL_AMOUNT_IX_DISCRIMINATOR, body);
}

export function encodeUpdateOracleIxData(input: {
   sequence: bigint;
   odds0: bigint;
   odds1: bigint;
   odds2: bigint;
}): Uint8Array {
   const body = new Uint8Array(16);
   const view = new DataView(body.buffer);
   view.setUint32(0, Number(input.sequence), true);
   view.setUint32(4, Number(input.odds0), true);
   view.setUint32(8, Number(input.odds1), true);
   view.setUint32(12, Number(input.odds2), true);
   return concatDiscriminator(UPDATE_ORACLE_IX_DISCRIMINATOR, body);
}

export function encodeUpdateStatusIxData(active: boolean): Uint8Array {
   return concatDiscriminator(UPDATE_STATUS_IX_DISCRIMINATOR, new Uint8Array([active ? 1 : 0]));
}

/** Ix data after disc 254: `offset` u16 LE + bytes. */
export function encodeWriteArbitraryDataIxData(offset: number, bytes: Uint8Array): Uint8Array {
   if (offset < 0 || offset > 0xffff) {
      throw new RangeError(`writeArbitraryData offset ${offset}`);
   }
   const payload = new Uint8Array(2 + bytes.length);
   payload[0] = offset & 0xff;
   payload[1] = (offset >> 8) & 0xff;
   payload.set(bytes, 2);
   return concatDiscriminator(WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR, payload);
}

export function encodeForceClosePdaIxData(): Uint8Array {
   return new Uint8Array([FORCE_CLOSE_PDA_IX_DISCRIMINATOR]);
}

const addressDecoder = getAddressDecoder();

export type PromoConfigAccount = {
   discriminator: number;
   bump: number;
   admin: Address;
   rfqSigner: Address;
   status: boolean;
};

export function decodePromoConfigAccount(data: Readonly<Uint8Array>): PromoConfigAccount {
   if (data.length < 35) {
      throw new RangeError(`promo config account len ${data.length}`);
   }
   const admin = addressDecoder.decode(data.subarray(2, 34));
   if (data.length >= PROMO_CONFIG_MIN_LEN) {
      return {
         discriminator: data[0]!,
         bump: data[1]!,
         admin,
         rfqSigner: addressDecoder.decode(data.subarray(34, 66)),
         status: data[66]! !== 0,
      };
   }
   return {
      discriminator: data[0]!,
      bump: data[1]!,
      admin,
      rfqSigner: admin,
      status: data[34]! !== 0,
   };
}

/** Promo oracle account layout offsets (`promo/program/src/state/account_oracle.rs`). */
export const PROMO_ORACLE_OFFSETS = {
   discriminator: 0,
   bump: 1,
   sequence: 2,
   outcomeOdds0: 6,
   outcomeOdds1: 10,
   outcomeOdds2: 14,
   eventStartTime: 18,
   parlayFactor: 22,
   marketOutcomes: 26,
   maxAmount: 27,
   maxTotalAmount: 35,
   totalStakeAmount: 43,
   allowedCount: 51,
   bettorCount: 53,
   allowed: 55,
   bettors: 55 + MAX_PROMO_ALLOWED * BETTOR_PUBKEY_LEN,
} as const;

export type PromoOracleAccount = {
   discriminator: number;
   bump: number;
   sequence: number;
   outcomeOdds0: number;
   outcomeOdds1: number;
   outcomeOdds2: number;
   eventStartTime: number;
   parlayFactor: number;
   marketOutcomes: number;
   maxAmount: bigint;
   maxTotalAmount: bigint;
   totalStakeAmount: bigint;
   allowedCount: number;
   bettorCount: number;
   allowed: Readonly<Uint8Array>;
   bettors: Readonly<Uint8Array>;
};

export function decodePromoOracleAccount(data: Readonly<Uint8Array>): PromoOracleAccount {
   if (data.length < PROMO_ORACLE_ACCOUNT_LEN) {
      throw new RangeError(`promo oracle account len ${data.length}, expected ${PROMO_ORACLE_ACCOUNT_LEN}`);
   }
   const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
   const o = PROMO_ORACLE_OFFSETS;
   const allowedCount = view.getUint16(o.allowedCount, true);
   const bettorCount = view.getUint16(o.bettorCount, true);
   const allowedEnd = o.allowed + allowedCount * BETTOR_PUBKEY_LEN;
   const bettorsEnd = o.bettors + bettorCount * BETTOR_PUBKEY_LEN;
   if (allowedEnd > o.bettors || bettorsEnd > data.length) {
      throw new RangeError(
         `promo oracle slice out of range (${allowedCount} allowed, ${bettorCount} bettors)`,
      );
   }
   return {
      discriminator: data[o.discriminator]!,
      bump: data[o.bump]!,
      sequence: view.getUint32(o.sequence, true),
      outcomeOdds0: view.getUint32(o.outcomeOdds0, true),
      outcomeOdds1: view.getUint32(o.outcomeOdds1, true),
      outcomeOdds2: view.getUint32(o.outcomeOdds2, true),
      eventStartTime: view.getUint32(o.eventStartTime, true),
      parlayFactor: view.getUint32(o.parlayFactor, true),
      marketOutcomes: data[o.marketOutcomes]!,
      maxAmount: view.getBigUint64(o.maxAmount, true),
      maxTotalAmount: view.getBigUint64(o.maxTotalAmount, true),
      totalStakeAmount: view.getBigUint64(o.totalStakeAmount, true),
      allowedCount,
      bettorCount,
      allowed: data.subarray(o.allowed, allowedEnd),
      bettors: data.subarray(o.bettors, bettorsEnd),
   };
}

export const PROMO_MKT = 9;
export const PROMO_SIDE = 0;

/** Promo global config: MmAccountConfig header (66) + status (1). */
export const PROMO_CONFIG_MIN_LEN = 67;
