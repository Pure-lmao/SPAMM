/**
 * Off-chain RFQ quote signing (ed25519 over canonical message bytes).
 *
 * On-chain verify uses brine-ed25519 against `MmAccountConfig.rfq_signer`.
 */

import {
   createSignableMessage,
   getPublicKeyFromAddress,
   signatureBytes,
   verifySignature,
   type Address,
   type Instruction,
   type MessagePartialSigner,
} from '@solana/kit';

import {
   encodeRfqBetMessageBytes,
   encodeRfqParlayMessageBytes,
} from './codex.js';
import { RFQ_NETWORK_DOMAIN } from './constants.js';
import { getFillRfqBetIx, getFillRfqParlayIx } from './instructions.js';
import {
   decodeRfqSignatureBase64,
   encodeMmHelloAuthMessage,
   encodeRfqSignatureBase64,
   marketIdFromJson,
   type RfqHttpRequestJson,
   type RfqQuoteJson,
   type RfqWsHelloMessage,
} from './rfq_api.js';
import {
   BetResult,
   RFQ_SIGNATURE_LEN,
   type FillRfqBetIxData,
   type FillRfqParlayIxData,
   type ParlayLegWire,
   type RfqBetMessageInput,
   type RfqParlayMessageInput,
} from './types.js';
import { validateOfferExpiry, validateFillRfqBetIxData, validateFillRfqParlayIxData } from './validate.js';

export type SignedRfqBetQuote = Readonly<{
   message: Uint8Array;
   signature: Uint8Array;
   /** Fields needed for {@link FillRfqBetIxData} except `amount` / `signature`. */
   offer: Omit<RfqBetMessageInput, 'mmProgramId'>;
   mmProgramId: Address;
}>;

export type SignedRfqParlayQuote = Readonly<{
   message: Uint8Array;
   signature: Uint8Array;
   offer: Omit<RfqParlayMessageInput, 'mmProgramId'>;
   mmProgramId: Address;
}>;

/** Discriminated fill payload produced from an HTTP request + MM quote (ready for {@link getFillRfqIxFromData}). */
export type RfqFillIxFromQuote =
   | { kind: 'fillRfqBet'; data: FillRfqBetIxData; mmProgram: Address }
   | { kind: 'fillRfqParlay'; data: FillRfqParlayIxData; mmProgram: Address };

/** Verify an ed25519 signature for a Solana address (raw message bytes, no off-chain envelope). */
export async function verifyEd25519SignatureForAddress(
   signer: Address,
   signature: Uint8Array,
   message: Uint8Array,
): Promise<boolean> {
   if (signature.length !== RFQ_SIGNATURE_LEN) {
      return false;
   }
   const publicKey = await getPublicKeyFromAddress(signer);
   return verifySignature(publicKey, signatureBytes(signature), message);
}

/** Sign raw RFQ message bytes with the MM `rfq_signer` keypair. */
export async function signRfqMessageBytes(
   rfqSigner: MessagePartialSigner,
   message: Uint8Array,
): Promise<Uint8Array> {
   const [signatures] = await rfqSigner.signMessages([createSignableMessage(message)]);
   const signature = signatures?.[rfqSigner.address];
   if (signature == null) {
      throw new Error(`RFQ signer ${rfqSigner.address} did not return a signature`);
   }
   const out = new Uint8Array(signature);
   if (out.length !== RFQ_SIGNATURE_LEN) {
      throw new RangeError(`RFQ signature length ${out.length}; expected ${RFQ_SIGNATURE_LEN}`);
   }
   return out;
}

/**
 * Build a signed `mm.hello` payload for MM WebSocket auth.
 * `rfqSigner.address` is used as the claimed RFQ pubkey.
 * Defaults `timestamp` to now (unix seconds).
 */
