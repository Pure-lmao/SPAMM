import { AccountRole, type Instruction } from '@solana/instructions';
import type { Address } from '@solana/kit';

import {
   CLOCK_ID,
   MINT_ID,
   SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   SPL_TOKEN_PROGRAM_ID,
   SYSVAR_INSTRUCTIONS_ID,
   SYSVAR_RENT_ID,
   SYSTEM_PROGRAM_ID,
} from './constants.js';
import {
   encodeFillCashoutQuoteIxData,
   encodeFillCashoutQuoteParlayIxData,
   encodeFillParlayQuoteIxData,
   encodeFillQuoteIxData,
   encodeGetCashoutQuoteIxData,
   encodeGetCashoutQuoteParlayIxData,
   encodeGetQuoteIxData,
   encodeGetQuoteParlayIxData,
   encodeMarketMakerInstructionData,
   FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR,
   FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
   FILL_CASHOUT_RFQ_IX_DISCRIMINATOR,
   FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR,
   FILL_QUOTE_IX_DISCRIMINATOR,
   FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
   GET_CASHOUT_QUOTE_IX_DISCRIMINATOR,
   GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
   GET_QUOTE_IX_DISCRIMINATOR,
   GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
   MM_FILL_BET_RFQ_IX_DISCRIMINATOR,
   MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR,
   WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR,
} from './codex.js';
import {
   getAta,
   getEventStatePda,
   getMmConfigPda,
   getMmEncumbrancePda,
   getMmMarketDataPda,
   getMmParlayQuoteBufferPda,
   getMmQuoteBufferPda,
} from './helpers.js';
import type {
   EventGameState,
   EventId,
   FillCashoutQuoteIxData,
   FillCashoutQuoteParlayIxData,
   FillParlayQuoteIxData,
   FillQuoteIxData,
   FillRfqIxData,
   GetCashoutQuoteIxData,
   GetCashoutQuoteParlayIxData,
   GetQuoteIxData,
   GetQuoteParlayIxData,
   MarketId,
   ParlayLegSel,
} from './types.js';
import {
   validateEventGameState,
   validateEventId,
   validateFillParlayQuoteIxData,
   validateFillQuoteIxData,
   validateGetQuoteIxData,
   validateGetQuoteParlayIxData,
   validateGetCashoutQuoteIxData,
   validateFillCashoutQuoteIxData,
   validateGetCashoutQuoteParlayIxData,
   validateFillCashoutQuoteParlayIxData,
   validateMarketId,
   validateOdds,
   validateU16,
   validateU32Bigint,
} from './validate.js';

export {
   CLOSE_EVENT_IX_DISCRIMINATOR,
   CLOSE_MARKET_IX_DISCRIMINATOR,
   FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
   GET_QUOTE_IX_DISCRIMINATOR,
   GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
   INIT_EVENT_IX_DISCRIMINATOR,
   INIT_MARKET_IX_DISCRIMINATOR,
   INIT_PROGRAM_IX_DISCRIMINATOR,
   MM_FILL_BET_RFQ_IX_DISCRIMINATOR,
   MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR,
   SET_RFQ_SIGNER_IX_DISCRIMINATOR,
   UPDATE_EVENT_STATE_IX_DISCRIMINATOR,
   WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR,
   WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR,
} from './codex.js';

/**
 * Payload for MM **`get_quote`** (same wire as aggregator CPI `GetQuoteIxData`).
 *
 * **Rust:** `GetQuoteIxPayload` / `GetQuoteIxData` on the MM program (`GET_QUOTE_IX_DISCRIMINATOR` = 120).
 */
export type MmGetQuote = {
   amount: bigint;
   minOddsScaled: bigint;
   side: number;
   eventGameState: EventGameState;
   eventStateSequence: number;
   marketId: MarketId;
};

/** Leg table for MM **`get_quote_parlay`** (matches aggregator `GetQuoteParlayIxData.legs`). */
export type MmGetQuoteParlay = {
   amount: bigint;
   minOddsScaled: bigint;
   legs: readonly ParlayLegSel[];
};

