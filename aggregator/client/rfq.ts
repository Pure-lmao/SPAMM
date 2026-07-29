/**
 * RFQ test helpers: MM signs a quote off-chain, user builds/sends `fill_rfq_*`.
 *
 * Flow:
 *   1. `makeSignedRfqBetFill` / `makeSignedRfqParlayFill` — RFQ signer produces Fill*IxData
 *   2. `placeRfqBet` / `placeRfqParlay` — user turns that into an ix and sim/sends
 *
 * The RFQ signer pubkey must match `MmAccountConfig.rfqSigner` for the MM program.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address, KeyPairSigner } from '@solana/kit';
import {
   BetResult,
   getEventGameState,
   getFillRfqBetIx,
   getFillRfqParlayIx,
   getMmAccountConfigData,
   makeSignedRfqBetFill,
   makeSignedRfqParlayFill,
   ODDS_SCALE,
   type FillRfqBetIxData,
   type FillRfqParlayIxData,
   type ParlayLegWire,
   type Sport,
} from 'spamm-aggregator-sdk';

import { createRpcClients, sendAndConfirmInstructions, simulateTransaction } from './txSend.ts';
import { loadKeypairSignerFromJsonFile } from './utils.ts';
import { USER_SIGNER } from './user.ts';
import { ADMIN_SIGNER } from './admin.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clients = createRpcClients();

/** MM program that will fill the RFQ (must have `rfqSigner` set on its config PDA). */
const DumbMarketMaker = 'DUMBu4faqgx9KJWKAp8xRzKMiHEcBUvuH7pMkvMneMTt' as Address;

/**
 * Keypair whose pubkey is stored as MM `rfqSigner`.
 * Create with: `solana-keygen new -o rfq_signer_keypair.json --no-bip39-passphrase`
 * then set on-chain via MM `set_rfq_signer` if needed.
 */
export const RFQ_SIGNER: KeyPairSigner = await loadKeypairSignerFromJsonFile(
   path.join(__dirname, 'rfq_signer_keypair.json'),
);

const betId = 21n;
const sport = 1 as Sport;
const marketId = {
   eventId: {
      event: 1n,
      league: 1,
      sport,
   },
   mkt: 1,
   period: 1,
   isPregame: true,
   player: 0n,
   operator: "BqQKZKbnYMpmQEtoCjvaDVTdhfpbaCQuBiSngNKu6YQW" as Address,
};
const marketId2 = {
   eventId: {
      event: 2n,
      league: 1,
      sport,
   },
   mkt: 1,
   period: 1,
   isPregame: true,
   player: 0n,
   operator: "BqQKZKbnYMpmQEtoCjvaDVTdhfpbaCQuBiSngNKu6YQW" as Address,
};
const side = 0;
const eventStateSequence = 1;
const eventGameState = getEventGameState('PG', 0, 0, 0, 0);
const amount = 5n * 10n ** 6n;
const maxStake = 50n * 10n ** 6n;
const oddsScaled = 20_000n; // 2.0x
/** Unix seconds; far future for manual testing. */
const offerExpiry = Math.floor(Date.now() / 1000) + 3600;

const legOdds = 20_000n;

/** Product of per-leg odds / ODDS_SCALE^(n-1), matching on-chain `ensure_parlay_odds_product_matches`. */
function combinedParlayOdds(legOddsScaled: bigint, numLegs: number): bigint {
   let p = ODDS_SCALE;
   for (let i = 0; i < numLegs; i++) {
      p = (p * legOddsScaled) / ODDS_SCALE;
   }
   return p;
}

const legs: ParlayLegWire[] = [
   {
      marketId,
      side: 0,
      eventStateSequence,
      eventGameState,
      oddsScaled: legOdds,
      result: BetResult.Pending,
   },
   {
      marketId: marketId2,
      side: 0,
      eventStateSequence,
      eventGameState,
      oddsScaled: legOdds,
      result: BetResult.Pending,
   },
];

/** Confirm local RFQ signer matches on-chain MM config (throws if mismatch / missing). */
export async function assertRfqSignerMatchesMm(mmProgram: Address = DumbMarketMaker): Promise<void> {
   const cfg = await getMmAccountConfigData(clients.rpc, mmProgram);
   if (cfg.rfqSigner !== RFQ_SIGNER.address) {
      throw new Error(
         `RFQ signer mismatch: keypair=${RFQ_SIGNER.address} on-chain=${cfg.rfqSigner} (mm=${mmProgram})`,
      );
   }
   console.log('rfqSigner ok:', cfg.rfqSigner);
}

/**
 * MM-side: encode + ed25519-sign an RFQ bet quote, return fill ix body ready for the user.
 */
