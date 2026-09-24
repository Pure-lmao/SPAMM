import { getAddressEncoder, type Address } from '@solana/kit';

import {
   getEventGameStateEncoder,
   getEventIdEncoder,
   getMarketIdEncoder,
} from 'spamm-aggregator-sdk';

import type { EventGameState, EventId, MarketId } from './types.js';
import {
   CLOSE_EVENT_IX_DISCRIMINATOR,
   CLOSE_MARKET_IX_DISCRIMINATOR,
   INIT_EVENT_IX_DISCRIMINATOR,
   INIT_MARKET_IX_DISCRIMINATOR,
   INIT_PROGRAM_IX_DISCRIMINATOR,
   SET_RFQ_SIGNER_IX_DISCRIMINATOR,
   UPDATE_EVENT_STATE_IX_DISCRIMINATOR,
   UPDATE_MARKET_IX_DISCRIMINATOR,
   WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR,
} from './constants.js';

const addressEncoder = getAddressEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
   const len = parts.reduce((n, p) => n + p.length, 0);
   const out = new Uint8Array(len);
   let offset = 0;
   for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
   }
   return out;
}

function withDisc(disc: number, body: Uint8Array): Uint8Array {
   return concat([Uint8Array.of(disc), body]);
}

/** `init_program`: admin pubkey then rfq signer pubkey. */
export function encodeInitProgramIxData(admin: Address, rfqSigner: Address): Uint8Array {
   return withDisc(INIT_PROGRAM_IX_DISCRIMINATOR, concat([
      new Uint8Array(addressEncoder.encode(admin)),
      new Uint8Array(addressEncoder.encode(rfqSigner)),
   ]));
}

export function encodeSetRfqSignerIxData(): Uint8Array {
   return Uint8Array.of(SET_RFQ_SIGNER_IX_DISCRIMINATOR);
}

export function encodeInitEventIxData(eventId: EventId): Uint8Array {
   return withDisc(INIT_EVENT_IX_DISCRIMINATOR, new Uint8Array(getEventIdEncoder().encode(eventId)));
}

export function encodeInitMarketIxData(marketId: MarketId): Uint8Array {
   return withDisc(INIT_MARKET_IX_DISCRIMINATOR, new Uint8Array(getMarketIdEncoder().encode(marketId)));
}

export function encodeCloseEventIxData(eventId: EventId): Uint8Array {
   return withDisc(CLOSE_EVENT_IX_DISCRIMINATOR, new Uint8Array(getEventIdEncoder().encode(eventId)));
}

export function encodeUpdateMarketIxData(marketId: MarketId): Uint8Array {
   return withDisc(UPDATE_MARKET_IX_DISCRIMINATOR, new Uint8Array(getMarketIdEncoder().encode(marketId)));
}

export function encodeCloseMarketIxData(marketId: MarketId): Uint8Array {
   return withDisc(CLOSE_MARKET_IX_DISCRIMINATOR, new Uint8Array(getMarketIdEncoder().encode(marketId)));
}

/** `update_event_state`: event id, sequence u16 LE, game state. */
export function encodeUpdateEventStateIxData(
   eventId: EventId,
   sequence: number,
   gameState: EventGameState,
): Uint8Array {
   const seq = new Uint8Array(2);
   seq[0] = sequence & 0xff;
   seq[1] = (sequence >> 8) & 0xff;
   return withDisc(UPDATE_EVENT_STATE_IX_DISCRIMINATOR, concat([
      new Uint8Array(getEventIdEncoder().encode(eventId)),
      seq,
      new Uint8Array(getEventGameStateEncoder().encode(gameState)),
   ]));
}

export function encodeWithdrawIxData(): Uint8Array {
   return Uint8Array.of(WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR);
}

/** MM RFQ fill CPI: discriminator + `amount_to_send` u64 LE. */
export function encodeFillRfqIxData(discriminator: number, amountToSend: bigint): Uint8Array {
   const amount = new Uint8Array(8);
   let n = amountToSend;
   for (let i = 0; i < 8; i++) {
      amount[i] = Number(n & 0xffn);
      n >>= 8n;
   }
   return withDisc(discriminator, amount);
}