const ro = (address: Address) => ({ address, role: AccountRole.READONLY });
const rw = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const ws = (address: Address) => ({ address, role: AccountRole.WRITABLE_SIGNER });

/**
 * **`init_program`** — MM config PDA, single-leg quote buffer PDA, parlay quote buffer PDA, MM collateral ATA (authority = config PDA).
 *
 * **Rust:** `market_maker::instructions::init_program` (`INIT_PROGRAM_IX_DISCRIMINATOR` = 100). `admin` in data must equal `feepayer`. Accounts include rent sysvar immediately above system program.
 */
export async function getInitProgramIx(
   feepayer: Address,
   mmProgram: Address,
   rfqSigner?: Address,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(mmProgram);
   const [quoteBuf] = await getMmQuoteBufferPda(mmProgram);
   const [parlayQuoteBuf] = await getMmParlayQuoteBufferPda(mmProgram);
   const mmTokenAta = await getAta(configPda);
   return {
      programAddress: mmProgram,
      accounts: [
         ws(feepayer),
         rw(configPda),
         rw(quoteBuf),
         rw(parlayQuoteBuf),
         rw(mmTokenAta),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      data: encodeMarketMakerInstructionData({
         kind: 'initProgram',
         data: { admin: feepayer, rfqSigner: rfqSigner ?? feepayer },
      }),
   };
}

export async function getSetRfqSignerIx(
   admin: Address,
   mmProgram: Address,
   rfqSigner: Address,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(mmProgram);
   return {
      programAddress: mmProgram,
      accounts: [ws(admin), rw(configPda), ro(rfqSigner)],
      data: encodeMarketMakerInstructionData({ kind: 'setRfqSigner' }),
   };
}

/** MM **`fill_bet_rfq`** CPI entry for single-bet RFQ (normally invoked by aggregator; exposed for tests). */
export async function getMmFillBetRfqIx(
   user: Address,
   mmProgram: Address,
   marketId: MarketId,
   amountToSend: bigint,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, marketId);
   const [eventStatePda] = await getEventStatePda(mmProgram, marketId.eventId);
   const mmTokenAta = await getAta(configPda);
   const [encumbrancePda] = await getMmEncumbrancePda(mmProgram);
   const liabilityAta = await getAta(encumbrancePda);
   const data: FillRfqIxData = {
      instructionDiscriminator: MM_FILL_BET_RFQ_IX_DISCRIMINATOR,
      amountToSend,
   };
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         rw(marketDataPda),
         rw(eventStatePda),
         rw(configPda),
         rw(mmTokenAta),
         rw(liabilityAta),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SYSVAR_INSTRUCTIONS_ID),
      ],
      data: encodeMarketMakerInstructionData({ kind: 'fillBetRfq', data }),
   };
}

/** MM **`fill_parlay_rfq`** CPI entry for parlay RFQ (no market_data account). */
export async function getMmFillParlayRfqIx(
   user: Address,
   mmProgram: Address,
   amountToSend: bigint,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(mmProgram);
   const mmTokenAta = await getAta(configPda);
   const [encumbrancePda] = await getMmEncumbrancePda(mmProgram);
   const liabilityAta = await getAta(encumbrancePda);
   const data: FillRfqIxData = {
      instructionDiscriminator: MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR,
      amountToSend,
   };
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         rw(configPda),
         rw(mmTokenAta),
         rw(liabilityAta),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SYSVAR_INSTRUCTIONS_ID),
      ],
      data: encodeMarketMakerInstructionData({ kind: 'fillParlayRfq', data }),
   };
}

export async function getWithdrawFromTokenAccountIx(admin: Address, mmProgram: Address, destinationAta: Address): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(mmProgram);
   const tokenAccount = await getAta(configPda);
   return {
      programAddress: mmProgram,
      data: new Uint8Array([WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR]),
      accounts: [ws(admin), ro(configPda), rw(tokenAccount), ro(MINT_ID), ro(SPL_TOKEN_PROGRAM_ID), rw(destinationAta)],
   };
}

