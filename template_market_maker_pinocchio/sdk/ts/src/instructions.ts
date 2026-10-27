import { AccountRole, type Instruction } from '@solana/instructions';
import type { Address } from '@solana/kit';

import {
   CLOCK_ID,
   encodeFillBetQuoteIxData,
   encodeFillCashoutParlayQuoteIxData,
   encodeFillCashoutQuoteIxData,
   encodeFillParlayQuoteIxData,
   encodeGetCashoutQuoteIxData,
   encodeGetCashoutQuoteParlayIxData,
   encodeGetQuoteIxData,
   encodeGetQuoteParlayIxData,
   getAta,
   getEventStatePda,
   getMmEncumbrancePda,
   getMmMarketDataPda,
   MM_FILL_BET_QUOTE_IX_DISCRIMINATOR,
   MM_FILL_BET_RFQ_IX_DISCRIMINATOR,
   MM_FILL_CASHOUT_PARLAY_QUOTE_IX_DISCRIMINATOR,
   MM_FILL_CASHOUT_PARLAY_RFQ_IX_DISCRIMINATOR,
   MM_FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR,
   MM_FILL_CASHOUT_RFQ_IX_DISCRIMINATOR,
   MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR,
   MM_FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
   MM_GET_CASHOUT_QUOTE_IX_DISCRIMINATOR,
   MM_GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
   MM_GET_QUOTE_IX_DISCRIMINATOR,
   MM_GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
   SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   SPL_TOKEN_PROGRAM_ID,
   SYSTEM_PROGRAM_ID,
   CONFIG_PDA,
   SYSVAR_RENT_ID,
} from 'spamm-aggregator-sdk';

import {
   encodeCloseEventIxData,
   encodeCloseMarketIxData,
   encodeFillRfqIxData,
   encodeInitEventIxData,
   encodeInitMarketIxData,
   encodeInitProgramIxData,
   encodeSetRfqSignerIxData,
   encodeUpdateEventStateIxData,
   encodeUpdateMarketIxData,
   encodeWithdrawIxData,
} from './codex.js';
import {
   PINOCCHIO_TEMPLATE_MM_CONFIG_PDA,
   PINOCCHIO_TEMPLATE_MM_PARLAY_QUOTE_BUFFER_PDA,
   PINOCCHIO_TEMPLATE_MM_PROGRAM_ID,
   PINOCCHIO_TEMPLATE_MM_QUOTE_BUFFER_PDA,
} from './constants.js';
import type {
   EventGameState,
   EventId,
   FillBetQuoteIxData,
   FillCashoutParlayQuoteIxData,
   FillCashoutQuoteIxData,
   FillParlayQuoteIxData,
   GetCashoutQuoteIxData,
   GetCashoutQuoteParlayIxData,
   GetQuoteIxData,
   GetQuoteParlayIxData,
   MarketId,
} from './types.js';
import { assertEventId, assertMarketId, assertSequence, assertU64 } from './validate.js';

const PROGRAM = PINOCCHIO_TEMPLATE_MM_PROGRAM_ID;
const CONFIG = PINOCCHIO_TEMPLATE_MM_CONFIG_PDA;
const QUOTE_BUFFER = PINOCCHIO_TEMPLATE_MM_QUOTE_BUFFER_PDA;
const PARLAY_BUFFER = PINOCCHIO_TEMPLATE_MM_PARLAY_QUOTE_BUFFER_PDA;

const ro = (address: Address) => ({ address, role: AccountRole.READONLY });
const rs = (address: Address) => ({ address, role: AccountRole.READONLY_SIGNER });
const rw = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const ws = (address: Address) => ({ address, role: AccountRole.WRITABLE_SIGNER });

function ix(accounts: Instruction['accounts'], data: Uint8Array): Instruction {
   return { programAddress: PROGRAM, accounts, data };
}

export async function collateralAta(mint: Address): Promise<Address> {
   return getAta(CONFIG, mint);
}

export async function liabilityAta(mint: Address): Promise<Address> {
   const [encumbrance] = await getMmEncumbrancePda(PROGRAM, mint);
   return getAta(encumbrance, mint);
}

