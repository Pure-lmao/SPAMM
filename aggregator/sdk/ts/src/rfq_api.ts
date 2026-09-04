/**
 * Off-chain RFQ HTTP + MM WebSocket wire contract.
 *
 * Shared by the aggregator API, MM backends, and clients.
 * Bigints and signatures are JSON-safe (`string` / base64).
 */

import { address, type Address } from '@solana/kit';

import { MAX_RFQ_PARLAY_LEGS } from './constants.js';
import { RFQ_SIGNATURE_LEN, type EventGameState, type MarketId } from './types.js';

/** How long the API waits for MM quote replies before responding to POST `/api/rfq`. */
export const RFQ_COLLECT_TIMEOUT_MS = 2000;

/** MM WebSocket path on the aggregator API (`Bun.serve` upgrade). */
export const RFQ_MM_WS_PATH = '/ws/mm';

/** One selection in an RFQ (single = 1 leg, parlay = 2..{@link MAX_RFQ_PARLAY_LEGS}). */
export type RfqSelectionJson = {
   marketId: MarketIdJson;
   side: number;
   eventStateSequence: number;
   eventGameState: EventGameState;
};

export type MarketIdJson = {
   eventId: {
      event: string;
      league: number;
      sport: number;
   };
   player: string;
   mkt: number;
   period: number;
   isPregame: boolean;
   operator: string;
};

/** `POST /api/rfq` request body (JSON). */
export type RfqHttpRequestJson = {
   user: string;
   betId: string;
   amount: string;
   selections: RfqSelectionJson[];
};

/** One MM quote returned to the user (and sent by MMs over WS). */
export type RfqQuoteJson = {
   mmProgramId: string;
   /** Max stake the MM will take (must be >= user amount for a full fill). */
   maxStake: string;
   /** Combined decimal odds × ODDS_SCALE. */
   oddsScaled: string;
   /** Unix seconds; on-chain rejects after this. */
   offerExpiry: number;
   /** Ed25519 signature over the canonical RFQ message (base64, 64 bytes). */
   signature: string;
   /**
    * Per-leg odds × ODDS_SCALE. Length must equal the request `selections.length`
    * (single-bet: one entry, typically matching `oddsScaled`).
    * For parlays, product of positive leg odds must match `oddsScaled`.
    */
   legOddsScaled: string[];
};

/** `POST /api/rfq` response body. */
export type RfqHttpResponseJson = {
   requestId: string;
   quotes: RfqQuoteJson[];
   /** True if the 2s window elapsed before every connected MM replied. */
   timedOut: boolean;
   /** Number of MM sockets the request was fanned out to. */
   mmCount: number;
};

/** One cashout selection context (single = market + live snapshot; parlay = per-leg snapshots). */
export type RfqCashoutSnapshotJson = {
   eventStateSequence: number;
   eventGameState: EventGameState;
};

/** `POST /api/rfq/cashout` request body (JSON). */
export type RfqCashoutHttpRequestJson = {
   user: string;
   /** Original ticket `bet_id` / parlay `bet_id`. */
   origBetId: string;
   /** Client-chosen cashout id for the novated PDA. */
   cashoutId: string;
   /** Stake slice to cash (≤ remaining ticket amount). */
   amount: string;
   /** Floor on MM payment (slippage). */
   minPayout: string;
   /**
    * Single-bet: one entry (quoted live snapshot).
    * Parlay: one entry per open leg (orig sequences for validation; quoted may match).
    */
   snapshots: RfqCashoutSnapshotJson[];
   /** Optional market id for single-bet cashout fan-out / MM context. */
   marketId?: MarketIdJson;
   side?: number;
};

/** One MM cashout quote returned to the user (and sent by MMs over WS). */
export type RfqCashoutQuoteJson = {
   mmProgramId: string;
   /** Full cash payment the MM will pay (≤ payout removed from ticket). */
   maxPayment: string;
   /** Unix seconds; on-chain rejects after this. */
   offerExpiry: number;
   /** Ed25519 signature over the canonical cashout RFQ message (base64, 64 bytes). */
   signature: string;
};