/**
 * Doppler oracle refresh — two-account entrypoint (`Oracle::<[u32; 3]>`).
 *
 * Accounts: admin (writable signer), market-data PDA (writable).
 * Data: disc `0` || `sequence` u32 || `odds0` u32 || `odds1` u32 || `odds2` u32 (third defaults to 0).
 */
export async function getUpdateOracleIx(auth: Address, mmProgram: Address, marketId: MarketId, sequence: bigint, odds0: bigint, odds1: bigint, odds2: bigint = 0n): Promise<Instruction> {
   validateMarketId(marketId, 'marketId');
   validateU32Bigint(sequence, 'sequence');
   validateOdds(odds0, 'odds0');
   validateOdds(odds1, 'odds1');
   validateOdds(odds2, 'odds2');
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, marketId);
   return {
      programAddress: mmProgram,
      accounts: [ws(auth), rw(marketDataPda)],
      data: encodeMarketMakerInstructionData({ kind: 'updateOracle', sequence, odds0, odds1, odds2 }),
   };
}

/**
 * **`init_event`** — create `["event_state", event_id]` PDA.
 *
 * **Rust:** `init_event::process` (discriminator 110). Accounts: feepayer, config PDA, event-state PDA, rent sysvar, system program.
 */
export async function getInitEventIx(
   feepayer: Address,
   eventId: EventId,
   mmProgram: Address,
   eventBody: Uint8Array = new Uint8Array(),
): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   const [configPda] = await getMmConfigPda(mmProgram);
   const [eventStatePda] = await getEventStatePda(mmProgram, eventId);
   return {
      programAddress: mmProgram,
      accounts: [ws(feepayer), ro(configPda), rw(eventStatePda), ro(SYSVAR_RENT_ID), ro(SYSTEM_PROGRAM_ID)],
      data: encodeMarketMakerInstructionData({ kind: 'initEvent', eventId, eventBody }),
   };
}

/**
 * **`update_event_state`** — set `sequence` and `game_state` on the event-state PDA (admin).
 *
 * **Rust:** `update_event_state::process` (discriminator **114**).
 */
export async function getUpdateEventStateIx(
   feepayer: Address,
   mmProgram: Address,
   eventId: EventId,
   sequence: number,
   gameState: EventGameState,
): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   validateU16(sequence, 'sequence');
   validateEventGameState(gameState, 'gameState');
   const [configPda] = await getMmConfigPda(mmProgram);
   const [eventStatePda] = await getEventStatePda(mmProgram, eventId);
   return {
      programAddress: mmProgram,
      accounts: [ws(feepayer), ro(configPda), rw(eventStatePda)],
      data: encodeMarketMakerInstructionData({ kind: 'updateEventState', eventId, sequence, gameState }),
   };
}

/**
 * **`init_market`** — create market-data PDA `["market_data", market_id_body_wire, operator]`; instruction tail is
 * `market_id` + oracle odds body (8-byte two-outcome bodies are padded to 12 bytes to match the on-chain floor).
 *
 * **Rust:** `init_market::process` (discriminator 111). Accounts: feepayer, config PDA, market-data PDA, rent sysvar, system program.
 */
export async function getInitMarketIx(
   feepayer: Address,
   mmProgram: Address,
   marketId: MarketId,
   oracleBody: Uint8Array,
): Promise<Instruction> {
   validateMarketId(marketId, 'marketId');
   let paddedBody = oracleBody;
   if (oracleBody.length === 8) {
      paddedBody = new Uint8Array(12);
      paddedBody.set(oracleBody);
   } else if (oracleBody.length !== 12) {
      throw new RangeError('oracleBody must be 8 bytes (2×u32) or 12 bytes (3×u32)');
   }
   const [configPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, marketId);
   return {
      programAddress: mmProgram,
      accounts: [ws(feepayer), ro(configPda), rw(marketDataPda), ro(SYSVAR_RENT_ID), ro(SYSTEM_PROGRAM_ID)],
      data: encodeMarketMakerInstructionData({ kind: 'initMarket', marketId, oracleBody: paddedBody }),
   };
}

