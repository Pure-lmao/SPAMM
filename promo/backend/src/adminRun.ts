/**
 * Promo MM admin — aggregator SDK PDAs + this repo's txSend pipeline.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddressEncoder, type Address, type Instruction, type KeyPairSigner } from '@solana/kit';
import { loadKeypairSignerFromJsonFile } from '../../../aggregator/client/utils.ts';
import {
   buildSignV0Transaction,
   createRpcClients,
   sendAndConfirmSignedTransaction,
   type RpcClients,
} from '../../../aggregator/client/txSend.ts';
import { getEventGameState, getRegisterMmIx, readAccountDataRaw, getAta, getEventStatePda, getMmConfigPda, getMmQuoteBufferPda, getMmParlayQuoteBufferPda } from './spammSdk';
import type { EventId, EventGameState, MarketId } from './spammSdk';
import { DEFAULT_MARKET_OPERATOR, PROMO_BOOTSTRAP_EVENT_SEQUENCE, PROMO_PROGRAM_ID } from './constants';
import { ORACLE_ACCOUNT_DISCRIMINATOR, PROMO_MKT, decodePromoConfigAccount } from './codex';
import {
   getCloseEventIx,
   getCloseMarketIx,
   getInitEventIx,
   getInitProgramIx,
   getPromoInitMarketIx,
   getPromoMarketDataPda,
   getPromoUpdateOracleIx,
   getPromoWriteArbitraryDataIx,
   getPromoForceClosePdaIx,
   getSetMarketMaxAmountIx,
   getSetMarketMaxTotalAmountIx,
   getUpdateEventStateIx,
   getUpdateStatusIx,
   getWithdrawFromTokenAccountIx,
   type PromoInitMarketPayload,
} from './instructions';
import {
   marketIdFromKeyParts,
   parseEventIdFromFlags,
   parseGameStateFromFlags,
   parseMarketKeyPartsFromFlags,
   type MarketKeyParts,
} from './marketKey';

export type SendAdminOptions = {
   dryRun?: boolean;
   groupId?: string;
};

export type PromoAdminContext = {
   programId: Address;
   signer: KeyPairSigner;
   rpcs: RpcClients;
};

const marketMakerDir = path.join(
   path.dirname(fileURLToPath(import.meta.url)),
   '../../../market_maker',
);

async function loadPromoAdminSigner(): Promise<KeyPairSigner> {
   return loadKeypairSignerFromJsonFile(
      path.join(marketMakerDir, 'client/admin_keypair.json'),
   );
}

export async function createPromoAdminContext(): Promise<PromoAdminContext> {
   const signer = await loadPromoAdminSigner();
   const httpUrl = process.env.HELIUS_RPC_URL ?? process.env.CHAINSTACK_RPC_URL;
   return {
      programId: PROMO_PROGRAM_ID,
      signer,
      rpcs: createRpcClients(httpUrl != null ? { httpUrl } : undefined),
   };
}

export {
   parseEventIdFromFlags,
   parseGameStateFromFlags,
   parseMarketKeyPartsFromFlags,
};

export type { MarketKeyParts };

export async function sendAdminInstructions(
   ctx: PromoAdminContext,
   groupId: string,
   build: () => Promise<{ id: string; instruction: Instruction }[]>,
   options?: SendAdminOptions,
): Promise<string | undefined> {
   const ixs = await build();
   const label = options?.groupId ?? groupId;
   if (ixs.length === 0) {
      console.log(`[${label}] no instructions`);
      return undefined;
   }
   if (options?.dryRun) {
      console.log(`[dry-run] ${label}: ${ixs.map((i) => i.id).join(', ')}`);
      return undefined;
   }
   try {
      const signedTransaction = await buildSignV0Transaction(ctx.rpcs.rpc, {
         feePayer: ctx.signer,
         instructions: ixs.map((i) => i.instruction),
         signers: [ctx.signer],
      });
      const sig = await sendAndConfirmSignedTransaction(ctx.rpcs, signedTransaction);
      console.log(`[${label}] ${sig}`);
      return sig;
   } catch (error) {
      console.error(
         `[${label}] send failed; signer=${ctx.signer.address} program=${ctx.programId} ixs=${ixs
            .map((i) => `${i.id}:${i.instruction.programAddress}`)
            .join(',')}`,
      );
      throw error;
   }
}

export async function assertPromoConfigAdminSigner(ctx: PromoAdminContext): Promise<void> {
   const [configPda] = await getMmConfigPda(ctx.programId);
   const raw = await readAccountDataRaw(ctx.rpcs.rpc, configPda);
   if (raw === null) {
      throw new Error('[promo-admin] config PDA missing — run promo MM setup / init-program first');
   }
   const config = decodePromoConfigAccount(raw);
   if (config.admin !== ctx.signer.address) {
      throw new Error(
         `[promo-admin] signer ${ctx.signer.address} does not match config.admin ${config.admin}. ` +
            'Sign with market_maker/client/admin_keypair.json.',
      );
   }
}

export async function promoConfigExists(ctx: PromoAdminContext): Promise<boolean> {
   const [configPda] = await getMmConfigPda(ctx.programId);
   return (await readAccountDataRaw(ctx.rpcs.rpc, configPda)) !== null;
}

/** Close `["mm_quote_buffer"]` and `["mm_parlay_quote_buffer"]` (ix 255). */
export async function runPromoForceCloseQuoteBuffers(
   ctx: PromoAdminContext,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   const [quoteBufferPda] = await getMmQuoteBufferPda(ctx.programId);
   const [parlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(ctx.programId);
   console.log(`[promo-force-close-quote-buffers] quote  ${quoteBufferPda}`);
   console.log(`[promo-force-close-quote-buffers] parlay ${parlayQuoteBufferPda}`);
   return sendAdminInstructions(
      ctx,
      options?.groupId ?? 'promo-force-close-quote-buffers',
      async () => [
         {
            id: 'promo-force-close-quote-buffer',
            instruction: await getPromoForceClosePdaIx(
               ctx.signer.address,
               ctx.programId,
               quoteBufferPda,
            ),
         },
         {
            id: 'promo-force-close-parlay-quote-buffer',
            instruction: await getPromoForceClosePdaIx(
               ctx.signer.address,
               ctx.programId,
               parlayQuoteBufferPda,
            ),
         },
      ],
      options,
   );
}

/** Grow config PDA to header+status and write `rfq_signer` = this admin key. */
export async function runPromoWriteConfigRfqSigner(
   ctx: PromoAdminContext,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   const [configPda] = await getMmConfigPda(ctx.programId);
   const raw = await readAccountDataRaw(ctx.rpcs.rpc, configPda);
   if (raw === null) {
      throw new Error('[promo-admin] config PDA missing');
   }
   const rfqBytes = new Uint8Array(getAddressEncoder().encode(ctx.signer.address));
   const payload = new Uint8Array(33);
   payload.set(rfqBytes, 0);
   payload[32] = raw.length >= 67 ? (raw[66]! !== 0 ? 1 : 0) : (raw[34]! !== 0 ? 1 : 0);

   return sendAdminInstructions(
      ctx,
      options?.groupId ?? 'promo-write-config-rfq-signer',
      async () => [
         {
            id: 'promo-write-config-rfq-signer',
            instruction: await getPromoWriteArbitraryDataIx(
               ctx.signer.address,
               ctx.programId,
               configPda,
               34,
               payload,
            ),
         },
      ],
      options,
   );
}

export async function runPromoInitProgram(
   ctx: PromoAdminContext,
   options?: SendAdminOptions,
) {
   return sendAdminInstructions(
      ctx,
      options?.groupId ?? 'promo-init-program',
      async () => [
         {
            id: 'promo-init-program',
            instruction: await getInitProgramIx(ctx.signer.address, ctx.programId),
         },
      ],
      options,
   );
}

export async function runPromoActivate(
   ctx: PromoAdminContext,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   return sendAdminInstructions(
      ctx,
      options?.groupId ?? 'promo-activate',
      async () => [
         {
            id: 'promo-activate',
            instruction: await getUpdateStatusIx(ctx.signer.address, ctx.programId, true),
         },
      ],
      options,
   );
}

export async function runPromoDeactivate(
   ctx: PromoAdminContext,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   return sendAdminInstructions(
      ctx,
      options?.groupId ?? 'promo-deactivate',
      async () => [
         {
            id: 'promo-deactivate',
            instruction: await getUpdateStatusIx(ctx.signer.address, ctx.programId, false),
         },
      ],
      options,
   );
}

export async function runPromoRegisterMm(
   ctx: PromoAdminContext,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   return sendAdminInstructions(
      ctx,
      options?.groupId ?? 'promo-register-mm',
      async () => [
         {
            id: 'promo-register-mm',
            instruction: await getRegisterMmIx(ctx.signer.address, ctx.programId),
         },
      ],
      options,
   );
}

export async function runPromoUpdateEventState(
   ctx: PromoAdminContext,
   eventId: EventId,
   sequence: number,
   gameState: EventGameState,
   options?: SendAdminOptions,
) {
   return sendAdminInstructions(
      ctx,
      options?.groupId ?? 'promo-update-event-state',
      async () => [
         {
            id: 'promo-update-event-state',
            instruction: await getUpdateEventStateIx(
               ctx.signer.address,
               ctx.programId,
               eventId,
               sequence,
               gameState,
            ),
         },
      ],
      options,
   );
}

export function assertPromoMarketParts(parts: MarketKeyParts): void {
   if (parts.mkt !== PROMO_MKT) {
      throw new Error(`promo markets require mkt=${PROMO_MKT} (got ${parts.mkt})`);
   }
}

export function defaultPromoBootstrapGameState(): EventGameState {
   return getEventGameState('PG', 0, 0, 0, 0);
}

export type PromoBootstrapMarketParams = {
   payload: PromoInitMarketPayload;
   odds0: bigint;
   odds1: bigint;
   odds2: bigint;
};

/**
 * One tx: init-event (if needed) → update-event-state → init-market (if needed) → set-odds.
 */
export async function runPromoBootstrapMarket(
   ctx: PromoAdminContext,
   params: PromoBootstrapMarketParams,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   const { payload, odds0, odds1, odds2 } = params;
   const eventSequence = PROMO_BOOTSTRAP_EVENT_SEQUENCE;
   const oracleSequence = Math.floor(Date.now() / 1000);
   const gameState = defaultPromoBootstrapGameState();
   const eventId = payload.marketId.eventId;
   const marketId = payload.marketId;

   const [eventPda] = await getEventStatePda(ctx.programId, eventId);
   const [marketPda] = await getPromoMarketDataPda(ctx.programId, marketId);
   const eventExists = (await readAccountDataRaw(ctx.rpcs.rpc, eventPda)) !== null;
   const marketExists = (await readAccountDataRaw(ctx.rpcs.rpc, marketPda)) !== null;

   return sendAdminInstructions(
      ctx,
      'promo-bootstrap-market',
      async () => {
         const ixs: { id: string; instruction: Instruction }[] = [];

         if (!eventExists) {
            ixs.push({
               id: 'promo-init-event',
               instruction: await getInitEventIx(ctx.signer.address, ctx.programId, eventId),
            });
         }

         ixs.push({
            id: 'promo-update-event-state',
            instruction: await getUpdateEventStateIx(
               ctx.signer.address,
               ctx.programId,
               eventId,
               eventSequence,
               gameState,
            ),
         });

         if (!marketExists) {
            ixs.push({
               id: 'promo-init-market',
               instruction: await getPromoInitMarketIx(
                  ctx.signer.address,
                  ctx.programId,
                  payload,
               ),
            });
         }

         ixs.push({
            id: 'promo-set-odds',
            instruction: await getPromoUpdateOracleIx(
               ctx.signer.address,
               ctx.programId,
               marketId,
               BigInt(oracleSequence),
               odds0,
               odds1,
               odds2,
            ),
         });

         return ixs;
      },
      options,
   );
}

export async function runPromoInitMarket(
   ctx: PromoAdminContext,
   payload: PromoInitMarketPayload,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   return sendAdminInstructions(
      ctx,
      'promo-init-market',
      async () => [
         {
            id: 'promo-init-market',
            instruction: await getPromoInitMarketIx(
               ctx.signer.address,
               ctx.programId,
               payload,
            ),
         },
      ],
      options,
   );
}

export async function runSetMarketMaxAmount(
   ctx: PromoAdminContext,
   marketId: PromoInitMarketPayload['marketId'],
   maxAmount: bigint,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   return sendAdminInstructions(
      ctx,
      'promo-set-max-amount',
      async () => [
         {
            id: 'promo-set-max-amount',
            instruction: await getSetMarketMaxAmountIx(
               ctx.signer.address,
               ctx.programId,
               marketId,
               maxAmount,
            ),
         },
      ],
      options,
   );
}

export async function runSetMarketMaxTotalAmount(
   ctx: PromoAdminContext,
   marketId: PromoInitMarketPayload['marketId'],
   maxTotalAmount: bigint,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   return sendAdminInstructions(
      ctx,
      'promo-set-max-total-amount',
      async () => [
         {
            id: 'promo-set-max-total-amount',
            instruction: await getSetMarketMaxTotalAmountIx(
               ctx.signer.address,
               ctx.programId,
               marketId,
               maxTotalAmount,
            ),
         },
      ],
      options,
   );
}

export async function runPromoUpdateOracle(
   ctx: PromoAdminContext,
   marketId: PromoInitMarketPayload['marketId'],
   sequence: bigint,
   odds0: bigint,
   odds1: bigint,
   odds2: bigint,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   return sendAdminInstructions(
      ctx,
      'promo-update-oracle',
      async () => [
         {
            id: 'promo-update-oracle',
            instruction: await getPromoUpdateOracleIx(
               ctx.signer.address,
               ctx.programId,
               marketId,
               sequence,
               odds0,
               odds1,
               odds2,
            ),
         },
      ],
      options,
   );
}

/** Patch oracle header: zero seq/odds region (bytes 2–17), then disc, bump, sequence. */
export async function runPromoRepairOracleHeader(
   ctx: PromoAdminContext,
   marketId: MarketId,
   sequence: number,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   const [marketPda, bump] = await getPromoMarketDataPda(ctx.programId, marketId);
   const clearDoppler = new Uint8Array(16);
   const header = new Uint8Array(6);
   header[0] = ORACLE_ACCOUNT_DISCRIMINATOR;
   header[1] = bump;
   new DataView(header.buffer).setUint32(2, sequence, true);

   return sendAdminInstructions(
      ctx,
      'promo-repair-oracle-header',
      async () => [
         {
            id: 'promo-clear-doppler-region',
            instruction: await getPromoWriteArbitraryDataIx(
               ctx.signer.address,
               ctx.programId,
               marketPda,
               2,
               clearDoppler,
            ),
         },
         {
            id: 'promo-repair-oracle-header',
            instruction: await getPromoWriteArbitraryDataIx(
               ctx.signer.address,
               ctx.programId,
               marketPda,
               0,
               header,
            ),
         },
      ],
      options,
   );
}

export async function runPromoCloseMarket(
   ctx: PromoAdminContext,
   marketId: MarketId,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   return sendAdminInstructions(
      ctx,
      options?.groupId ?? 'promo-close-market',
      async () => [
         {
            id: 'promo-close-market',
            instruction: await getCloseMarketIx(ctx.signer.address, ctx.programId, marketId),
         },
      ],
      options,
   );
}

export async function runPromoCloseEvent(
   ctx: PromoAdminContext,
   eventId: EventId,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   return sendAdminInstructions(
      ctx,
      options?.groupId ?? `promo-close-event-${eventId.event}`,
      async () => [
         {
            id: 'promo-close-event',
            instruction: await getCloseEventIx(ctx.signer.address, ctx.programId, eventId),
         },
      ],
      options,
   );
}

/** Close market data PDA then event-state PDA (no netting — promo has none). */
export async function runPromoCloseMarketAndEvent(
   ctx: PromoAdminContext,
   marketId: MarketId,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   const eventId = marketId.eventId;
   return sendAdminInstructions(
      ctx,
      'promo-close-market-event',
      async () => [
         {
            id: 'promo-close-market',
            instruction: await getCloseMarketIx(ctx.signer.address, ctx.programId, marketId),
         },
         {
            id: 'promo-close-event',
            instruction: await getCloseEventIx(ctx.signer.address, ctx.programId, eventId),
         },
      ],
      options,
   );
}

export function promoMarketIdFromParts(parts: MarketKeyParts, operator: Address = DEFAULT_MARKET_OPERATOR): MarketId {
   return marketIdFromKeyParts(parts, operator);
}

export function promoMarketIdFromIds(
   sportId: number,
   leagueId: number,
   eventId: number,
   periodId: number,
   operator: Address = DEFAULT_MARKET_OPERATOR,
): MarketId {
   return {
      eventId: { sport: sportId, league: leagueId, event: BigInt(eventId) },
      mkt: PROMO_MKT,
      period: periodId,
      isPregame: true,
      player: 0n,
      operator,
   };
}

export async function buildPromoInitMarketFromParts(
   parts: MarketKeyParts,
   operator: Address,
   allowedAccounts: readonly Address[],
   eventStartTime: number,
   marketOutcomes: 2 | 3,
   maxAmount: bigint,
   maxTotalAmount: bigint,
): Promise<PromoInitMarketPayload> {
   return {
      marketId: promoMarketIdFromParts(parts, operator),
      eventStartTime,
      marketOutcomes,
      maxAmount,
      maxTotalAmount,
      allowedAccounts,
   };
}

export async function runPromoWithdraw(
   ctx: PromoAdminContext,
   destinationAta?: Address,
   options?: SendAdminOptions,
) {
   await assertPromoConfigAdminSigner(ctx);
   const dest = destinationAta ?? await getAta(ctx.signer.address);
   return sendAdminInstructions(
      ctx,
      options?.groupId ?? 'promo-withdraw',
      async () => [
         {
            id: 'promo-withdraw',
            instruction: await getWithdrawFromTokenAccountIx(
               ctx.signer.address,
               ctx.programId,
               dest,
            ),
         },
      ],
      options,
   );
}

export type { PromoInitMarketPayload };