/** `POST /api/rfq/cashout` response body. */
export type RfqCashoutHttpResponseJson = {
   requestId: string;
   quotes: RfqCashoutQuoteJson[];
   timedOut: boolean;
   mmCount: number;
};

/** API → MM: fan-out payload. */
export type RfqWsRequestMessage = {
   type: 'rfq.request';
   requestId: string;
   user: string;
   betId: string;
   amount: string;
   selections: RfqSelectionJson[];
};

/** API → MM: cashout fan-out payload. */
export type RfqWsCashoutRequestMessage = {
   type: 'rfq.cashout.request';
   requestId: string;
   user: string;
   origBetId: string;
   cashoutId: string;
   amount: string;
   minPayout: string;
   snapshots: RfqCashoutSnapshotJson[];
   marketId?: MarketIdJson;
   side?: number;
};

/** MM → API: signed quote for a pending request. */
export type RfqWsQuoteMessage = {
   type: 'rfq.quote';
   requestId: string;
   mmProgramId: string;
   maxStake: string;
   oddsScaled: string;
   offerExpiry: number;
   signature: string;
   /** Per-leg odds × ODDS_SCALE; length must match the request selection count. */
   legOddsScaled: string[];
};

/** MM → API: signed cashout quote for a pending cashout request. */
export type RfqWsCashoutQuoteMessage = {
   type: 'rfq.cashout.quote';
   requestId: string;
   mmProgramId: string;
   maxPayment: string;
   offerExpiry: number;
   signature: string;
};

/** API → MM: hello accepted. */
export type RfqWsHelloAckMessage = {
   type: 'mm.hello.ack';
   mmProgramId: string;
   rfqSigner: string;
};

/** MM → API: first message after connect (signed proof of RFQ key ownership). */
export type RfqWsHelloMessage = {
   type: 'mm.hello';
   mmProgramId: string;
   /** Claimed RFQ ed25519 pubkey; must match on-chain `MmAccountConfig.rfqSigner`. */
   rfqSigner: string;
   /** Unix seconds when the MM signed; must be recent ({@link MM_HELLO_AUTH_MAX_AGE_SECS}). */
   timestamp: number;
   /** Ed25519 signature over {@link encodeMmHelloAuthMessage} (base64, 64 bytes). */
   signature: string;
};

export type RfqWsServerMessage =
   | RfqWsHelloAckMessage
   | RfqWsRequestMessage
   | RfqWsCashoutRequestMessage;
export type RfqWsClientMessage =
   | RfqWsHelloMessage
   | RfqWsQuoteMessage
   | RfqWsCashoutQuoteMessage;

/** Domain tag for MM WebSocket hello auth signatures. */
export const MM_HELLO_AUTH_DOMAIN = 'spamm.rfq.mm.hello.v1';

/** Max |now − timestamp| (seconds) accepted for `mm.hello`. */
export const MM_HELLO_AUTH_MAX_AGE_SECS = 60;

/**
 * Canonical bytes the MM `rfqSigner` keypair must sign for `mm.hello`.
 * Format (UTF-8 lines): domain, mmProgramId, rfqSigner, timestamp.
 */
export function encodeMmHelloAuthMessage(input: {
   mmProgramId: string;
   rfqSigner: string;
   timestamp: number;
}): Uint8Array {
   if (!Number.isInteger(input.timestamp) || input.timestamp < 0) {
      throw new RangeError('timestamp must be a non-negative integer (unix seconds)');
   }
   address(input.mmProgramId);
   address(input.rfqSigner);
   return new TextEncoder().encode(
      `${MM_HELLO_AUTH_DOMAIN}\n${input.mmProgramId}\n${input.rfqSigner}\n${input.timestamp}`,
   );
}

function bytesToBase64(bytes: Uint8Array): string {
   let binary = '';
   for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
   }
   return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
   const binary = atob(base64);
   const out = new Uint8Array(binary.length);
   for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
   }
   return out;
}