/**
 * **`close_event`** — close event-state PDA.
 *
 * **Rust:** `close_event::process` (discriminator 112).
 */
export async function getCloseEventIx(auth: Address, mmProgram: Address, eventId: EventId): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   const [configPda] = await getMmConfigPda(mmProgram);
   const [eventStatePda] = await getEventStatePda(mmProgram, eventId);
   return {
      programAddress: mmProgram,
      accounts: [ws(auth), ro(configPda), rw(eventStatePda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeMarketMakerInstructionData({ kind: 'closeEvent', eventId }),
   };
}

/**
 * **`close_market`** — close market-data PDA for `market_id` (trailing ix bytes ignored on-chain).
 *
 * **Rust:** `close_market::process` (discriminator 113).
 */
export async function getCloseMarketIx(auth: Address, mmProgram: Address, marketId: MarketId): Promise<Instruction> {
   validateMarketId(marketId, 'marketId');
   const [configPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, marketId);
   return {
      programAddress: mmProgram,
      accounts: [ws(auth), ro(configPda), rw(marketDataPda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeMarketMakerInstructionData({ kind: 'closeMarket', marketId }),
   };
}

/**
 * **`get_quote`** — MM program entry; accounts: user, clock sysvar, market_data, event_state, config, quote buffer.
 *
 * **Rust:** `get_quote::process` (`GET_QUOTE_IX_DISCRIMINATOR` = 120).
 */
export async function getMmGetQuoteIx(
   quote: MmGetQuote,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   const data: GetQuoteIxData = {
      instructionDiscriminator: GET_QUOTE_IX_DISCRIMINATOR,
      amount: quote.amount,
      oddsScaled: quote.minOddsScaled,
      marketId: quote.marketId,
      side: quote.side,
      eventGameState: quote.eventGameState,
      eventStateSequence: quote.eventStateSequence,
   };
   validateGetQuoteIxData(data, 'quote');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, quote.marketId);
   const [eventStatePda] = await getEventStatePda(mmProgram, quote.marketId.eventId);
   const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
   const ixData = encodeGetQuoteIxData(data);
   return {
      programAddress: mmProgram,
      accounts: [ro(user), ro(CLOCK_ID), ro(marketDataPda), ro(eventStatePda), ro(mmConfigPda), rw(mmQuoteBufferPda)],
      data: ixData,
   };
}

/**
 * **`get_quote_parlay`** — MM program; combined parlay quote into parlay quote buffer.
 *
 * **Rust:** `get_quote_parlay::process` (`GET_QUOTE_PARLAY_IX_DISCRIMINATOR` = 122).
 */
export async function getMmGetQuoteParlayIx(
   quote: MmGetQuoteParlay,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   const numLegs = quote.legs.length;
   const data: GetQuoteParlayIxData = {
      instructionDiscriminator: GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
      amount: quote.amount,
      oddsScaled: quote.minOddsScaled,
      numLegs,
      legs: quote.legs,
   };
   validateGetQuoteParlayIxData(data, 'quote');
   const ixData = encodeGetQuoteParlayIxData(data);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const accounts: { address: Address; role: AccountRole }[] = [
      ro(user),
      ro(CLOCK_ID),
      ro(mmConfigPda),
      rw(mmParlayQuoteBufferPda),
   ];
   for (const leg of quote.legs) {
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, leg.marketId);
      const [eventStatePda] = await getEventStatePda(mmProgram, leg.marketId.eventId);
      accounts.push(ro(marketDataPda), ro(eventStatePda));
   }
   return {
      programAddress: mmProgram,
      accounts,
      data: ixData,
   };
}

/**
 * **`fill_parlay_quote`** — consume parlay quote buffer (aggregator CPI order). **`liabilityAta`** is the MM liability vault ATA (typically derived with the aggregator encumbrance PDA as owner).
 *
 * **Rust:** `fill_parlay_quote::process` (`FILL_QUOTE_PARLAY_IX_DISCRIMINATOR` = 123).
 */
export async function getMmFillParlayQuoteIx(
   params: Omit<FillParlayQuoteIxData, 'instructionDiscriminator'>,
   mmProgram: Address,
   user: Address,
   liabilityAta: Address,
): Promise<Instruction> {
   const full: FillParlayQuoteIxData = {
      instructionDiscriminator: FILL_QUOTE_PARLAY_IX_DISCRIMINATOR,
      ...params,
   };
   validateFillParlayQuoteIxData(full, 'fill');
   const ixData = encodeFillParlayQuoteIxData(full);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const mmTokenAta = await getAta(mmConfigPda);
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         rw(mmConfigPda),
         rw(mmParlayQuoteBufferPda),
         rw(mmTokenAta),
         rw(liabilityAta),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SYSVAR_INSTRUCTIONS_ID),
      ],
      data: ixData,
   };
}