/** Creates config and both quote buffers. Open a collateral ATA per mint with `getCreateTokenAccountIx`. */
export async function getInitProgramIx(admin: Address, rfqSigner: Address = admin): Promise<Instruction> {
   return ix(
      [
         ws(admin),
         rw(CONFIG),
         rw(QUOTE_BUFFER),
         rw(PARLAY_BUFFER),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      encodeInitProgramIxData(admin, rfqSigner),
   );
}

/** Config PDA collateral ATA for one mint (discriminator 102). */
export async function getCreateTokenAccountIx(admin: Address, mint: Address): Promise<Instruction> {
   return ix(
      [
         ws(admin),
         ro(CONFIG),
         rw(await collateralAta(mint)),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      new Uint8Array([102]),
   );
}

export function getSetRfqSignerIx(admin: Address, rfqSigner: Address): Instruction {
   return ix([ws(admin), rw(CONFIG), ro(rfqSigner)], encodeSetRfqSignerIxData());
}

/** Event PDA is the framework header only, sequence 0. */
export async function getInitEventIx(admin: Address, eventId: EventId): Promise<Instruction> {
   assertEventId(eventId);
   const [eventState] = await getEventStatePda(PROGRAM, eventId);
   return ix(
      [ws(admin), ro(CONFIG), rw(eventState), ro(SYSVAR_RENT_ID), ro(SYSTEM_PROGRAM_ID)],
      encodeInitEventIxData(eventId),
   );
}

/** Market PDA is discriminator + bump only. */
export async function getInitMarketIx(admin: Address, marketId: MarketId): Promise<Instruction> {
   assertMarketId(marketId);
   const [market] = await getMmMarketDataPda(PROGRAM, marketId);
   return ix(
      [ws(admin), ro(CONFIG), rw(market), ro(SYSVAR_RENT_ID), ro(SYSTEM_PROGRAM_ID)],
      encodeInitMarketIxData(marketId),
   );
}

/** Checks the market PDA. This template has no market body to write. */
export async function getUpdateMarketIx(admin: Address, marketId: MarketId): Promise<Instruction> {
   assertMarketId(marketId);
   const [market] = await getMmMarketDataPda(PROGRAM, marketId);
   return ix(
      [ws(admin), ro(CONFIG), rw(market)],
      encodeUpdateMarketIxData(marketId),
   );
}

export async function getCloseEventIx(admin: Address, eventId: EventId): Promise<Instruction> {
   assertEventId(eventId);
   const [eventState] = await getEventStatePda(PROGRAM, eventId);
   return ix(
      [ws(admin), ro(CONFIG), rw(eventState), ro(SYSTEM_PROGRAM_ID)],
      encodeCloseEventIxData(eventId),
   );
}

export async function getCloseMarketIx(admin: Address, marketId: MarketId): Promise<Instruction> {
   assertMarketId(marketId);
   const [market] = await getMmMarketDataPda(PROGRAM, marketId);
   return ix(
      [ws(admin), ro(CONFIG), rw(market), ro(SYSTEM_PROGRAM_ID)],
      encodeCloseMarketIxData(marketId),
   );
}

export async function getUpdateEventStateIx(
   admin: Address,
   eventId: EventId,
   sequence: number,
   gameState: EventGameState,
): Promise<Instruction> {
   assertEventId(eventId);
   assertSequence(sequence);
   const [eventState] = await getEventStatePda(PROGRAM, eventId);
   return ix(
      [ws(admin), ro(CONFIG), rw(eventState)],
      encodeUpdateEventStateIxData(eventId, sequence, gameState),
   );
}

/** Withdraw the full collateral ATA balance to `destination`. */
export async function getWithdrawIx(admin: Address, destination: Address, mint: Address): Promise<Instruction> {
   return ix(
      [
         ws(admin),
         ro(CONFIG),
         rw(await collateralAta(mint)),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         rw(destination),
      ],
      encodeWithdrawIxData(),
   );
}

async function singleQuoteAccounts(user: Address, marketId: MarketId, writableMarket: boolean) {
   const [market] = await getMmMarketDataPda(PROGRAM, marketId);
   const [eventState] = await getEventStatePda(PROGRAM, marketId.eventId);
   const marketMeta = writableMarket ? rw(market) : ro(market);
   const eventMeta = writableMarket ? rw(eventState) : ro(eventState);
   return { marketMeta, eventMeta };
}

export async function getGetQuoteIx(user: Address, data: Omit<GetQuoteIxData, 'instructionDiscriminator'>): Promise<Instruction> {
   assertMarketId(data.marketId);
   const { marketMeta, eventMeta } = await singleQuoteAccounts(user, data.marketId, false);
   return ix(
      [ro(user), ro(CLOCK_ID), marketMeta, eventMeta, ro(CONFIG), rw(QUOTE_BUFFER)],
      encodeGetQuoteIxData({ ...data, instructionDiscriminator: MM_GET_QUOTE_IX_DISCRIMINATOR }),
   );
}

export async function getFillBetQuoteIx(
   user: Address,
   data: Omit<FillBetQuoteIxData, 'instructionDiscriminator'>,
): Promise<Instruction> {
   assertMarketId(data.marketId);
   const { marketMeta, eventMeta } = await singleQuoteAccounts(user, data.marketId, true);
   return ix(
      [
         ro(user),
         rs(CONFIG_PDA),
         marketMeta,
         eventMeta,
         rw(CONFIG),
         rw(QUOTE_BUFFER),
         rw(await collateralAta(data.marketId.mint)),
         rw(await liabilityAta(data.marketId.mint)),
         ro(data.marketId.mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      encodeFillBetQuoteIxData({ ...data, instructionDiscriminator: MM_FILL_BET_QUOTE_IX_DISCRIMINATOR }),
   );
}

export async function getGetQuoteParlayIx(
   user: Address,
   data: Omit<GetQuoteParlayIxData, 'instructionDiscriminator'>,
): Promise<Instruction> {
   const legs = [];
   for (const leg of data.legs) {
      assertMarketId(leg.marketId);
      const [market] = await getMmMarketDataPda(PROGRAM, leg.marketId);
      const [eventState] = await getEventStatePda(PROGRAM, leg.marketId.eventId);
      legs.push(ro(market), ro(eventState));
   }
   return ix(
      [ro(user), ro(CLOCK_ID), ro(CONFIG), rw(PARLAY_BUFFER), ...legs],
      encodeGetQuoteParlayIxData({ ...data, instructionDiscriminator: MM_GET_QUOTE_PARLAY_IX_DISCRIMINATOR }),
   );
}

export async function getFillParlayQuoteIx(
   user: Address,
   mint: Address,
   data: Omit<FillParlayQuoteIxData, 'instructionDiscriminator'>,
): Promise<Instruction> {
   return ix(
      [
         ro(user),
         rs(CONFIG_PDA),
         rw(CONFIG),
         rw(PARLAY_BUFFER),
         rw(await collateralAta(mint)),
         rw(await liabilityAta(mint)),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      encodeFillParlayQuoteIxData({ ...data, instructionDiscriminator: MM_FILL_QUOTE_PARLAY_IX_DISCRIMINATOR }),
   );
}

export async function getGetCashoutQuoteIx(
   user: Address,
   data: Omit<GetCashoutQuoteIxData, 'instructionDiscriminator'>,
): Promise<Instruction> {
   assertMarketId(data.marketId);
   const { marketMeta, eventMeta } = await singleQuoteAccounts(user, data.marketId, false);
   return ix(
      [ro(user), ro(CLOCK_ID), marketMeta, eventMeta, ro(CONFIG), rw(QUOTE_BUFFER)],
      encodeGetCashoutQuoteIxData({ ...data, instructionDiscriminator: MM_GET_CASHOUT_QUOTE_IX_DISCRIMINATOR }),
   );
}

export async function getFillCashoutQuoteIx(
   user: Address,
   paymentDest: Address,
   data: Omit<FillCashoutQuoteIxData, 'instructionDiscriminator'>,
): Promise<Instruction> {
   assertMarketId(data.marketId);
   const { marketMeta, eventMeta } = await singleQuoteAccounts(user, data.marketId, true);
   return ix(
      [
         ro(user),
         rs(CONFIG_PDA),
         marketMeta,
         eventMeta,
         rw(CONFIG),
         rw(QUOTE_BUFFER),
         rw(await collateralAta(data.marketId.mint)),
         rw(paymentDest),
         ro(data.marketId.mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      encodeFillCashoutQuoteIxData({ ...data, instructionDiscriminator: MM_FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR }),
   );
}

export async function getGetCashoutQuoteParlayIx(
   user: Address,
   data: Omit<GetCashoutQuoteParlayIxData, 'instructionDiscriminator'>,
): Promise<Instruction> {
   const legs = [];
   for (const leg of data.legs) {
      assertMarketId(leg.marketId);
      const [market] = await getMmMarketDataPda(PROGRAM, leg.marketId);
      const [eventState] = await getEventStatePda(PROGRAM, leg.marketId.eventId);
      legs.push(ro(market), ro(eventState));
   }
   return ix(
      [ro(user), ro(CLOCK_ID), ro(CONFIG), rw(PARLAY_BUFFER), ...legs],
      encodeGetCashoutQuoteParlayIxData({
         ...data,
         instructionDiscriminator: MM_GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
      }),
   );
}

export async function getFillCashoutParlayQuoteIx(
   user: Address,
   paymentDest: Address,
   mint: Address,
   data: Omit<FillCashoutParlayQuoteIxData, 'instructionDiscriminator'>,
): Promise<Instruction> {
   return ix(
      [
         ro(user),
         rs(CONFIG_PDA),
         rw(CONFIG),
         rw(PARLAY_BUFFER),
         rw(await collateralAta(mint)),
         rw(paymentDest),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      encodeFillCashoutParlayQuoteIxData({
         ...data,
         instructionDiscriminator: MM_FILL_CASHOUT_PARLAY_QUOTE_IX_DISCRIMINATOR,
      }),
   );
}

async function rfqSingleAccounts(marketId: MarketId) {
   const [market] = await getMmMarketDataPda(PROGRAM, marketId);
   const [eventState] = await getEventStatePda(PROGRAM, marketId.eventId);
   return [rw(market), rw(eventState)] as const;
}

export async function getFillBetRfqIx(user: Address, marketId: MarketId, amountToSend: bigint): Promise<Instruction> {
   assertMarketId(marketId);
   assertU64(amountToSend, 'amountToSend');
   const [market, eventState] = await rfqSingleAccounts(marketId);
   return ix(
      [
         ro(user),
         rs(CONFIG_PDA),
         market,
         eventState,
         rw(CONFIG),
         rw(await collateralAta(marketId.mint)),
         rw(await liabilityAta(marketId.mint)),
         ro(marketId.mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      encodeFillRfqIxData(MM_FILL_BET_RFQ_IX_DISCRIMINATOR, amountToSend),
   );
}

export async function getFillParlayRfqIx(user: Address, mint: Address, amountToSend: bigint): Promise<Instruction> {
   assertU64(amountToSend, 'amountToSend');
   return ix(
      [
         ro(user),
         rs(CONFIG_PDA),
         rw(CONFIG),
         rw(await collateralAta(mint)),
         rw(await liabilityAta(mint)),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      encodeFillRfqIxData(MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR, amountToSend),
   );
}

export async function getFillCashoutRfqIx(
   user: Address,
   marketId: MarketId,
   paymentDest: Address,
   amountToSend: bigint,
): Promise<Instruction> {
   assertMarketId(marketId);
   assertU64(amountToSend, 'amountToSend');
   const [market, eventState] = await rfqSingleAccounts(marketId);
   return ix(
      [
         ro(user),
         rs(CONFIG_PDA),
         market,
         eventState,
         rw(CONFIG),
         rw(await collateralAta(marketId.mint)),
         rw(paymentDest),
         ro(marketId.mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      encodeFillRfqIxData(MM_FILL_CASHOUT_RFQ_IX_DISCRIMINATOR, amountToSend),
   );
}

export async function getFillCashoutParlayRfqIx(
   user: Address,
   paymentDest: Address,
   mint: Address,
   amountToSend: bigint,
): Promise<Instruction> {
   assertU64(amountToSend, 'amountToSend');
   return ix(
      [
         ro(user),
         rs(CONFIG_PDA),
         rw(CONFIG),
         rw(await collateralAta(mint)),
         rw(paymentDest),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      encodeFillRfqIxData(MM_FILL_CASHOUT_PARLAY_RFQ_IX_DISCRIMINATOR, amountToSend),
   );
}