export function encodeRfqSignatureBase64(signature: Uint8Array): string {
   if (signature.length !== RFQ_SIGNATURE_LEN) {
      throw new RangeError(`RFQ signature length ${signature.length}; expected ${RFQ_SIGNATURE_LEN}`);
   }
   return bytesToBase64(signature);
}

export function decodeRfqSignatureBase64(signatureBase64: string): Uint8Array {
   const out = base64ToBytes(signatureBase64);
   if (out.length !== RFQ_SIGNATURE_LEN) {
      throw new RangeError(`RFQ signature length ${out.length}; expected ${RFQ_SIGNATURE_LEN}`);
   }
   return out;
}

export function marketIdToJson(marketId: MarketId): MarketIdJson {
   return {
      eventId: {
         event: marketId.eventId.event.toString(),
         league: marketId.eventId.league,
         sport: marketId.eventId.sport,
      },
      player: marketId.player.toString(),
      mkt: marketId.mkt,
      period: marketId.period,
      isPregame: marketId.isPregame,
      operator: marketId.operator,
   };
}

export function marketIdFromJson(json: MarketIdJson): MarketId {
   return {
      eventId: {
         event: BigInt(json.eventId.event),
         league: json.eventId.league,
         sport: json.eventId.sport,
      },
      player: BigInt(json.player),
      mkt: json.mkt,
      period: json.period,
      isPregame: json.isPregame,
      operator: address(json.operator),
   };
}

function isRecord(v: unknown): v is Record<string, unknown> {
   return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): string {
   const v = obj[key];
   if (typeof v !== 'string' || v.length === 0) {
      throw new RangeError(`missing/invalid string field: ${key}`);
   }
   return v;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
   const v = obj[key];
   if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new RangeError(`missing/invalid number field: ${key}`);
   }
   return v;
}

function parseMarketIdJson(raw: unknown, label: string): MarketIdJson {
   if (!isRecord(raw)) {
      throw new RangeError(`${label}: marketId must be an object`);
   }
   if (!isRecord(raw.eventId)) {
      throw new RangeError(`${label}: marketId.eventId must be an object`);
   }
   const eventId = raw.eventId;
   return {
      eventId: {
         event: requireString(eventId, 'event'),
         league: requireNumber(eventId, 'league'),
         sport: requireNumber(eventId, 'sport'),
      },
      player: requireString(raw, 'player'),
      mkt: requireNumber(raw, 'mkt'),
      period: requireNumber(raw, 'period'),
      isPregame: raw.isPregame === true,
      operator: requireString(raw, 'operator'),
   };
}

function parseEventGameState(raw: unknown, label: string): EventGameState {
   if (!isRecord(raw)) {
      throw new RangeError(`${label}: eventGameState must be an object`);
   }
   const gamePhase = requireString(raw, 'gamePhase');
   return {
      gamePhase,
      homePrimary: requireNumber(raw, 'homePrimary'),
      awayPrimary: requireNumber(raw, 'awayPrimary'),
      homeSecondary: requireNumber(raw, 'homeSecondary'),
      awaySecondary: requireNumber(raw, 'awaySecondary'),
   };
}

function parseSelectionJson(raw: unknown, index: number): RfqSelectionJson {
   if (!isRecord(raw)) {
      throw new RangeError(`selections[${index}] must be an object`);
   }
   return {
      marketId: parseMarketIdJson(raw.marketId, `selections[${index}]`),
      side: requireNumber(raw, 'side'),
      eventStateSequence: requireNumber(raw, 'eventStateSequence'),
      eventGameState: parseEventGameState(raw.eventGameState, `selections[${index}]`),
   };
}