/**
 * **`fill_quote`** — consume quote buffer (aggregator CPI order). **`liabilityAta`** is the MM liability vault ATA.
 *
 * **Rust:** `fill_quote::process` (`FILL_QUOTE_IX_DISCRIMINATOR` = 121).
 */
export async function getMmFillQuoteIx(
   params: Omit<FillQuoteIxData, 'instructionDiscriminator'>,
   mmProgram: Address,
   user: Address,
   liabilityAta: Address,
): Promise<Instruction> {
   const full: FillQuoteIxData = {
      instructionDiscriminator: FILL_QUOTE_IX_DISCRIMINATOR,
      ...params,
   };
   validateFillQuoteIxData(full, 'fill');
   const ixData = encodeFillQuoteIxData(full);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, params.marketId);
   const [eventStatePda] = await getEventStatePda(mmProgram, params.marketId.eventId);
   const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
   const mmTokenAta = await getAta(mmConfigPda);
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         rw(marketDataPda),
         rw(eventStatePda),
         rw(mmConfigPda),
         rw(mmQuoteBufferPda),
         rw(mmTokenAta),
         rw(liabilityAta),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SYSVAR_INSTRUCTIONS_ID),
      ],
      data: ixData,
   };
}

/**
 * **`get_cashout_quote`** — MM cashout quote into quote buffer.
 *
 * **Rust:** `get_cashout_quote::process` (`GET_CASHOUT_QUOTE_IX_DISCRIMINATOR` = 140).
 */
export async function getMmGetCashoutQuoteIx(
   params: Omit<GetCashoutQuoteIxData, 'instructionDiscriminator'>,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   const full: GetCashoutQuoteIxData = {
      instructionDiscriminator: GET_CASHOUT_QUOTE_IX_DISCRIMINATOR,
      ...params,
   };
   validateGetCashoutQuoteIxData(full);
   const ixData = encodeGetCashoutQuoteIxData(full);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, params.marketId);
   const [eventStatePda] = await getEventStatePda(mmProgram, params.marketId.eventId);
   const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         ro(CLOCK_ID),
         ro(marketDataPda),
         ro(eventStatePda),
         ro(mmConfigPda),
         rw(mmQuoteBufferPda),
      ],
      data: ixData,
   };
}

/**
 * **`fill_cashout_quote`** — transfer `amountToSend` from MM ATA to payment dest; set quote buffer `is_used`.
 *
 * **Rust:** `fill_cashout_quote::process` (`FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR` = 141).
 */
