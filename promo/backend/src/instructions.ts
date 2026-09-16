import { AccountRole, type Instruction } from '@solana/kit';
import type { Address } from '@solana/kit';
import {
   encodePromoCloseEventIxData,
   encodePromoCloseMarketIxData,
   encodePromoInitEventIxData,
   encodePromoInitMarketIxData,
   encodePromoInitProgramIxData,
   encodePromoUpdateEventStateIxData,
   encodeSetMarketMaxAmountIxData,
   encodeSetMarketMaxTotalAmountIxData,
   encodeUpdateOracleIxData,
   encodeUpdateStatusIxData,
   encodeWriteArbitraryDataIxData,
   encodeForceClosePdaIxData,
   WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR,
   type PromoInitMarketPayload,
} from './codex';
export type { PromoInitMarketPayload } from './codex';
import { PROMO_PROGRAM_ID } from './constants';
import type { EventGameState, EventId, MarketId } from './spammSdk';
import {
   getAta,
   getMmConfigPda,
   getMmMarketDataPda,
   getMmParlayQuoteBufferPda,
   getMmQuoteBufferPda,
   getEventStatePda,
   MINT_ID,
   SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   SPL_TOKEN_PROGRAM_ID,
   SYSVAR_RENT_ID,
   SYSTEM_PROGRAM_ID,
} from './spammSdk';

const ro = (address: Address) => ({ address, role: AccountRole.READONLY });
const rw = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const ws = (address: Address) => ({ address, role: AccountRole.WRITABLE_SIGNER });

export async function getUpdateStatusIx(
   admin: Address,
   programId: Address,
   active: boolean,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   return {
      programAddress: programId,
      accounts: [ws(admin), rw(configPda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeUpdateStatusIxData(active),
   };
}

export async function getPromoMarketDataPda(programId: Address, marketId: MarketId) {
   return getMmMarketDataPda(programId, marketId);
}

export async function getInitProgramIx(
   feepayer: Address,
   programId: Address,
   rfqSigner: Address = feepayer,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   const [quoteBufferPda] = await getMmQuoteBufferPda(programId);
   const [parlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(programId);
   const collateralAta = await getAta(configPda);
   return {
      programAddress: programId,
      accounts: [
         ws(feepayer),
         rw(configPda),
         rw(quoteBufferPda),
         rw(parlayQuoteBufferPda),
         rw(collateralAta),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      data: encodePromoInitProgramIxData(feepayer, rfqSigner),
   };
}

export async function getInitEventIx(
   feepayer: Address,
   programId: Address,
   eventId: EventId,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   const [eventStatePda] = await getEventStatePda(programId, eventId);
   return {
      programAddress: programId,
      accounts: [
         ws(feepayer),
         ro(configPda),
         rw(eventStatePda),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      data: encodePromoInitEventIxData(eventId),
   };
}

export async function getUpdateEventStateIx(
   feepayer: Address,
   programId: Address,
   eventId: EventId,
   sequence: number,
   gameState: EventGameState,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   const [eventStatePda] = await getEventStatePda(programId, eventId);
   return {
      programAddress: programId,
      accounts: [ws(feepayer), ro(configPda), rw(eventStatePda)],
      data: encodePromoUpdateEventStateIxData(eventId, sequence, gameState),
   };
}

export async function getCloseEventIx(
   auth: Address,
   programId: Address,
   eventId: EventId,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   const [eventStatePda] = await getEventStatePda(programId, eventId);
   return {
      programAddress: programId,
      accounts: [ws(auth), ro(configPda), rw(eventStatePda), ro(SYSTEM_PROGRAM_ID)],
      data: encodePromoCloseEventIxData(eventId),
   };
}

export async function getCloseMarketIx(
   auth: Address,
   programId: Address,
   marketId: MarketId,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   const [marketDataPda] = await getMmMarketDataPda(programId, marketId);
   return {
      programAddress: programId,
      accounts: [ws(auth), ro(configPda), rw(marketDataPda), ro(SYSTEM_PROGRAM_ID)],
      data: encodePromoCloseMarketIxData(marketId),
   };
}

/** Promo update oracle (disc 0): admin + config + market data. */
export async function getPromoUpdateOracleIx(
   admin: Address,
   programId: Address,
   marketId: MarketId,
   sequence: bigint,
   odds0: bigint,
   odds1: bigint,
   odds2: bigint,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   const [marketDataPda] = await getMmMarketDataPda(programId, marketId);
   return {
      programAddress: programId,
      accounts: [ws(admin), ro(configPda), rw(marketDataPda)],
      data: encodeUpdateOracleIxData({ sequence, odds0, odds1, odds2 }),
   };
}

export async function getPromoInitMarketIx(
   feepayer: Address,
   programId: Address,
   payload: PromoInitMarketPayload,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   const [marketDataPda] = await getMmMarketDataPda(programId, payload.marketId);
   return {
      programAddress: programId,
      accounts: [
         ws(feepayer),
         ro(configPda),
         rw(marketDataPda),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      data: encodePromoInitMarketIxData(payload),
   };
}

export async function getSetMarketMaxAmountIx(
   admin: Address,
   programId: Address,
   marketId: MarketId,
   maxAmount: bigint,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   const [marketDataPda] = await getMmMarketDataPda(programId, marketId);
   return {
      programAddress: programId,
      accounts: [ws(admin), ro(configPda), rw(marketDataPda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeSetMarketMaxAmountIxData(marketId, maxAmount),
   };
}

export async function getSetMarketMaxTotalAmountIx(
   admin: Address,
   programId: Address,
   marketId: MarketId,
   maxTotalAmount: bigint,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   const [marketDataPda] = await getMmMarketDataPda(programId, marketId);
   return {
      programAddress: programId,
      accounts: [ws(admin), ro(configPda), rw(marketDataPda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeSetMarketMaxTotalAmountIxData(marketId, maxTotalAmount),
   };
}

/** Patch raw bytes on a promo PDA (ix 254). Grows the target when offset+len exceeds size. */
export async function getPromoWriteArbitraryDataIx(
   admin: Address,
   programId: Address,
   targetPda: Address,
   offset: number,
   bytes: Uint8Array,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   return {
      programAddress: programId,
      accounts: [
         ws(admin),
         ro(configPda),
         rw(targetPda),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      data: encodeWriteArbitraryDataIxData(offset, bytes),
   };
}

/** Close a promo-owned PDA and return rent to admin (ix 255). */
export async function getPromoForceClosePdaIx(
   admin: Address,
   programId: Address,
   pda: Address,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   return {
      programAddress: programId,
      accounts: [ws(admin), ro(configPda), rw(pda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeForceClosePdaIxData(),
   };
}

export async function getWithdrawFromTokenAccountIx(
   admin: Address,
   programId: Address,
   destinationAta: Address,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(programId);
   const tokenAccount = await getAta(configPda);
   return {
      programAddress: programId,
      accounts: [
         ws(admin),
         ro(configPda),
         rw(tokenAccount),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         rw(destinationAta),
      ],
      data: new Uint8Array([WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR]),
   };
}

export function defaultPromoProgramId(): Address {
   return PROMO_PROGRAM_ID;
}

export type { EventId, MarketId };