/** Parse + validate `POST /api/rfq` JSON body. */
export function parseRfqHttpRequestJson(raw: unknown): RfqHttpRequestJson {
   if (!isRecord(raw)) {
      throw new RangeError('RFQ body must be a JSON object');
   }
   const selectionsRaw = raw.selections;
   if (!Array.isArray(selectionsRaw) || selectionsRaw.length === 0) {
      throw new RangeError('selections must be a non-empty array');
   }
   if (selectionsRaw.length > MAX_RFQ_PARLAY_LEGS) {
      throw new RangeError(`selections.length must be <= ${MAX_RFQ_PARLAY_LEGS}`);
   }
   const selections = selectionsRaw.map(parseSelectionJson);
   // Touch-parse addresses / bigints early so bad input fails before fan-out.
   address(requireString(raw, 'user'));
   BigInt(requireString(raw, 'betId'));
   BigInt(requireString(raw, 'amount'));
   for (const sel of selections) {
      marketIdFromJson(sel.marketId);
   }
   return {
      user: requireString(raw, 'user'),
      betId: requireString(raw, 'betId'),
      amount: requireString(raw, 'amount'),
      selections,
   };
}

/** Parse MM `rfq.quote` WS message; throws on malformed payloads. */
export function parseRfqWsQuoteMessage(raw: unknown): RfqWsQuoteMessage {
   if (!isRecord(raw) || raw.type !== 'rfq.quote') {
      throw new RangeError('expected type rfq.quote');
   }
   const mmProgramId = requireString(raw, 'mmProgramId');
   address(mmProgramId);
   decodeRfqSignatureBase64(requireString(raw, 'signature'));
   BigInt(requireString(raw, 'maxStake'));
   BigInt(requireString(raw, 'oddsScaled'));
   const offerExpiry = requireNumber(raw, 'offerExpiry');
   if (!Number.isInteger(offerExpiry) || offerExpiry < 0) {
      throw new RangeError('offerExpiry must be a non-negative integer (unix seconds)');
   }
   if (!Array.isArray(raw.legOddsScaled) || raw.legOddsScaled.length === 0) {
      throw new RangeError('legOddsScaled must be a non-empty string array');
   }
   const legOddsScaled = raw.legOddsScaled.map((v, i) => {
      if (typeof v !== 'string') {
         throw new RangeError(`legOddsScaled[${i}] must be a string`);
      }
      BigInt(v);
      return v;
   });
   return {
      type: 'rfq.quote',
      requestId: requireString(raw, 'requestId'),
      mmProgramId,
      maxStake: requireString(raw, 'maxStake'),
      oddsScaled: requireString(raw, 'oddsScaled'),
      offerExpiry,
      signature: requireString(raw, 'signature'),
      legOddsScaled,
   };
}

export function parseRfqWsHelloMessage(raw: unknown): RfqWsHelloMessage {
   if (!isRecord(raw) || raw.type !== 'mm.hello') {
      throw new RangeError('expected type mm.hello');
   }
   const mmProgramId = requireString(raw, 'mmProgramId');
   const rfqSigner = requireString(raw, 'rfqSigner');
   address(mmProgramId);
   address(rfqSigner);
   const timestamp = requireNumber(raw, 'timestamp');
   if (!Number.isInteger(timestamp) || timestamp < 0) {
      throw new RangeError('timestamp must be a non-negative integer (unix seconds)');
   }
   decodeRfqSignatureBase64(requireString(raw, 'signature'));
   return {
      type: 'mm.hello',
      mmProgramId,
      rfqSigner,
      timestamp,
      signature: requireString(raw, 'signature'),
   };
}

/** Build the WS fan-out message from a validated HTTP request. */
export function buildRfqWsRequestMessage(
   requestId: string,
   body: RfqHttpRequestJson,
): RfqWsRequestMessage {
   return {
      type: 'rfq.request',
      requestId,
      user: body.user,
      betId: body.betId,
      amount: body.amount,
      selections: body.selections,
   };
}

export function quoteJsonFromWsMessage(msg: RfqWsQuoteMessage): RfqQuoteJson {
   return {
      mmProgramId: msg.mmProgramId,
      maxStake: msg.maxStake,
      oddsScaled: msg.oddsScaled,
      offerExpiry: msg.offerExpiry,
      signature: msg.signature,
      legOddsScaled: msg.legOddsScaled,
   };
}