export async function getMmFillCashoutQuoteIx(
   params: Omit<FillCashoutQuoteIxData, 'instructionDiscriminator'>,
   mmProgram: Address,
   user: Address,
   paymentDest: Address,
): Promise<Instruction> {
   const full: FillCashoutQuoteIxData = {
      instructionDiscriminator: FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR,
      ...params,
   };
   validateFillCashoutQuoteIxData(full);
   const ixData = encodeFillCashoutQuoteIxData(full);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, params.marketId);
   const [eventStatePda] = await getEventStatePda(mmProgram, params.marketId.eventId);
   const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
   const mmTokenAta = await getAta(mmConfigPda);
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         rw(marketDataPda),
         rw(eventStatePda),
         rw(mmConfigPda),
         rw(mmQuoteBufferPda),
         rw(mmTokenAta),
         rw(paymentDest),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SYSVAR_INSTRUCTIONS_ID),
      ],
      data: ixData,
   };
}

/**
 * **`get_cashout_quote_parlay`** — MM parlay cashout quote into parlay quote buffer.
 *
 * **Rust:** `get_cashout_quote_parlay::process` (`GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR` = 142).
 */
export async function getMmGetCashoutQuoteParlayIx(
   params: Omit<GetCashoutQuoteParlayIxData, 'instructionDiscriminator'>,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   const full: GetCashoutQuoteParlayIxData = {
      instructionDiscriminator: GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
      ...params,
   };
   validateGetCashoutQuoteParlayIxData(full);
   const ixData = encodeGetCashoutQuoteParlayIxData(full);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const accounts: { address: Address; role: AccountRole }[] = [
      ro(user),
      ro(CLOCK_ID),
      ro(mmConfigPda),
      rw(mmParlayQuoteBufferPda),
   ];
   for (const leg of params.legs.slice(0, params.numLegs)) {
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, leg.marketId);
      const [eventStatePda] = await getEventStatePda(mmProgram, leg.marketId.eventId);
      accounts.push(ro(marketDataPda), ro(eventStatePda));
   }
   return {
      programAddress: mmProgram,
      accounts,
      data: ixData,
   };
}

/**
 * **`fill_cashout_quote_parlay`** — transfer `amountToSend` from MM ATA to payment dest; set parlay quote buffer `is_used`.
 *
 * **Rust:** `fill_cashout_quote_parlay::process` (`FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR` = 143).
 */
export async function getMmFillCashoutQuoteParlayIx(
   params: Omit<FillCashoutQuoteParlayIxData, 'instructionDiscriminator'>,
   mmProgram: Address,
   user: Address,
   paymentDest: Address,
): Promise<Instruction> {
   const full: FillCashoutQuoteParlayIxData = {
      instructionDiscriminator: FILL_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
      ...params,
   };
   validateFillCashoutQuoteParlayIxData(full);
   const ixData = encodeFillCashoutQuoteParlayIxData(full);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const mmTokenAta = await getAta(mmConfigPda);
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         rw(mmConfigPda),
         rw(mmParlayQuoteBufferPda),
         rw(mmTokenAta),
         rw(paymentDest),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SYSVAR_INSTRUCTIONS_ID),
      ],
      data: ixData,
   };
}

/**
 * **`fill_cashout_rfq`** — transfer `amountToSend` from MM ATA to payment dest (aggregator CPI order).
 *
 * **Rust:** `fill_cashout_rfq::process` (`FILL_CASHOUT_RFQ_IX_DISCRIMINATOR` = 144).
 */
export async function getMmFillCashoutRfqIx(
   user: Address,
   mmProgram: Address,
   marketId: MarketId,
   amountToSend: bigint,
   paymentDest: Address,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, marketId);
   const [eventStatePda] = await getEventStatePda(mmProgram, marketId.eventId);
   const mmTokenAta = await getAta(configPda);
   const data: FillRfqIxData = {
      instructionDiscriminator: FILL_CASHOUT_RFQ_IX_DISCRIMINATOR,
      amountToSend,
   };
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         rw(marketDataPda),
         rw(eventStatePda),
         rw(configPda),
         rw(mmTokenAta),
         rw(paymentDest),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SYSVAR_INSTRUCTIONS_ID),
      ],
      data: encodeMarketMakerInstructionData({ kind: 'fillCashoutRfq', data }),
   };
}