export async function makeSignedBetQuote(params?: {
   user?: Address;
   betId?: bigint;
   amount?: bigint;
   maxStake?: bigint;
   oddsScaled?: bigint;
   offerExpiry?: number;
   mmProgram?: Address;
}): Promise<FillRfqBetIxData> {
   const mmProgram = params?.mmProgram ?? DumbMarketMaker;
   return makeSignedRfqBetFill(RFQ_SIGNER, {
      user: params?.user ?? USER_SIGNER.address,
      betId: params?.betId ?? betId,
      marketId,
      eventGameState,
      eventStateSequence,
      side,
      maxStake: params?.maxStake ?? maxStake,
      oddsScaled: params?.oddsScaled ?? oddsScaled,
      offerExpiry: params?.offerExpiry ?? offerExpiry,
      mmProgramId: mmProgram,
      amount: params?.amount ?? amount,
   });
}

/**
 * MM-side: encode + ed25519-sign an RFQ parlay quote.
 * Combined `oddsScaled` should match the product of per-leg odds (scaled).
 */
export async function makeSignedParlayQuote(params?: {
   user?: Address;
   betId?: bigint;
   amount?: bigint;
   maxStake?: bigint;
   oddsScaled?: bigint;
   offerExpiry?: number;
   mmProgram?: Address;
}): Promise<FillRfqParlayIxData> {
   const mmProgram = params?.mmProgram ?? DumbMarketMaker;
   const combinedOdds = params?.oddsScaled ?? combinedParlayOdds(legOdds, legs.length);
   return makeSignedRfqParlayFill(RFQ_SIGNER, {
      user: params?.user ?? USER_SIGNER.address,
      betId: params?.betId ?? betId,
      numLegs: legs.length,
      legs,
      maxStake: params?.maxStake ?? maxStake,
      oddsScaled: combinedOdds,
      offerExpiry: params?.offerExpiry ?? offerExpiry,
      mmProgramId: mmProgram,
      amount: params?.amount ?? amount,
   });
}

/** User-side: build `fill_rfq_bet` from a signed quote and simulate (or send). */
export async function placeRfqBet(
   fill: FillRfqBetIxData,
   mmProgram: Address = DumbMarketMaker,
   opts?: { send?: boolean; useALT?: boolean },
) {
   const ix = await getFillRfqBetIx(fill, USER_SIGNER.address, USER_SIGNER.address, mmProgram);
   // console.log('fill_rfq_bet ix:', ix);
   if (opts?.send) {
      const sig = await sendAndConfirmInstructions([ix], [USER_SIGNER], opts.useALT ?? false);
      console.log('fill_rfq_bet signature:', sig);
      return sig;
   }
   const sim = await simulateTransaction(clients.rpc, [ix], [USER_SIGNER], opts?.useALT ?? false);
   console.log('fill_rfq_bet sim returnData:', sim);
   return sim;
}

/** User-side: build `fill_rfq_parlay` from a signed quote and simulate (or send). */
export async function placeRfqParlay(
   fill: FillRfqParlayIxData,
   mmProgram: Address = DumbMarketMaker,
   opts?: { send?: boolean; useALT?: boolean },
) {
   const ix = await getFillRfqParlayIx(fill, USER_SIGNER.address, USER_SIGNER.address, mmProgram);
   if (opts?.send) {
      const sig = await sendAndConfirmInstructions([ix], [USER_SIGNER], opts.useALT ?? false);
      console.log('fill_rfq_parlay signature:', sig);
      return sig;
   }
   const sim = await simulateTransaction(clients.rpc, [ix], [USER_SIGNER], opts?.useALT ?? false);
   console.log('fill_rfq_parlay sim returnData:', sim);
   return sim;
}

/** End-to-end: sign as MM, then place as user (sim by default). */
async function signAndPlaceRfqBet(send = false) {
   await assertRfqSignerMatchesMm();
   const fill = await makeSignedBetQuote();
   console.log('signed fill:', {
      betId: fill.betId,
      amount: fill.amount,
      maxStake: fill.maxStake,
      oddsScaled: fill.oddsScaled,
      offerExpiry: fill.offerExpiry,
      signature: Buffer.from(fill.signature).toString('base64'),
   });
   await placeRfqBet(fill, DumbMarketMaker, { send, useALT: true });
}

async function signAndPlaceRfqParlay(send = false) {
   await assertRfqSignerMatchesMm();
   const fill = await makeSignedParlayQuote();
   console.log('signed parlay fill:', {
      betId: fill.betId,
      amount: fill.amount,
      maxStake: fill.maxStake,
      oddsScaled: fill.oddsScaled,
      offerExpiry: fill.offerExpiry,
      numLegs: fill.numLegs,
      signature: Buffer.from(fill.signature).toString('base64'),
   });
   await placeRfqParlay(fill, DumbMarketMaker, { send, useALT: true });
}

// Uncomment to run:
// assertRfqSignerMatchesMm().catch(console.error);
// signAndPlaceRfqBet(false).catch(console.error);
// signAndPlaceRfqParlay(false).catch(console.error);