export async function signMmHelloAuth(
   rfqSigner: MessagePartialSigner,
   input: {
      mmProgramId: string;
      timestamp?: number;
   },
): Promise<RfqWsHelloMessage> {
   const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
   const message = encodeMmHelloAuthMessage({
      mmProgramId: input.mmProgramId,
      rfqSigner: rfqSigner.address,
      timestamp,
   });
   const signature = await signRfqMessageBytes(rfqSigner, message);
   return {
      type: 'mm.hello',
      mmProgramId: input.mmProgramId,
      rfqSigner: rfqSigner.address,
      timestamp,
      signature: encodeRfqSignatureBase64(signature),
   };
}

/** Verify a parsed `mm.hello` signature against the claimed `rfqSigner`. */
export async function verifyMmHelloAuth(hello: RfqWsHelloMessage): Promise<boolean> {
   const message = encodeMmHelloAuthMessage({
      mmProgramId: hello.mmProgramId,
      rfqSigner: hello.rfqSigner,
      timestamp: hello.timestamp,
   });
   return verifyEd25519SignatureForAddress(
      hello.rfqSigner as Address,
      decodeRfqSignatureBase64(hello.signature),
      message,
   );
}

/** Encode + sign a single-bet RFQ quote. */
export async function signRfqBetQuote(
   rfqSigner: MessagePartialSigner,
   input: Omit<RfqBetMessageInput, 'networkDomain'> & Partial<Pick<RfqBetMessageInput, 'networkDomain'>>,
): Promise<SignedRfqBetQuote> {
   const fullInput: RfqBetMessageInput = { networkDomain: RFQ_NETWORK_DOMAIN, ...input };
   const message = encodeRfqBetMessageBytes(fullInput);
   const signature = await signRfqMessageBytes(rfqSigner, message);
   const { mmProgramId, ...offer } = fullInput;
   return { message, signature, offer, mmProgramId };
}

/** Encode + sign a parlay RFQ quote. */
export async function signRfqParlayQuote(
   rfqSigner: MessagePartialSigner,
   input: Omit<RfqParlayMessageInput, 'networkDomain'> & Partial<Pick<RfqParlayMessageInput, 'networkDomain'>>,
): Promise<SignedRfqParlayQuote> {
   const fullInput: RfqParlayMessageInput = { networkDomain: RFQ_NETWORK_DOMAIN, ...input };
   const message = encodeRfqParlayMessageBytes(fullInput);
   const signature = await signRfqMessageBytes(rfqSigner, message);
   const { mmProgramId, ...offer } = fullInput;
   return { message, signature, offer, mmProgramId };
}

/** Combine a signed single-bet RFQ offer with the user's fill `amount`. */
export function signedRfqBetToFillIxData(
   quote: SignedRfqBetQuote,
   amount: bigint,
): FillRfqBetIxData {
   return {
      betId: quote.offer.betId,
      marketId: quote.offer.marketId,
      side: quote.offer.side,
      amount,
      eventStateSequence: quote.offer.eventStateSequence,
      eventGameState: quote.offer.eventGameState,
      maxStake: quote.offer.maxStake,
      oddsScaled: quote.offer.oddsScaled,
      offerExpiry: quote.offer.offerExpiry,
      signature: quote.signature,
   };
}

/** Combine a signed parlay RFQ offer with the user's fill `amount`. */
export function signedRfqParlayToFillIxData(
   quote: SignedRfqParlayQuote,
   amount: bigint,
): FillRfqParlayIxData {
   return {
      betId: quote.offer.betId,
      amount,
      numLegs: quote.offer.numLegs,
      legs: quote.offer.legs,
      maxStake: quote.offer.maxStake,
      oddsScaled: quote.offer.oddsScaled,
      offerExpiry: quote.offer.offerExpiry,
      signature: quote.signature,
   };
}

/**
 * One-shot: sign a single-bet RFQ quote and produce ready-to-send {@link FillRfqBetIxData}.
 * `amount` must be `<= maxStake`.
 */
export async function makeSignedRfqBetFill(
   rfqSigner: MessagePartialSigner,
   input: Omit<RfqBetMessageInput, 'networkDomain'> &
      Partial<Pick<RfqBetMessageInput, 'networkDomain'>> & { amount: bigint },
): Promise<FillRfqBetIxData> {
   const { amount, ...offer } = input;
   const quote = await signRfqBetQuote(rfqSigner, offer);
   return signedRfqBetToFillIxData(quote, amount);
}