/**
 * **`fill_parlay_cashout_rfq`** — transfer `amountToSend` from MM ATA to payment dest (aggregator CPI order).
 *
 * **Rust:** `fill_parlay_cashout_rfq::process` (`FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR` = 145).
 */
export async function getMmFillParlayCashoutRfqIx(
   user: Address,
   mmProgram: Address,
   amountToSend: bigint,
   paymentDest: Address,
): Promise<Instruction> {
   const [configPda] = await getMmConfigPda(mmProgram);
   const mmTokenAta = await getAta(configPda);
   const data: FillRfqIxData = {
      instructionDiscriminator: FILL_PARLAY_CASHOUT_RFQ_IX_DISCRIMINATOR,
      amountToSend,
   };
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         rw(configPda),
         rw(mmTokenAta),
         rw(paymentDest),
         ro(MINT_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SYSVAR_INSTRUCTIONS_ID),
      ],
      data: encodeMarketMakerInstructionData({ kind: 'fillParlayCashoutRfq', data }),
   };
}

export async function getWriteArbitraryDataIx(
   admin: Address,
   mmProgram: Address,
   account: Address,
   data: Uint8Array,
): Promise<Instruction> {
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   return {
      programAddress: mmProgram,
      accounts: [ws(admin), ro(mmConfigPda), rw(account), ro(SYSVAR_RENT_ID), ro(SYSTEM_PROGRAM_ID)],
      data: encodeMarketMakerInstructionData({ kind: 'writeArbitraryData', data }),
   };
}