function parseCashoutSnapshotJson(raw: unknown, index: number): RfqCashoutSnapshotJson {
   if (!isRecord(raw)) {
      throw new RangeError(`snapshots[${index}] must be an object`);
   }
   return {
      eventStateSequence: requireNumber(raw, 'eventStateSequence'),
      eventGameState: parseEventGameState(raw.eventGameState, `snapshots[${index}]`),
   };
}

/** Parse + validate `POST /api/rfq/cashout` JSON body. */
export function parseRfqCashoutHttpRequestJson(raw: unknown): RfqCashoutHttpRequestJson {
   if (!isRecord(raw)) {
      throw new RangeError('RFQ cashout body must be a JSON object');
   }
   const snapshotsRaw = raw.snapshots;
   if (!Array.isArray(snapshotsRaw) || snapshotsRaw.length === 0) {
      throw new RangeError('snapshots must be a non-empty array');
   }
   if (snapshotsRaw.length > MAX_RFQ_PARLAY_LEGS) {
      throw new RangeError(`snapshots.length must be <= ${MAX_RFQ_PARLAY_LEGS}`);
   }
   const snapshots = snapshotsRaw.map(parseCashoutSnapshotJson);
   address(requireString(raw, 'user'));
   BigInt(requireString(raw, 'origBetId'));
   BigInt(requireString(raw, 'cashoutId'));
   BigInt(requireString(raw, 'amount'));
   BigInt(requireString(raw, 'minPayout'));
   let marketId: MarketIdJson | undefined;
   if (raw.marketId !== undefined) {
      marketId = parseMarketIdJson(raw.marketId, 'marketId');
      marketIdFromJson(marketId);
   }
   const side = raw.side === undefined ? undefined : requireNumber(raw, 'side');
   return {
      user: requireString(raw, 'user'),
      origBetId: requireString(raw, 'origBetId'),
      cashoutId: requireString(raw, 'cashoutId'),
      amount: requireString(raw, 'amount'),
      minPayout: requireString(raw, 'minPayout'),
      snapshots,
      marketId,
      side,
   };
}

/** Parse MM `rfq.cashout.quote` WS message; throws on malformed payloads. */
export function parseRfqWsCashoutQuoteMessage(raw: unknown): RfqWsCashoutQuoteMessage {
   if (!isRecord(raw) || raw.type !== 'rfq.cashout.quote') {
      throw new RangeError('expected type rfq.cashout.quote');
   }
   const mmProgramId = requireString(raw, 'mmProgramId');
   address(mmProgramId);
   decodeRfqSignatureBase64(requireString(raw, 'signature'));
   BigInt(requireString(raw, 'maxPayment'));
   const offerExpiry = requireNumber(raw, 'offerExpiry');
   if (!Number.isInteger(offerExpiry) || offerExpiry < 0) {
      throw new RangeError('offerExpiry must be a non-negative integer (unix seconds)');
   }
   return {
      type: 'rfq.cashout.quote',
      requestId: requireString(raw, 'requestId'),
      mmProgramId,
      maxPayment: requireString(raw, 'maxPayment'),
      offerExpiry,
      signature: requireString(raw, 'signature'),
   };
}

export function cashoutWsRequestFromHttp(
   requestId: string,
   body: RfqCashoutHttpRequestJson,
): RfqWsCashoutRequestMessage {
   return {
      type: 'rfq.cashout.request',
      requestId,
      user: body.user,
      origBetId: body.origBetId,
      cashoutId: body.cashoutId,
      amount: body.amount,
      minPayout: body.minPayout,
      snapshots: body.snapshots,
      marketId: body.marketId,
      side: body.side,
   };
}

export function cashoutQuoteJsonFromWsMessage(msg: RfqWsCashoutQuoteMessage): RfqCashoutQuoteJson {
   return {
      mmProgramId: msg.mmProgramId,
      maxPayment: msg.maxPayment,
      offerExpiry: msg.offerExpiry,
      signature: msg.signature,
   };
}

/** Typed `mmProgramId` helper for callers that already validated the string. */
export function asAddress(value: string): Address {
   return address(value);
}