/**
 * One-shot: sign a parlay RFQ quote and produce ready-to-send {@link FillRfqParlayIxData}.
 * `amount` must be `<= maxStake`.
 */
export async function makeSignedRfqParlayFill(
   rfqSigner: MessagePartialSigner,
   input: Omit<RfqParlayMessageInput, 'networkDomain'> &
      Partial<Pick<RfqParlayMessageInput, 'networkDomain'>> & { amount: bigint },
): Promise<FillRfqParlayIxData> {
   const { amount, ...offer } = input;
   const quote = await signRfqParlayQuote(rfqSigner, offer);
   return signedRfqParlayToFillIxData(quote, amount);
}

/**
 * Assemble {@link FillRfqBetIxData} / {@link FillRfqParlayIxData} from a POST `/api/rfq` request + quote.
 * Validates `amount <= maxStake`, offer expiry, and `legOddsScaled.length === selections.length`.
 */
export function rfqRequestAndQuoteToFillIxData(
   request: RfqHttpRequestJson,
   quote: RfqQuoteJson,
   nowUnixSecs?: number,
): RfqFillIxFromQuote {
   const amount = BigInt(request.amount);
   const maxStake = BigInt(quote.maxStake);
   const oddsScaled = BigInt(quote.oddsScaled);
   if (amount === 0n) {
      throw new RangeError('amount must be > 0');
   }
   if (amount > maxStake) {
      throw new RangeError('amount must be <= quote.maxStake');
   }
   validateOfferExpiry(quote.offerExpiry, 'quote.offerExpiry', nowUnixSecs);
   if (quote.legOddsScaled.length !== request.selections.length) {
      throw new RangeError(
         `legOddsScaled.length (${quote.legOddsScaled.length}) must equal selections.length (${request.selections.length})`,
      );
   }

   const signature = decodeRfqSignatureBase64(quote.signature);
   const mmProgram = quote.mmProgramId as Address;
   const n = request.selections.length;

   if (n === 1) {
      const sel = request.selections[0]!;
      const data: FillRfqBetIxData = {
         betId: BigInt(request.betId),
         marketId: marketIdFromJson(sel.marketId),
         side: sel.side,
         amount,
         eventStateSequence: sel.eventStateSequence,
         eventGameState: sel.eventGameState,
         maxStake,
         oddsScaled,
         offerExpiry: quote.offerExpiry,
         signature,
      };
      validateFillRfqBetIxData(data, 'fillRfqBet', nowUnixSecs);
      return { kind: 'fillRfqBet', mmProgram, data };
   }

   if (n < 2) {
      throw new RangeError('selections must be non-empty');
   }

   const legs: ParlayLegWire[] = request.selections.map((sel, i) => ({
      marketId: marketIdFromJson(sel.marketId),
      side: sel.side,
      eventStateSequence: sel.eventStateSequence,
      eventGameState: sel.eventGameState,
      oddsScaled: BigInt(quote.legOddsScaled[i]!),
      result: BetResult.Pending,
   }));

   const data: FillRfqParlayIxData = {
      betId: BigInt(request.betId),
      amount,
      numLegs: n,
      legs,
      maxStake,
      oddsScaled,
      offerExpiry: quote.offerExpiry,
      signature,
   };
   validateFillRfqParlayIxData(data, 'fillRfqParlay', nowUnixSecs);
   return { kind: 'fillRfqParlay', mmProgram, data };
}

/**
 * Data → Instruction helper (same pattern as {@link getFillRfqBetIx} / {@link getFillRfqParlayIx}).
 */
export async function getFillRfqIxFromData(
   fill: RfqFillIxFromQuote,
   feepayer: Address,
   user: Address,
   mmNetting?: Address,
): Promise<Instruction> {
   if (fill.kind === 'fillRfqBet') {
      return getFillRfqBetIx(fill.data, feepayer, user, fill.mmProgram, mmNetting);
   }
   return getFillRfqParlayIx(fill.data, feepayer, user, fill.mmProgram);
}