export async function getForceClosePdaIx(auth: Address, mmProgram: Address, pda: Address): Promise<Instruction> {
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   return {
      programAddress: mmProgram,
      accounts: [ws(auth), ro(mmConfigPda), rw(pda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeMarketMakerInstructionData({ kind: 'forceClosePda' }),
   };
}

export type MarketMakerInstructionInput =
   | {
        kind: 'updateOracleBody';
        auth: Address;
        mmProgram: Address;
        marketId: MarketId;
        sequence: bigint;
        odds0: bigint;
        odds1: bigint;
        odds2?: bigint;
     }
   | { kind: 'initProgram'; feepayer: Address; mmProgram: Address }
   | { kind: 'initEvent'; feepayer: Address; eventId: EventId; mmProgram: Address; eventBody?: Uint8Array }
   | {
        kind: 'updateEventState';
        feepayer: Address;
        mmProgram: Address;
        eventId: EventId;
        sequence: number;
        gameState: EventGameState;
     }
   | {
        kind: 'initMarket';
        feepayer: Address;
        mmProgram: Address;
        marketId: MarketId;
        oracleBody: Uint8Array;
     }
   | { kind: 'closeEvent'; auth: Address; eventId: EventId; mmProgram: Address }
   | { kind: 'closeMarket'; auth: Address; marketId: MarketId; mmProgram: Address }
   | { kind: 'getQuote'; quote: MmGetQuote; mmProgram: Address; user: Address }
   | { kind: 'getQuoteParlay'; quote: MmGetQuoteParlay; mmProgram: Address; user: Address }
   | {
        kind: 'fillQuote';
        params: Omit<FillQuoteIxData, 'instructionDiscriminator'>;
        mmProgram: Address;
        user: Address;
        liabilityAta: Address;
     }
   | {
        kind: 'fillParlayQuote';
        params: Omit<FillParlayQuoteIxData, 'instructionDiscriminator'>;
        mmProgram: Address;
        user: Address;
        liabilityAta: Address;
     }
   | {
        kind: 'getCashoutQuote';
        params: Omit<GetCashoutQuoteIxData, 'instructionDiscriminator'>;
        mmProgram: Address;
        user: Address;
     }
   | {
        kind: 'fillCashoutQuote';
        params: Omit<FillCashoutQuoteIxData, 'instructionDiscriminator'>;
        mmProgram: Address;
        user: Address;
        paymentDest: Address;
     }
   | {
        kind: 'getCashoutQuoteParlay';
        params: Omit<GetCashoutQuoteParlayIxData, 'instructionDiscriminator'>;
        mmProgram: Address;
        user: Address;
     }
   | {
        kind: 'fillCashoutQuoteParlay';
        params: Omit<FillCashoutQuoteParlayIxData, 'instructionDiscriminator'>;
        mmProgram: Address;
        user: Address;
        paymentDest: Address;
     }
   | {
        kind: 'fillCashoutRfq';
        user: Address;
        mmProgram: Address;
        marketId: MarketId;
        amountToSend: bigint;
        paymentDest: Address;
     }
   | {
        kind: 'fillParlayCashoutRfq';
        user: Address;
        mmProgram: Address;
        amountToSend: bigint;
        paymentDest: Address;
     }
   | { kind: 'writeArbitraryData'; admin: Address; mmProgram: Address; account: Address; data: Uint8Array }
   | { kind: 'forceClosePda'; auth: Address; pda: Address; mmProgram: Address };

export type MarketMakerInstructionKind = MarketMakerInstructionInput['kind'];

/**
 * Dispatch MM program instructions by `input.kind` (excludes Doppler oracle `0`).
 */
export async function getInstructionIx(input: MarketMakerInstructionInput): Promise<Instruction> {
   switch (input.kind) {
      case 'updateOracleBody':
         return getUpdateOracleIx(
            input.auth,
            input.mmProgram,
            input.marketId,
            input.sequence,
            input.odds0,
            input.odds1,
            input.odds2,
         );
      case 'initProgram':
         return getInitProgramIx(input.feepayer, input.mmProgram);
      case 'initEvent':
         return getInitEventIx(input.feepayer, input.eventId, input.mmProgram, input.eventBody);
      case 'updateEventState':
         return getUpdateEventStateIx(
            input.feepayer,
            input.mmProgram,
            input.eventId,
            input.sequence,
            input.gameState,
         );
      case 'initMarket':
         return getInitMarketIx(input.feepayer, input.mmProgram, input.marketId, input.oracleBody);
      case 'closeEvent':
         return getCloseEventIx(input.auth, input.mmProgram, input.eventId);
      case 'closeMarket':
         return getCloseMarketIx(input.auth, input.mmProgram, input.marketId);
      case 'getQuote':
         return getMmGetQuoteIx(input.quote, input.mmProgram, input.user);
      case 'getQuoteParlay':
         return getMmGetQuoteParlayIx(input.quote, input.mmProgram, input.user);
      case 'fillQuote':
         return getMmFillQuoteIx(input.params, input.mmProgram, input.user, input.liabilityAta);
      case 'fillParlayQuote':
         return getMmFillParlayQuoteIx(input.params, input.mmProgram, input.user, input.liabilityAta);
      case 'getCashoutQuote':
         return getMmGetCashoutQuoteIx(input.params, input.mmProgram, input.user);
      case 'fillCashoutQuote':
         return getMmFillCashoutQuoteIx(input.params, input.mmProgram, input.user, input.paymentDest);
      case 'getCashoutQuoteParlay':
         return getMmGetCashoutQuoteParlayIx(input.params, input.mmProgram, input.user);
      case 'fillCashoutQuoteParlay':
         return getMmFillCashoutQuoteParlayIx(input.params, input.mmProgram, input.user, input.paymentDest);
      case 'fillCashoutRfq':
         return getMmFillCashoutRfqIx(
            input.user,
            input.mmProgram,
            input.marketId,
            input.amountToSend,
            input.paymentDest,
         );
      case 'fillParlayCashoutRfq':
         return getMmFillParlayCashoutRfqIx(
            input.user,
            input.mmProgram,
            input.amountToSend,
            input.paymentDest,
         );
      case 'writeArbitraryData':
         return getWriteArbitraryDataIx(input.admin, input.mmProgram, input.account, input.data);
      case 'forceClosePda':
         return getForceClosePdaIx(input.auth, input.mmProgram, input.pda);
      default: {
         const _exhaustive: never = input;
         throw new Error(`unknown instruction: ${String(_exhaustive)}`);
      }
   }
}
