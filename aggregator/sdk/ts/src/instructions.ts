import {
   getAddressDecoder,
   getAddressEncoder,
   getU32Decoder,
   getU32Encoder,
   getU64Decoder,
   getU64Encoder,
   type Address,
   type ReadonlyUint8Array,
   AccountRole,
   type Instruction
} from '@solana/kit';
import {
   AGGREGATOR_PROGRAM_ID,
   MAX_NUMBER_OF_MMS,
   MAX_NUMBER_OF_MMS_PROXY,
   ADDRESS_LEN,
   MAX_PARLAY_LEGS,
   PROMO_BOOST,
   PROMO_FREEBET,
   SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   CONFIG_PDA,
   SPL_TOKEN_PROGRAM_ID,
   SYSVAR_RENT_ID,
   SYSTEM_PROGRAM_ID,
   CLOCK_ID,
   MM_FILL_BET_RFQ_IX_DISCRIMINATOR,
   MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR,
} from './constants.js';
import {
   concatDiscriminator,
   concatDiscriminatorU32Prefix,
   decodeFillCashoutIxData,
   decodeFillParlayCashoutIxData,
   decodeFillParlayIxData,
   decodeFillRfqCashoutIxData,
   decodeFillRfqParlayCashoutIxData,
   decodeFillRfqParlayIxData,
   decodeIssueBoostIxData,
   decodeIssueFreebetIxData,
   encodeFillCashoutIxData,
   encodeFillParlayCashoutIxData,
   encodeFillParlayIxData,
   encodeFillRfqBetIxData,
   encodeFillRfqCashoutIxData,
   encodeFillRfqParlayCashoutIxData,
   encodeFillRfqParlayIxData,
   encodeGetCashoutQuoteIxData,
   encodeFillCashoutQuoteIxData,
   encodeGetCashoutQuoteParlayIxData,
   encodeFillCashoutParlayQuoteIxData,
   encodeGetQuoteIxData,
   encodeGetQuoteParlayIxData,
   encodeIssueBoostIxData,
   encodeIssueFreebetIxData,
   getAddLineToNettingIxPayloadDecoder,
   getAddLineToNettingIxPayloadEncoder,
   getEventIdDecoder,
   getEventIdEncoder,
   getFillBetIxDataDecoder,
   getFillBetIxDataEncoder,
   getFillRfqBetIxDataDecoder,
   getRemoveLineFromNettingIxPayloadDecoder,
   getRemoveLineFromNettingIxPayloadEncoder,
   parseU32Prefix,
} from './codex.js';
import {
   getAta,
   getBetPda,
   getCashoutEscrowPda,
   getCashoutPda,
   getCashoutParlayPda,
   getConfigPda,
   getEventStatePda,
   getBoostPda,
   getFreebetIssuerPda,
   getFreebetPda,
   getMmConfigPda,
   getMmEncumbrancePda,
   getMmListPda,
   getMmMarketDataPda,
   getMmParlayQuoteBufferPda,
   getMmQuoteBufferPda,
   getNettingPda,
   getParlayBetPda,
   maxProxyMmsForMarketQuotes,
   numSidesForMkt,
} from './helpers.js';
import {
   BetResult,
   type BetAccountData,
   type BetFiller,
   type CashoutAccountData,
   type CashoutEscrowAccountData,
   type CashoutParlayAccountData,
   type EventId,
   type FillBetIxData,
   type FillCashoutIxData,
   type FillParlayCashoutIxData,
   type FillRfqBetIxData,
   type FillRfqCashoutIxData,
   type FillRfqParlayCashoutIxData,
   type FillRfqParlayIxData,
   type FillParlayIxData,
   type FillCashoutQuoteIxData,
   type FillCashoutParlayQuoteIxData,
   type IssueBoostIxData,
   type IssueFreebetIxData,
   type MarketId,
   type MmGetQuote,
   type MmGetQuoteParlay,
   type MmGetCashoutQuote,
   type MmGetCashoutQuoteParlay,
   type ParlayBetAccountData,
   type DecodedAggregatorInstruction,
   MAX_RFQ_PARLAY_LEGS,
   FILL_BET_IX_DATA_LEN,
   FILL_RFQ_BET_IX_DATA_LEN,
   FILL_PARLAY_IX_HEADER_LEN,
   FILL_CASHOUT_IX_DATA_LEN,
   FILL_PARLAY_CASHOUT_IX_HEADER_LEN,
   FILL_RFQ_CASHOUT_IX_DATA_LEN,
   FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN,
   FILL_RFQ_PARLAY_IX_HEADER_LEN,
   RFQ_SIGNATURE_LEN,
   EVENT_ID_WIRE_SIZE,
   NETTING_SCOPE_IX_LEN,
   ADD_LINE_TO_LIABILITY_NETTING_IX_LEN,
   REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN,
   fillParlayIxDataLen,
   fillRfqParlayIxDataLen,
   fillRfqParlayIxBodyLen,
   fillParlayCashoutIxDataLen,
} from './types.js';
import {
   validateChangeConfigStatus,
   validateEventId,
   validateFillBetIxData,
   validateFillCashoutIxData,
   validateFillParlayCashoutIxData,
   validateFillRfqBetIxData,
   validateFillRfqCashoutIxData,
   validateFillRfqParlayCashoutIxData,
   validateFillRfqParlayIxData,
   validateFillParlayIxData,
   validateFillCashoutQuoteIxData,
   validateFillCashoutParlayQuoteIxData,
   validateGetQuoteParlayIxData,
   validateGetCashoutQuoteParlayIxData,
   validateMmGetCashoutQuote,
   validateMmGetQuote,
   validateGradeBetResults,
   validateIssueBoostIxData,
   validateIssueFreebetIxData,
   validateMarketId,
   validatePositiveU64,
   validateU16,
   validateU32Number,
   validateU8,
   cashoutRequiresDelay,
   parlayCashoutRequiresDelay,
   validateGradeParlayMask,
} from './validate.js';

const ro = (address: Address) => ({ address, role: AccountRole.READONLY });
const rw = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const rs = (address: Address) => ({ address, role: AccountRole.READONLY_SIGNER });
const ws = (address: Address) => ({ address, role: AccountRole.WRITABLE_SIGNER });

async function settleFillerAccountRow(
   filler: BetFiller,
   eventId: EventId,
   operator: Address,
   mint: Address,
): Promise<readonly [Address, Address, Address, Address, Address]> {
   const mmProgram = filler.mmAddress;
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const liabilityAta = await getAta(mmEncumbrancePda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const nettingPda = filler.isPotentiallyNetted
      ? (await getNettingPda(mmProgram, eventId, operator, mint))[0]
      : SYSTEM_PROGRAM_ID;
   return [mmProgram, mmConfigPda, mmEncumbrancePda, liabilityAta, nettingPda] as const;
}

/** Router discriminators (first byte of aggregator instruction data). */
// setup — 0–5
export const INIT_PROGRAM_IX_DISCRIMINATOR = 0;
export const CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR = 1;
export const REGISTER_MM_IX_DISCRIMINATOR = 2;
export const DEREGISTER_MM_IX_DISCRIMINATOR = 3;
export const INIT_MM_MINT_VAULT_IX_DISCRIMINATOR = 4;
export const CLOSE_MM_MINT_VAULT_IX_DISCRIMINATOR = 5;
// bets — 10–13
export const FILL_BET_IX_DISCRIMINATOR = 10;
export const FILL_PARLAY_IX_DISCRIMINATOR = 11;
export const FILL_RFQ_BET_IX_DISCRIMINATOR = 12;
export const FILL_RFQ_PARLAY_IX_DISCRIMINATOR = 13;
// freebet fills — 20–23
export const FREEBET_FILL_BET_IX_DISCRIMINATOR = 20;
export const FREEBET_FILL_PARLAY_IX_DISCRIMINATOR = 21;
export const FREEBET_FILL_RFQ_BET_IX_DISCRIMINATOR = 22;
export const FREEBET_FILL_RFQ_PARLAY_IX_DISCRIMINATOR = 23;
/** MM RFQ fill CPI discs — canonical values live in `constants.ts`. */
export { MM_FILL_BET_RFQ_IX_DISCRIMINATOR, MM_FILL_PARLAY_RFQ_IX_DISCRIMINATOR };
// boosted fills — 30–33
export const BOOSTED_FILL_BET_IX_DISCRIMINATOR = 30;
export const BOOSTED_FILL_PARLAY_IX_DISCRIMINATOR = 31;
export const BOOSTED_FILL_RFQ_BET_IX_DISCRIMINATOR = 32;
export const BOOSTED_FILL_RFQ_PARLAY_IX_DISCRIMINATOR = 33;
// cashout — 90–95
export const FILL_CASHOUT_IX_DISCRIMINATOR = 90;
export const FILL_PARLAY_CASHOUT_IX_DISCRIMINATOR = 91;
export const FILL_RFQ_CASHOUT_IX_DISCRIMINATOR = 92;
export const FILL_RFQ_PARLAY_CASHOUT_IX_DISCRIMINATOR = 93;
export const CLAIM_CASHOUT_ESCROW_IX_DISCRIMINATOR = 94;
export const REVERT_CASHOUT_IX_DISCRIMINATOR = 95;
// grading — 100–101
export const GRADE_BETS_IX_DISCRIMINATOR = 100;
export const GRADE_PARLAY_IX_DISCRIMINATOR = 101;
// settle — 110–115
export const SETTLE_BET_IX_DISCRIMINATOR = 110;
export const SETTLE_PARLAY_IX_DISCRIMINATOR = 111;
export const SETTLE_FREEBET_IX_DISCRIMINATOR = 112;
export const SETTLE_FREEBET_PARLAY_IX_DISCRIMINATOR = 113;
export const SETTLE_BOOSTED_BET_IX_DISCRIMINATOR = 114;
export const SETTLE_BOOSTED_PARLAY_IX_DISCRIMINATOR = 115;
// netting PDA — 130–133
export const CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR = 130;
export const ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR = 131;
export const REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR = 132;
export const CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR = 133;
// liability account — 150
export const WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR = 150;
// promo issuer admin — 160–168
export const INIT_FREEBET_ISSUER_IX_DISCRIMINATOR = 160;
export const REMOVE_FREEBET_ISSUER_IX_DISCRIMINATOR = 161;
export const WITHDRAW_FREEBET_FUNDS_IX_DISCRIMINATOR = 162;
export const CREATE_PROMO_ISSUER_ATA_IX_DISCRIMINATOR = 163;
export const CLOSE_PROMO_ISSUER_ATA_IX_DISCRIMINATOR = 164;
export const ISSUE_FREEBET_IX_DISCRIMINATOR = 165;
export const REVOKE_FREEBET_IX_DISCRIMINATOR = 166;
export const ISSUE_BOOST_IX_DISCRIMINATOR = 167;
export const REVOKE_BOOST_IX_DISCRIMINATOR = 168;
// proxies — 200–204
export const GET_QUOTE_PROXY_IX_DISCRIMINATOR = 200;
export const GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR = 201;
export const GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR = 202;
export const GET_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR = 203;
export const GET_PARLAY_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR = 204;
// devnet
export const WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR = 254;
export const FORCE_CLOSE_PDA_IX_DISCRIMINATOR = 255;

import {
   MM_FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR,
   MM_FILL_CASHOUT_PARLAY_QUOTE_IX_DISCRIMINATOR,
   MM_GET_CASHOUT_QUOTE_IX_DISCRIMINATOR,
   MM_GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
   MM_GET_QUOTE_IX_DISCRIMINATOR,
   MM_GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
} from './constants.js';

/** Empty-payload mint-vault and promo-issuer ATA instructions. */
export type MintScopedInstruction =
   | { kind: 'initMmMintVault' }
   | { kind: 'closeMmMintVault' }
   | { kind: 'createPromoIssuerAta' }
   | { kind: 'closePromoIssuerAta' };

export type AggregatorInstructionData = DecodedAggregatorInstruction | MintScopedInstruction;

function encodeNettingScope(eventId: EventId, operator: Address, mint: Address): Uint8Array {
   const eventBytes = getEventIdEncoder().encode(eventId);
   if (eventBytes.length !== EVENT_ID_WIRE_SIZE) {
      throw new RangeError(`event id payload length ${eventBytes.length}`);
   }
   const out = new Uint8Array(NETTING_SCOPE_IX_LEN);
   out.set(eventBytes, 0);
   out.set(getAddressEncoder().encode(operator), EVENT_ID_WIRE_SIZE);
   out.set(getAddressEncoder().encode(mint), EVENT_ID_WIRE_SIZE + ADDRESS_LEN);
   return out;
}

function decodeNettingScope(bytes: Uint8Array): { eventId: EventId; operator: Address; mint: Address } {
   if (bytes.length !== NETTING_SCOPE_IX_LEN) {
      throw new RangeError(`netting scope: expected ${NETTING_SCOPE_IX_LEN} bytes`);
   }
   const operatorAt = EVENT_ID_WIRE_SIZE;
   const mintAt = EVENT_ID_WIRE_SIZE + ADDRESS_LEN;
   return {
      eventId: getEventIdDecoder().decode(bytes.subarray(0, operatorAt)),
      operator: getAddressDecoder().decode(bytes.subarray(operatorAt, mintAt)),
      mint: getAddressDecoder().decode(bytes.subarray(mintAt)),
   };
}

export function encodeAggregatorInstructionData(ix: AggregatorInstructionData): Uint8Array {
   switch (ix.kind) {
      case 'initProgram':
         return new Uint8Array([INIT_PROGRAM_IX_DISCRIMINATOR]);
      case 'changeConfigStatus': {
         if (ix.status !== 0 && ix.status !== 1) {
            throw new RangeError('changeConfigStatus.status must be 0 or 1');
         }
         return new Uint8Array([CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR, ix.status]);
      }
      case 'registerMm':
         return new Uint8Array([REGISTER_MM_IX_DISCRIMINATOR]);
      case 'deregisterMm':
         return new Uint8Array([DEREGISTER_MM_IX_DISCRIMINATOR]);
      case 'initFreebetIssuer':
         return new Uint8Array([INIT_FREEBET_ISSUER_IX_DISCRIMINATOR]);
      case 'removeFreebetIssuer':
         return new Uint8Array([REMOVE_FREEBET_ISSUER_IX_DISCRIMINATOR]);
      case 'withdrawFreebetFunds': {
         const p = getU64Encoder().encode(ix.amount);
         return concatDiscriminator(WITHDRAW_FREEBET_FUNDS_IX_DISCRIMINATOR, p);
      }
      case 'issueFreebet':
         return concatDiscriminator(ISSUE_FREEBET_IX_DISCRIMINATOR, encodeIssueFreebetIxData(ix.data));
      case 'revokeFreebet':
         return concatDiscriminator(REVOKE_FREEBET_IX_DISCRIMINATOR, getU32Encoder().encode(ix.freebetId));
      case 'issueBoost':
         return concatDiscriminator(ISSUE_BOOST_IX_DISCRIMINATOR, encodeIssueBoostIxData(ix.data));
      case 'revokeBoost':
         return concatDiscriminator(REVOKE_BOOST_IX_DISCRIMINATOR, getU32Encoder().encode(ix.boostId));
      case 'fillBet': {
         const p = getFillBetIxDataEncoder().encode(ix.data);
         if (p.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`fill bet payload length ${p.length}`);
         }
         return concatDiscriminator(FILL_BET_IX_DISCRIMINATOR, p);
      }
      case 'fillRfqBet': {
         const p = encodeFillRfqBetIxData(ix.data);
         if (p.length !== FILL_RFQ_BET_IX_DATA_LEN) {
            throw new RangeError(`fill rfq bet payload length ${p.length}`);
         }
         return concatDiscriminator(FILL_RFQ_BET_IX_DISCRIMINATOR, p);
      }
      case 'fillParlay': {
         const p = encodeFillParlayIxData(ix.data);
         const expected = fillParlayIxDataLen(ix.data.numLegs);
         if (p.length !== expected) {
            throw new RangeError(`fill parlay payload length ${p.length}`);
         }
         return concatDiscriminator(FILL_PARLAY_IX_DISCRIMINATOR, p);
      }
      case 'fillRfqParlay': {
         const p = encodeFillRfqParlayIxData(ix.data);
         const expected = fillRfqParlayIxDataLen(ix.data.numLegs);
         if (p.length !== expected) {
            throw new RangeError(`fill rfq parlay payload length ${p.length}`);
         }
         return concatDiscriminator(FILL_RFQ_PARLAY_IX_DISCRIMINATOR, p);
      }
      case 'freebetFillBet': {
         const p = getFillBetIxDataEncoder().encode(ix.data);
         if (p.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`freebet fill bet payload length ${p.length}`);
         }
         return concatDiscriminatorU32Prefix(FREEBET_FILL_BET_IX_DISCRIMINATOR, ix.freebetId, p);
      }
      case 'freebetFillParlay': {
         const p = encodeFillParlayIxData(ix.data);
         return concatDiscriminatorU32Prefix(FREEBET_FILL_PARLAY_IX_DISCRIMINATOR, ix.freebetId, p);
      }
      case 'freebetFillRfqBet': {
         const p = encodeFillRfqBetIxData(ix.data);
         return concatDiscriminatorU32Prefix(FREEBET_FILL_RFQ_BET_IX_DISCRIMINATOR, ix.freebetId, p);
      }
      case 'freebetFillRfqParlay': {
         const p = encodeFillRfqParlayIxData(ix.data);
         return concatDiscriminatorU32Prefix(FREEBET_FILL_RFQ_PARLAY_IX_DISCRIMINATOR, ix.freebetId, p);
      }
      case 'boostedFillBet': {
         const p = getFillBetIxDataEncoder().encode(ix.data);
         if (p.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`boosted fill bet payload length ${p.length}`);
         }
         return concatDiscriminatorU32Prefix(BOOSTED_FILL_BET_IX_DISCRIMINATOR, ix.boostId, p);
      }
      case 'boostedFillParlay': {
         const p = encodeFillParlayIxData(ix.data);
         return concatDiscriminatorU32Prefix(BOOSTED_FILL_PARLAY_IX_DISCRIMINATOR, ix.boostId, p);
      }
      case 'boostedFillRfqBet': {
         const p = encodeFillRfqBetIxData(ix.data);
         return concatDiscriminatorU32Prefix(BOOSTED_FILL_RFQ_BET_IX_DISCRIMINATOR, ix.boostId, p);
      }
      case 'boostedFillRfqParlay': {
         const p = encodeFillRfqParlayIxData(ix.data);
         return concatDiscriminatorU32Prefix(BOOSTED_FILL_RFQ_PARLAY_IX_DISCRIMINATOR, ix.boostId, p);
      }
      case 'fillCashout': {
         const p = encodeFillCashoutIxData(ix.data);
         return concatDiscriminator(FILL_CASHOUT_IX_DISCRIMINATOR, p);
      }
      case 'fillParlayCashout': {
         const p = encodeFillParlayCashoutIxData(ix.data);
         return concatDiscriminator(FILL_PARLAY_CASHOUT_IX_DISCRIMINATOR, p);
      }
      case 'fillRfqCashout': {
         const p = encodeFillRfqCashoutIxData(ix.data);
         return concatDiscriminator(FILL_RFQ_CASHOUT_IX_DISCRIMINATOR, p);
      }
      case 'fillRfqParlayCashout': {
         const p = encodeFillRfqParlayCashoutIxData(ix.data);
         return concatDiscriminator(FILL_RFQ_PARLAY_CASHOUT_IX_DISCRIMINATOR, p);
      }
      case 'claimCashoutEscrow':
         return new Uint8Array([CLAIM_CASHOUT_ESCROW_IX_DISCRIMINATOR]);
      case 'revertCashout':
         return new Uint8Array([REVERT_CASHOUT_IX_DISCRIMINATOR]);
      case 'getQuoteProxy': {
         const p = getFillBetIxDataEncoder().encode(ix.data);
         if (p.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`get quote proxy payload length ${p.length}`);
         }
         return concatDiscriminator(GET_QUOTE_PROXY_IX_DISCRIMINATOR, p);
      }
      case 'getParlayQuoteProxy': {
         const p = encodeFillParlayIxData(ix.data);
         const expected = fillParlayIxDataLen(ix.data.numLegs);
         if (p.length !== expected) {
            throw new RangeError(`get parlay quote proxy payload length ${p.length}`);
         }
         return concatDiscriminator(GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR, p);
      }
      case 'getMarketQuotesProxy': {
         const p = getFillBetIxDataEncoder().encode(ix.data);
         if (p.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`get market quotes proxy payload length ${p.length}`);
         }
         return concatDiscriminator(GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR, p);
      }
      case 'getCashoutQuoteProxy': {
         const p = encodeFillCashoutIxData(ix.data);
         return concatDiscriminator(GET_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR, p);
      }
      case 'getParlayCashoutQuoteProxy': {
         const p = encodeFillParlayCashoutIxData(ix.data);
         return concatDiscriminator(GET_PARLAY_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR, p);
      }
      case 'gradeBets': {
         if (ix.betResults.length === 0) {
            throw new RangeError('gradeBets requires at least one result byte');
         }
         return concatDiscriminator(GRADE_BETS_IX_DISCRIMINATOR, new Uint8Array(ix.betResults));
      }
      case 'gradeParlay': {
         if (ix.legGradeMask.length < 2 || ix.legGradeMask.length > MAX_RFQ_PARLAY_LEGS) {
            throw new RangeError(`gradeParlay mask length must be in [2, ${MAX_RFQ_PARLAY_LEGS}]`);
         }
         return concatDiscriminator(GRADE_PARLAY_IX_DISCRIMINATOR, ix.legGradeMask);
      }
      case 'settleBet':
         return new Uint8Array([SETTLE_BET_IX_DISCRIMINATOR]);
      case 'settleParlay':
         return new Uint8Array([SETTLE_PARLAY_IX_DISCRIMINATOR]);
      case 'settleFreebet':
         return new Uint8Array([SETTLE_FREEBET_IX_DISCRIMINATOR]);
      case 'settleFreebetParlay':
         return new Uint8Array([SETTLE_FREEBET_PARLAY_IX_DISCRIMINATOR]);
      case 'settleBoostedBet':
         return new Uint8Array([SETTLE_BOOSTED_BET_IX_DISCRIMINATOR]);
      case 'settleBoostedParlay':
         return new Uint8Array([SETTLE_BOOSTED_PARLAY_IX_DISCRIMINATOR]);
      case 'createNettingAccount':
         return concatDiscriminator(
            CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR,
            encodeNettingScope(ix.eventId, ix.operator, ix.mint),
         );
      case 'addLineToNettingAccount': {
         const p = getAddLineToNettingIxPayloadEncoder().encode(ix.data);
         if (p.length !== ADD_LINE_TO_LIABILITY_NETTING_IX_LEN) {
            throw new RangeError(`add line payload length ${p.length}`);
         }
         return concatDiscriminator(ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR, p);
      }
      case 'removeLineFromNettingAccount': {
         const p = getRemoveLineFromNettingIxPayloadEncoder().encode(ix.data);
         if (p.length !== REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN) {
            throw new RangeError(`remove line payload length ${p.length}`);
         }
         return concatDiscriminator(REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR, p);
      }
      case 'closeNettingAccount':
         return concatDiscriminator(
            CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR,
            encodeNettingScope(ix.eventId, ix.operator, ix.mint),
         );
      case 'withdrawFromLiabilityAccount': {
         const p = getU64Encoder().encode(ix.amount);
         return concatDiscriminator(WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR, p);
      }
      case 'writeArbitraryData': {
         return concatDiscriminator(WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR, ix.data);
      }
      case 'forceClosePda':
         return new Uint8Array([FORCE_CLOSE_PDA_IX_DISCRIMINATOR]);
      case 'initMmMintVault':
         return new Uint8Array([INIT_MM_MINT_VAULT_IX_DISCRIMINATOR]);
      case 'closeMmMintVault':
         return new Uint8Array([CLOSE_MM_MINT_VAULT_IX_DISCRIMINATOR]);
      case 'createPromoIssuerAta':
         return new Uint8Array([CREATE_PROMO_ISSUER_ATA_IX_DISCRIMINATOR]);
      case 'closePromoIssuerAta':
         return new Uint8Array([CLOSE_PROMO_ISSUER_ATA_IX_DISCRIMINATOR]);
      default: {
         const _exhaustive: never = ix;
         throw new Error(`unreachable: ${String(_exhaustive)}`);
      }
   }
}

export function decodeAggregatorInstructionData(data: ReadonlyUint8Array): AggregatorInstructionData {
   if (data.length === 0) {
      throw new RangeError('instruction data empty');
   }
   const disc = data[0]!;
   const rest = data.subarray(1);
   const restBytes = new Uint8Array(rest);
   switch (disc) {
      case INIT_PROGRAM_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('initProgram: expected empty payload');
         }
         return { kind: 'initProgram' };
      case CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR:
         if (rest.length !== 1) {
            throw new RangeError('changeConfigStatus: expected 1 byte');
         }
         if (rest[0] !== 0 && rest[0] !== 1) {
            throw new RangeError('changeConfigStatus: status must be 0 or 1');
         }
         return { kind: 'changeConfigStatus', status: rest[0] as 0 | 1 };
      case REGISTER_MM_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('registerMm: expected no payload');
         }
         return { kind: 'registerMm' };
      case DEREGISTER_MM_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('deregisterMm: expected no payload');
         }
         return { kind: 'deregisterMm' };
      case INIT_FREEBET_ISSUER_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('initFreebetIssuer: expected no payload');
         }
         return { kind: 'initFreebetIssuer' };
      case REMOVE_FREEBET_ISSUER_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('removeFreebetIssuer: expected no payload');
         }
         return { kind: 'removeFreebetIssuer' };
      case WITHDRAW_FREEBET_FUNDS_IX_DISCRIMINATOR:
         if (rest.length !== 8) {
            throw new RangeError('withdrawFreebetFunds: expected 8 bytes');
         }
         return { kind: 'withdrawFreebetFunds', amount: getU64Decoder().decode(restBytes) };
      case ISSUE_FREEBET_IX_DISCRIMINATOR:
         return { kind: 'issueFreebet', data: decodeIssueFreebetIxData(restBytes) };
      case REVOKE_FREEBET_IX_DISCRIMINATOR:
         if (rest.length !== 4) {
            throw new RangeError('revokeFreebet: expected 4 bytes');
         }
         return {
            kind: 'revokeFreebet',
            freebetId: getU32Decoder().decode(restBytes),
         };
      case ISSUE_BOOST_IX_DISCRIMINATOR:
         return { kind: 'issueBoost', data: decodeIssueBoostIxData(restBytes) };
      case REVOKE_BOOST_IX_DISCRIMINATOR:
         if (rest.length !== 4) {
            throw new RangeError('revokeBoost: expected 4 bytes');
         }
         return { kind: 'revokeBoost', boostId: getU32Decoder().decode(restBytes) };
      case FILL_BET_IX_DISCRIMINATOR:
         if (rest.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`fillBet: expected ${FILL_BET_IX_DATA_LEN} bytes`);
         }
         return { kind: 'fillBet', data: getFillBetIxDataDecoder().decode(restBytes) };
      case FILL_RFQ_BET_IX_DISCRIMINATOR:
         if (rest.length !== FILL_RFQ_BET_IX_DATA_LEN) {
            throw new RangeError(`fillRfqBet: expected ${FILL_RFQ_BET_IX_DATA_LEN} bytes`);
         }
         return { kind: 'fillRfqBet', data: getFillRfqBetIxDataDecoder().decode(restBytes) };
      case FILL_PARLAY_IX_DISCRIMINATOR:
      case GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR: {
         if (rest.length < FILL_PARLAY_IX_HEADER_LEN) {
            throw new RangeError(`fillParlay: expected at least ${FILL_PARLAY_IX_HEADER_LEN} bytes`);
         }
         const numLegs = rest[FILL_PARLAY_IX_HEADER_LEN - 1]!;
         const expected = fillParlayIxDataLen(numLegs);
         if (rest.length !== expected) {
            throw new RangeError(`fillParlay: expected ${expected} bytes for ${numLegs} legs`);
         }
         const data = decodeFillParlayIxData(restBytes);
         return disc === FILL_PARLAY_IX_DISCRIMINATOR
            ? { kind: 'fillParlay', data }
            : { kind: 'getParlayQuoteProxy', data };
      }
      case FILL_RFQ_PARLAY_IX_DISCRIMINATOR: {
         if (rest.length < FILL_RFQ_PARLAY_IX_HEADER_LEN + RFQ_SIGNATURE_LEN) {
            throw new RangeError(`fillRfqParlay: data too short (${rest.length} bytes)`);
         }
         const bodyLen = rest.length - RFQ_SIGNATURE_LEN;
         const numLegs = rest[FILL_RFQ_PARLAY_IX_HEADER_LEN - 1]!;
         const expectedBody = fillRfqParlayIxBodyLen(numLegs);
         if (bodyLen !== expectedBody) {
            throw new RangeError(`fillRfqParlay: expected body ${expectedBody} bytes for ${numLegs} legs`);
         }
         return { kind: 'fillRfqParlay', data: decodeFillRfqParlayIxData(restBytes) };
      }
      case FREEBET_FILL_BET_IX_DISCRIMINATOR: {
         const { freebetId, body } = parseU32Prefix(rest);
         if (body.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`freebetFillBet: expected ${FILL_BET_IX_DATA_LEN} bytes after id`);
         }
         return { kind: 'freebetFillBet', freebetId, data: getFillBetIxDataDecoder().decode(body) };
      }
      case FREEBET_FILL_PARLAY_IX_DISCRIMINATOR: {
         const { freebetId, body } = parseU32Prefix(rest);
         return { kind: 'freebetFillParlay', freebetId, data: decodeFillParlayIxData(body) };
      }
      case FREEBET_FILL_RFQ_BET_IX_DISCRIMINATOR: {
         const { freebetId, body } = parseU32Prefix(rest);
         return { kind: 'freebetFillRfqBet', freebetId, data: getFillRfqBetIxDataDecoder().decode(body) };
      }
      case FREEBET_FILL_RFQ_PARLAY_IX_DISCRIMINATOR: {
         const { freebetId, body } = parseU32Prefix(rest);
         return { kind: 'freebetFillRfqParlay', freebetId, data: decodeFillRfqParlayIxData(body) };
      }
      case BOOSTED_FILL_BET_IX_DISCRIMINATOR: {
         const { freebetId: boostId, body } = parseU32Prefix(rest);
         if (body.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`boostedFillBet: expected ${FILL_BET_IX_DATA_LEN} bytes after id`);
         }
         return { kind: 'boostedFillBet', boostId, data: getFillBetIxDataDecoder().decode(body) };
      }
      case BOOSTED_FILL_PARLAY_IX_DISCRIMINATOR: {
         const { freebetId: boostId, body } = parseU32Prefix(rest);
         return { kind: 'boostedFillParlay', boostId, data: decodeFillParlayIxData(body) };
      }
      case BOOSTED_FILL_RFQ_BET_IX_DISCRIMINATOR: {
         const { freebetId: boostId, body } = parseU32Prefix(rest);
         return { kind: 'boostedFillRfqBet', boostId, data: getFillRfqBetIxDataDecoder().decode(body) };
      }
      case BOOSTED_FILL_RFQ_PARLAY_IX_DISCRIMINATOR: {
         const { freebetId: boostId, body } = parseU32Prefix(rest);
         return { kind: 'boostedFillRfqParlay', boostId, data: decodeFillRfqParlayIxData(body) };
      }
      case FILL_CASHOUT_IX_DISCRIMINATOR:
      case GET_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR: {
         if (rest.length !== FILL_CASHOUT_IX_DATA_LEN) {
            throw new RangeError(`fillCashout: expected ${FILL_CASHOUT_IX_DATA_LEN} bytes`);
         }
         const data = decodeFillCashoutIxData(restBytes);
         return disc === FILL_CASHOUT_IX_DISCRIMINATOR
            ? { kind: 'fillCashout', data }
            : { kind: 'getCashoutQuoteProxy', data };
      }
      case FILL_PARLAY_CASHOUT_IX_DISCRIMINATOR:
      case GET_PARLAY_CASHOUT_QUOTE_PROXY_IX_DISCRIMINATOR: {
         if (rest.length < FILL_PARLAY_CASHOUT_IX_HEADER_LEN) {
            throw new RangeError(
               `fillParlayCashout: expected at least ${FILL_PARLAY_CASHOUT_IX_HEADER_LEN} bytes`,
            );
         }
         const numLegs = rest[FILL_PARLAY_CASHOUT_IX_HEADER_LEN - 1]!;
         const expected = fillParlayCashoutIxDataLen(numLegs);
         if (rest.length !== expected) {
            throw new RangeError(`fillParlayCashout: expected ${expected} bytes for ${numLegs} legs`);
         }
         const data = decodeFillParlayCashoutIxData(restBytes);
         return disc === FILL_PARLAY_CASHOUT_IX_DISCRIMINATOR
            ? { kind: 'fillParlayCashout', data }
            : { kind: 'getParlayCashoutQuoteProxy', data };
      }
      case FILL_RFQ_CASHOUT_IX_DISCRIMINATOR:
         if (rest.length !== FILL_RFQ_CASHOUT_IX_DATA_LEN) {
            throw new RangeError(`fillRfqCashout: expected ${FILL_RFQ_CASHOUT_IX_DATA_LEN} bytes`);
         }
         return { kind: 'fillRfqCashout', data: decodeFillRfqCashoutIxData(restBytes) };
      case FILL_RFQ_PARLAY_CASHOUT_IX_DISCRIMINATOR: {
         if (rest.length < FILL_RFQ_PARLAY_CASHOUT_IX_HEADER_LEN + RFQ_SIGNATURE_LEN) {
            throw new RangeError(`fillRfqParlayCashout: data too short (${rest.length} bytes)`);
         }
         return {
            kind: 'fillRfqParlayCashout',
            data: decodeFillRfqParlayCashoutIxData(restBytes),
         };
      }
      case CLAIM_CASHOUT_ESCROW_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('claimCashoutEscrow: expected no payload');
         }
         return { kind: 'claimCashoutEscrow' };
      case REVERT_CASHOUT_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('revertCashout: expected no payload');
         }
         return { kind: 'revertCashout' };
      case GET_QUOTE_PROXY_IX_DISCRIMINATOR:
         if (rest.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`getQuoteProxy: expected ${FILL_BET_IX_DATA_LEN} bytes`);
         }
         return { kind: 'getQuoteProxy', data: getFillBetIxDataDecoder().decode(restBytes) };
      case GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR:
         if (rest.length !== FILL_BET_IX_DATA_LEN) {
            throw new RangeError(`getMarketQuotesProxy: expected ${FILL_BET_IX_DATA_LEN} bytes`);
         }
         return { kind: 'getMarketQuotesProxy', data: getFillBetIxDataDecoder().decode(restBytes) };
      case GRADE_BETS_IX_DISCRIMINATOR:
         if (rest.length === 0) {
            throw new RangeError('gradeBets: expected at least one byte');
         }
         return { kind: 'gradeBets', betResults: new Uint8Array(rest) };
      case GRADE_PARLAY_IX_DISCRIMINATOR:
         if (rest.length < 2 || rest.length > MAX_RFQ_PARLAY_LEGS) {
            throw new RangeError(`gradeParlay mask length must be in [2, ${MAX_RFQ_PARLAY_LEGS}]`);
         }
         return { kind: 'gradeParlay', legGradeMask: new Uint8Array(rest) };
      case SETTLE_BET_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('settleBet: expected no payload');
         }
         return { kind: 'settleBet' };
      case SETTLE_PARLAY_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('settleParlay: expected no payload');
         }
         return { kind: 'settleParlay' };
      case SETTLE_FREEBET_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('settleFreebet: expected no payload');
         }
         return { kind: 'settleFreebet' };
      case SETTLE_FREEBET_PARLAY_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('settleFreebetParlay: expected no payload');
         }
         return { kind: 'settleFreebetParlay' };
      case SETTLE_BOOSTED_BET_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('settleBoostedBet: expected no payload');
         }
         return { kind: 'settleBoostedBet' };
      case SETTLE_BOOSTED_PARLAY_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('settleBoostedParlay: expected no payload');
         }
         return { kind: 'settleBoostedParlay' };
      case CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR:
         return { kind: 'createNettingAccount', ...decodeNettingScope(restBytes) };
      case ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR:
         if (rest.length !== ADD_LINE_TO_LIABILITY_NETTING_IX_LEN) {
            throw new RangeError(`addLineToNettingAccount: expected ${ADD_LINE_TO_LIABILITY_NETTING_IX_LEN} bytes`);
         }
         return { kind: 'addLineToNettingAccount', data: getAddLineToNettingIxPayloadDecoder().decode(restBytes) };
      case REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR:
         if (rest.length !== REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN) {
            throw new RangeError(
               `removeLineFromNettingAccount: expected ${REMOVE_LINE_FROM_LIABILITY_NETTING_IX_LEN} bytes`,
            );
         }
         return {
            kind: 'removeLineFromNettingAccount',
            data: getRemoveLineFromNettingIxPayloadDecoder().decode(restBytes),
         };
      case CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR:
         return { kind: 'closeNettingAccount', ...decodeNettingScope(restBytes) };
      case WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR:
         if (rest.length !== 8) {
            throw new RangeError('withdrawFromLiabilityAccount: expected 8 bytes');
         }
         return { kind: 'withdrawFromLiabilityAccount', amount: getU64Decoder().decode(restBytes) };
      case WRITE_ARBITRARY_DATA_IX_DISCRIMINATOR:
         if (rest.length === 0) {
            throw new RangeError('writeArbitraryData: expected at least one payload byte');
         }
         return { kind: 'writeArbitraryData', data: new Uint8Array(rest) };
      case FORCE_CLOSE_PDA_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('forceClosePda: expected no payload');
         }
         return { kind: 'forceClosePda' };
      case INIT_MM_MINT_VAULT_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('initMmMintVault: expected no payload');
         }
         return { kind: 'initMmMintVault' };
      case CLOSE_MM_MINT_VAULT_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('closeMmMintVault: expected no payload');
         }
         return { kind: 'closeMmMintVault' };
      case CREATE_PROMO_ISSUER_ATA_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('createPromoIssuerAta: expected no payload');
         }
         return { kind: 'createPromoIssuerAta' };
      case CLOSE_PROMO_ISSUER_ATA_IX_DISCRIMINATOR:
         if (rest.length !== 0) {
            throw new RangeError('closePromoIssuerAta: expected no payload');
         }
         return { kind: 'closePromoIssuerAta' };
      default:
         throw new RangeError(`unknown instruction discriminator: ${disc}`);
   }
}

/**
 * **`init_program`** — one-time setup of aggregator config PDA and MM list PDA (rent paid by admin).
 *
 * **Rust:** `aggregator::instructions::init_program::process` (`INIT_PROGRAM_IX_DISCRIMINATOR` = 0). No payload after router discriminator.
 *
 * @param admin - **TS:** `Address` — writable signer, becomes config admin. **Rust:** `authority` (`AccountView`, writable signer).
 * @returns **`Promise<Instruction>`** — `programAddress` = {@link AGGREGATOR_PROGRAM_ID}; accounts: admin, config PDA, MM list PDA, rent sysvar, system program.
 */
export async function getInitProgramIx(admin: Address): Promise<Instruction> {
   const [configPda] = await getConfigPda();
   const [mmListPda] = await getMmListPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(admin), rw(configPda), rw(mmListPda), ro(SYSVAR_RENT_ID), ro(SYSTEM_PROGRAM_ID)],
      data: encodeAggregatorInstructionData({ kind: 'initProgram' }),
   };
}

/**
 * **`change_config_status`** — pause (0) or unpause (1) the aggregator; must be config admin.
 *
 * **Rust:** `aggregator::instructions::change_config_status::process` (`CHANGE_CONFIG_STATUS_IX_DISCRIMINATOR` = 1). Payload: one `u8` status after discriminator.
 * 
 * @param admin - **TS:** `Address` — signer matching config admin. **Rust:** `auth` (signer).
 * @param status - **TS:** `0 | 1` — 0 = paused, 1 = unpaused. **Rust:** `u8` written to config at status offset.
 * @returns **`Promise<Instruction>`** — `programAddress` = aggregator; `data` = `[discriminator, status]`.
 */
export async function getChangeConfigStatusIx(admin: Address, status: 0 | 1): Promise<Instruction> {
   validateChangeConfigStatus(status);
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [rs(admin), rw(configPda)],
      data: encodeAggregatorInstructionData({ kind: 'changeConfigStatus', status }),
   };
}

/**
 * **`register_mm`** — register a market-maker program in the aggregator MM list and set up encumbrance + liability ATA wiring.
 *
 * **Rust:** `aggregator::instructions::register_mm::process` (`REGISTER_MM_IX_DISCRIMINATOR` = 2). No payload after router discriminator.
 *
 * @param mmAdmin - **TS:** `Address` — MM admin (writable signer). **Rust:** `mm_admin` (writable signer), verified against MM config PDA.
 * @param mmProgram - **TS:** `Address` — executable MM program id. **Rust:** `mm_program` (`Pubkey` / `Address`).
 * @returns **`Promise<Instruction>`** — 9 account metas (MM admin, MM program, MM config, aggregator config, MM list, rent sysvar, system program, quote buffer, parlay quote buffer). Open a per-mint vault with {@link getInitMmMintVaultIx}.
 */
export async function getRegisterMmIx(mmAdmin: Address, mmProgram: Address): Promise<Instruction> {
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [configPda] = await getConfigPda();
   const [mmListPda] = await getMmListPda();
   const [mmQuoteBuffer] = await getMmQuoteBufferPda(mmProgram);
   const [mmParlayQuoteBuffer] = await getMmParlayQuoteBufferPda(mmProgram);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(mmAdmin),
         ro(mmProgram),
         ro(mmConfigPda),
         ro(configPda),
         rw(mmListPda),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(mmQuoteBuffer),
         ro(mmParlayQuoteBuffer),
      ],
      data: encodeAggregatorInstructionData({ kind: 'registerMm' }),
   };
}


/**
 * **`init_mm_mint_vault`** — open one encumbrance PDA and its liability ATA for `mint`.
 *
 * **Rust:** `aggregator::instructions::init_mm_mint_vault::process` (`INIT_MM_MINT_VAULT_IX_DISCRIMINATOR` = 4). No payload.
 * The MM config ATA for this mint must already exist.
 */
export async function getInitMmMintVaultIx(
   mmAdmin: Address,
   mmProgram: Address,
   mint: Address,
): Promise<Instruction> {
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmListPda] = await getMmListPda();
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const mmLiabilityAta = await getAta(mmEncumbrancePda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(mmAdmin),
         ro(mmProgram),
         ro(mmConfigPda),
         ro(mmListPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         ro(mmTokenAta),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      data: encodeAggregatorInstructionData({ kind: 'initMmMintVault' }),
   };
}

/**
 * **`close_mm_mint_vault`** — close one mint vault without removing the MM from the list.
 *
 * **Rust:** `aggregator::instructions::close_mm_mint_vault::process` (`CLOSE_MM_MINT_VAULT_IX_DISCRIMINATOR` = 5). No payload.
 * Config ATA receives leftover tokens; `mmAdmin` receives ATA dust and PDA rent.
 */
export async function getCloseMmMintVaultIx(
   mmAdmin: Address,
   mmProgram: Address,
   mint: Address,
): Promise<Instruction> {
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const mmLiabilityAta = await getAta(mmEncumbrancePda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(mmAdmin),
         ro(mmProgram),
         ro(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         rw(mmTokenAta),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      data: encodeAggregatorInstructionData({ kind: 'closeMmMintVault' }),
   };
}

/**
 * **`deregister_mm`** — admin tears down an MM registration (inverse of {@link getRegisterMmIx}).
 *
 * **Rust:** `aggregator::instructions::deregister_mm::process` (`DEREGISTER_MM_IX_DISCRIMINATOR` = 3). No payload after router discriminator.
 *
 * @param aggregatorAdmin - **TS:** `Address` — aggregator config authority (writable signer). **Rust:** `aggregator_admin`.
 * @param mmAdmin - **TS:** `Address` — MM admin (writable); receives closed-account rent. **Rust:** `mm_admin`, verified against MM config PDA.
 * @param mmProgram - **TS:** `Address` — MM program id to remove from the list.
 * @returns **`Promise<Instruction>`** — 16 account metas; liability tokens move to MM collateral ATA, then encumbrance PDA and liability ATA close.
 */
export async function getDeregisterMmIx(
   aggregatorAdmin: Address,
   mmAdmin: Address,
   mmProgram: Address,
   mint: Address,
): Promise<Instruction> {
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const mmLiabilityAta = await getAta(
      mmEncumbrancePda,
      mint,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const [configPda] = await getConfigPda();
   const [mmListPda] = await getMmListPda();
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [mmQuoteBuffer] = await getMmQuoteBufferPda(mmProgram);
   const [mmParlayQuoteBuffer] = await getMmParlayQuoteBufferPda(mmProgram);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(aggregatorAdmin),
         rw(mmAdmin),
         ro(mmProgram),
         ro(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         ro(configPda),
         rw(mmListPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         rw(mmTokenAta),
         ro(mmQuoteBuffer),
         ro(mmParlayQuoteBuffer),
      ],
      data: encodeAggregatorInstructionData({ kind: 'deregisterMm' }),
   };
}

/**
 * **`init_freebet_issuer`** — create the promo issuer PDA only (auth pays rent).
 *
 * **Rust:** `promo_issuer::process_init` (`INIT_FREEBET_ISSUER_IX_DISCRIMINATOR` = 160). No payload.
 * Open a per-mint ATA with {@link getCreatePromoIssuerAtaIx}.
 */
export async function getInitFreebetIssuerIx(auth: Address): Promise<Instruction> {
   const [issuerPda] = await getFreebetIssuerPda(auth);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(auth),
         rw(issuerPda),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      data: encodeAggregatorInstructionData({ kind: 'initFreebetIssuer' }),
   };
}

/**
 * **`remove_freebet_issuer`** — close the issuer PDA (`open_count` must be 0).
 *
 * **Rust:** `promo_issuer::process_remove` (`REMOVE_FREEBET_ISSUER_IX_DISCRIMINATOR` = 161). No payload.
 * Close every issuer ATA with {@link getClosePromoIssuerAtaIx} first.
 */
export async function getRemoveFreebetIssuerIx(auth: Address): Promise<Instruction> {
   const [issuerPda] = await getFreebetIssuerPda(auth);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(auth), rw(issuerPda)],
      data: encodeAggregatorInstructionData({ kind: 'removeFreebetIssuer' }),
   };
}

/**
 * **`create_promo_issuer_ata`** — create the issuer ATA for one mint.
 *
 * **Rust:** `promo_issuer::process_create_ata` (`CREATE_PROMO_ISSUER_ATA_IX_DISCRIMINATOR` = 163). No payload.
 */
export async function getCreatePromoIssuerAtaIx(auth: Address, mint: Address): Promise<Instruction> {
   const [issuerPda] = await getFreebetIssuerPda(auth);
   const issuerAta = await getAta(issuerPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(auth),
         ro(issuerPda),
         rw(issuerAta),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      data: encodeAggregatorInstructionData({ kind: 'createPromoIssuerAta' }),
   };
}

/**
 * **`close_promo_issuer_ata`** — drain and close one issuer ATA.
 *
 * **Rust:** `promo_issuer::process_close_ata` (`CLOSE_PROMO_ISSUER_ATA_IX_DISCRIMINATOR` = 164).
 * Accounts: auth, issuer PDA, issuer ATA, dest ATA, mint, token program.
 */
export async function getClosePromoIssuerAtaIx(auth: Address, mint: Address): Promise<Instruction> {
   const [issuerPda] = await getFreebetIssuerPda(auth);
   const issuerAta = await getAta(issuerPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const destAta = await getAta(auth, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(auth),
         ro(issuerPda),
         rw(issuerAta),
         rw(destAta),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      data: encodeAggregatorInstructionData({ kind: 'closePromoIssuerAta' }),
   };
}

/**
 * **`withdraw_freebet_funds`** — transfer `amount` from issuer ATA to auth ATA (PDA signer).
 */
export async function getWithdrawFreebetFundsIx(auth: Address, mint: Address, amount: bigint): Promise<Instruction> {
   validatePositiveU64(amount, 'amount');
   const [issuerPda] = await getFreebetIssuerPda(auth);
   const issuerAta = await getAta(issuerPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const destAta = await getAta(auth, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(auth),
         ro(issuerPda),
         rw(issuerAta),
         rw(destAta),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      data: encodeAggregatorInstructionData({ kind: 'withdrawFreebetFunds', amount }),
   };
}

/**
 * **`issue_freebet`** — create a freebet PDA for `user` (not a signer). Increments issuer `open_count`.
 */
export async function getIssueFreebetIx(
   auth: Address,
   user: Address,
   data: IssueFreebetIxData,
   mint: Address,
): Promise<Instruction> {
   validateIssueFreebetIxData(data);
   const [issuerPda] = await getFreebetIssuerPda(auth);
   const [freebetPda] = await getFreebetPda(auth, mint, data.freebetId);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(auth),
         rw(issuerPda),
         ro(user),
         rw(freebetPda),
         ro(mint),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
      ],
      data: encodeAggregatorInstructionData({ kind: 'issueFreebet', data }),
   };
}

/**
 * **`revoke_freebet`** — close an Available freebet PDA; rent to auth.
 */
export async function getRevokeFreebetIx(auth: Address, mint: Address, freebetId: number): Promise<Instruction> {
   validateU32Number(freebetId, 'freebetId');
   if (freebetId === 0) {
      throw new RangeError('freebetId 0 is reserved');
   }
   const [issuerPda] = await getFreebetIssuerPda(auth);
   const [freebetPda] = await getFreebetPda(auth, mint, freebetId);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(auth), rw(issuerPda), rw(freebetPda)],
      data: encodeAggregatorInstructionData({ kind: 'revokeFreebet', freebetId }),
   };
}

/**
 * **`issue_boost`** — create a boost PDA for `user`. Increments issuer `open_count`.
 */
export async function getIssueBoostIx(
   auth: Address,
   user: Address,
   data: IssueBoostIxData,
   mint: Address,
): Promise<Instruction> {
   validateIssueBoostIxData(data);
   const [issuerPda] = await getFreebetIssuerPda(auth);
   const [boostPda] = await getBoostPda(auth, mint, data.boostId);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(auth),
         rw(issuerPda),
         ro(user),
         rw(boostPda),
         ro(mint),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
      ],
      data: encodeAggregatorInstructionData({ kind: 'issueBoost', data }),
   };
}

/**
 * **`revoke_boost`** — close an Available boost PDA; rent to auth.
 */
export async function getRevokeBoostIx(auth: Address, mint: Address, boostId: number): Promise<Instruction> {
   validateU32Number(boostId, 'boostId');
   if (boostId === 0) {
      throw new RangeError('boostId 0 is reserved');
   }
   const [issuerPda] = await getFreebetIssuerPda(auth);
   const [boostPda] = await getBoostPda(auth, mint, boostId);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(auth), rw(issuerPda), rw(boostPda)],
      data: encodeAggregatorInstructionData({ kind: 'revokeBoost', boostId }),
   };
}

async function cashoutEscrowAccountMetas(
   user: Address,
   origBetId: bigint,
   delay: boolean,
   mint: Address,
): Promise<[{ address: Address; role: AccountRole }, { address: Address; role: AccountRole }]> {
   if (!delay) {
      return [rw(SYSTEM_PROGRAM_ID), rw(SYSTEM_PROGRAM_ID)];
   }
   const [escrowPda] = await getCashoutEscrowPda(user, origBetId);
   return [rw(escrowPda), rw(await getAta(escrowPda, mint))];
}

/**
 * **`fill_bet`** — CPI MM `get_quote` / `fill_bet_quote`, open bet PDA + bet ATA, move collateral per best quotes (up to {@link MAX_NUMBER_OF_MMS} MMs).
 *
 * **Rust:** `aggregator::instructions::fill_bet::fill_bet` (`FILL_BET_IX_DISCRIMINATOR` = 10). Parsed body: `bet_id: u64`, `MarketId`, `side: u8`, `amount: u64`, `min_odds_scaled: u32`, `event_state_sequence: u16`, `event_game_state: EventGameState`.
 *
 * @param fill - **TS:** {@link FillBetIxData} — wire-aligned bet request. **Rust:** same fields as `FillBetIxData::decode`.
 * @param feepayer - **TS:** `Address` — writable signer paying rent and fees, including extra netting-line rent if a fill inserts a new line. **Rust:** `feepayer` (writable signer).
 * @param user - **TS:** `Address` — bet owner (readonly signer). **Rust:** `user` (readonly signer).
 * @param mmPrograms - **TS:** `readonly Address[]` — one MM program id per quote leg (1..=MAX_NUMBER_OF_MMS). **Rust:** repeated 9-account MM slice per program (`mm_program` … `mm_netting_pda`). Quote buffer PDA derived per MM in TS (`mm_quote_buffer` seed on MM program).
 * @param hasActiveNetting - **TS:** `boolean` — `true` derives each MM’s netting PDA; `false` passes the system program as the netting slot.
 * @returns **`Promise<Instruction>`** — base 12 accounts + 9×N MM accounts; `data` = router discriminator + encoded `fill`. Mint is `fill.marketId.mint`.
 */
export async function getFillBetIx(
   fill: FillBetIxData,
   feepayer: Address,
   user: Address,
   mmPrograms: readonly Address[],
   hasActiveNetting: boolean,
): Promise<Instruction> {
   validateFillBetIxData(fill, 'fill');
   if (mmPrograms.length === 0 || mmPrograms.length > MAX_NUMBER_OF_MMS) {
      throw new RangeError(`mmPrograms.length must be in [1, ${MAX_NUMBER_OF_MMS}]`);
   }
   const mint = fill.marketId.mint;
   const userAta = await getAta(user, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [betPda] = await getBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const accounts: { address: Address; role: AccountRole }[] = [];
   const baseAccounts = [
      ws(feepayer),
      rs(user),
      rw(userAta),
      rw(betPda),
      rw(betAta),
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SYSVAR_RENT_ID),
      ro(SYSTEM_PROGRAM_ID),
      ro(CLOCK_ID)
   ];
   accounts.push(...baseAccounts);
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [eventStatePda] = await getEventStatePda(mmProgram, fill.marketId.eventId);
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, fill.marketId);
      const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
      const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
      const liabilityAta = await getAta(
         mmEncumbrancePda,
         mint,
         SPL_TOKEN_PROGRAM_ID,
         SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
      const nettingPda = hasActiveNetting
         ? (await getNettingPda(mmProgram, fill.marketId.eventId, fill.marketId.operator, mint))[0]
         : SYSTEM_PROGRAM_ID;
      accounts.push(
         ro(mmProgram),
         rw(mmConfigPda),
         rw(eventStatePda),
         rw(marketDataPda),
         rw(mmQuoteBufferPda),
         rw(mmEncumbrancePda),
         rw(liabilityAta),
         rw(mmTokenAta),
         rw(nettingPda),
      );
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts,
      data: encodeAggregatorInstructionData({
         kind: 'fillBet',
         data: fill,
      }),
   };
}

/**
 * **`fill_rfq_bet`** — verify MM ed25519 RFQ quote, CPI MM `fill_bet_rfq`, open bet PDA (single MM, no quote buffer).
 *
 * @param user - **TS:** `Address` — bet owner (readonly signer). **Rust:** `user` (readonly signer).
 */
export async function getFillRfqBetIx(
   fill: FillRfqBetIxData,
   feepayer: Address,
   user: Address,
   mmProgram: Address,
   hasActiveNetting: boolean,
): Promise<Instruction> {
   validateFillRfqBetIxData(fill, 'fill');
   const mint = fill.marketId.mint;
   const userAta = await getAta(user, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [betPda] = await getBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [eventStatePda] = await getEventStatePda(mmProgram, fill.marketId.eventId);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, fill.marketId);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const liabilityAta = await getAta(
      mmEncumbrancePda,
      mint,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const nettingPda = hasActiveNetting
      ? (await getNettingPda(mmProgram, fill.marketId.eventId, fill.marketId.operator, mint))[0]
      : SYSTEM_PROGRAM_ID;
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(feepayer),
         rs(user),
         rw(userAta),
         rw(betPda),
         rw(betAta),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
         ro(mmProgram),
         rw(mmConfigPda),
         rw(eventStatePda),
         rw(marketDataPda),
         rw(mmEncumbrancePda),
         rw(liabilityAta),
         rw(mmTokenAta),
         rw(nettingPda),
      ],
      data: encodeAggregatorInstructionData({
         kind: 'fillRfqBet',
         data: fill,
      }),
   };
}

/**
 * **`fill_rfq_parlay`** — verify MM ed25519 RFQ parlay quote, CPI MM `fill_parlay_rfq`, open parlay bet PDA (single MM).
 * No per-leg market-data / event-state accounts — legs are covered by the signed RFQ message.
 */
export async function getFillRfqParlayIx(
   fill: FillRfqParlayIxData,
   feepayer: Address,
   user: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validateFillRfqParlayIxData(fill, 'fill');
   const mint = fill.legs[0]!.marketId.mint;
   const userAta = await getAta(user, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [betPda] = await getParlayBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const liabilityAta = await getAta(
      mmEncumbrancePda,
      mint,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(feepayer),
         rs(user),
         rw(userAta),
         rw(betPda),
         rw(betAta),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
         ro(mmProgram),
         rw(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(liabilityAta),
         rw(mmTokenAta),
      ],
      data: encodeAggregatorInstructionData({
         kind: 'fillRfqParlay',
         data: fill,
      }),
   };
}

function requireFreebetId(freebetId: number): void {
   validateU32Number(freebetId, 'freebetId');
   if (freebetId === 0) {
      throw new RangeError('freebetId 0 is reserved for non-freebet tickets');
   }
}

/**
 * **`freebet_fill_bet`** — auction fill funded from the issuer ATA (`freebet_id` prefix + `FillBetIxData`).
 *
 * **Rust:** `aggregator::instructions::freebet_fill_bet::process` (`FREEBET_FILL_BET_IX_DISCRIMINATOR` = 20).
 * Accounts: 15 fixed + 9 × N MM accounts. Same as {@link getFillBetIx} except `user_ata` is replaced
 * by `issuer_pda` (readonly), `issuer_ata` (writable) and `freebet_pda` (writable) at indices 2–4.
 */
export async function getFreebetFillBetIx(
   fill: FillBetIxData,
   feepayer: Address,
   user: Address,
   issuerAuth: Address,
   freebetId: number,
   mmPrograms: readonly Address[],
   hasActiveNetting: boolean,
): Promise<Instruction> {
   requireFreebetId(freebetId);
   validateFillBetIxData(fill, 'fill');
   if (mmPrograms.length === 0 || mmPrograms.length > MAX_NUMBER_OF_MMS) {
      throw new RangeError(`mmPrograms.length must be in [1, ${MAX_NUMBER_OF_MMS}]`);
   }
   const mint = fill.marketId.mint;
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [freebetPda] = await getFreebetPda(issuerAuth, mint, freebetId);
   const [betPda] = await getBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const accounts: { address: Address; role: AccountRole }[] = [
      ws(feepayer),
      rs(user),
      ro(issuerPda),
      rw(issuerAta),
      rw(freebetPda),
      rw(betPda),
      rw(betAta),
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SYSVAR_RENT_ID),
      ro(SYSTEM_PROGRAM_ID),
      ro(CLOCK_ID),
   ];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [eventStatePda] = await getEventStatePda(mmProgram, fill.marketId.eventId);
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, fill.marketId);
      const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
      const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
      const liabilityAta = await getAta(
         mmEncumbrancePda,
         mint,
         SPL_TOKEN_PROGRAM_ID,
         SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
      const nettingPda = hasActiveNetting
         ? (await getNettingPda(mmProgram, fill.marketId.eventId, fill.marketId.operator, mint))[0]
         : SYSTEM_PROGRAM_ID;
      accounts.push(
         ro(mmProgram),
         rw(mmConfigPda),
         rw(eventStatePda),
         rw(marketDataPda),
         rw(mmQuoteBufferPda),
         rw(mmEncumbrancePda),
         rw(liabilityAta),
         rw(mmTokenAta),
         rw(nettingPda),
      );
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts,
      data: encodeAggregatorInstructionData({ kind: 'freebetFillBet', freebetId, data: fill }),
   };
}

/**
 * **`freebet_fill_parlay`** — parlay auction fill funded from the issuer ATA.
 *
 * **Rust:** `aggregator::instructions::freebet_fill_parlay::process` (`FREEBET_FILL_PARLAY_IX_DISCRIMINATOR` = 21).
 * Accounts: 15 fixed + 6 + 2 × L MM accounts. Same as {@link getFillParlayIx} except `user_ata` is replaced
 * by `issuer_pda` (readonly), `issuer_ata` (writable) and `freebet_pda` (writable) at indices 2–4.
 */
export async function getFreebetFillParlayIx(
   fill: FillParlayIxData,
   feepayer: Address,
   user: Address,
   issuerAuth: Address,
   freebetId: number,
   mmProgram: Address,
): Promise<Instruction> {
   requireFreebetId(freebetId);
   validateFillParlayIxData(fill, 'fill');
   const mint = fill.legs[0]!.marketId.mint;
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [freebetPda] = await getFreebetPda(issuerAuth, mint, freebetId);
   const [betPda] = await getParlayBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const liabilityAta = await getAta(
      mmEncumbrancePda,
      mint,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const accounts = [
      ws(feepayer),
      rs(user),
      ro(issuerPda),
      rw(issuerAta),
      rw(freebetPda),
      rw(betPda),
      rw(betAta),
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SYSVAR_RENT_ID),
      ro(SYSTEM_PROGRAM_ID),
      ro(CLOCK_ID),
      ro(mmProgram),
      rw(mmConfigPda),
      rw(mmParlayQuoteBufferPda),
      rw(mmEncumbrancePda),
      rw(liabilityAta),
      rw(mmTokenAta),
   ];
   for (let legIdx = 0; legIdx < fill.numLegs; legIdx++) {
      const leg = fill.legs[legIdx]!;
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, leg.marketId);
      const [eventStatePda] = await getEventStatePda(mmProgram, leg.marketId.eventId);
      accounts.push(ro(marketDataPda), ro(eventStatePda));
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts,
      data: encodeAggregatorInstructionData({ kind: 'freebetFillParlay', freebetId, data: fill }),
   };
}

/**
 * **`freebet_fill_rfq_bet`** — RFQ single fill funded from the issuer ATA. Signed RFQ payload is unprefixed.
 *
 * **Rust:** `aggregator::instructions::freebet_fill_rfq_bet::process` (`FREEBET_FILL_RFQ_BET_IX_DISCRIMINATOR` = 22).
 * Accounts: 15 fixed + 8 MM accounts. Same as {@link getFillRfqBetIx} except `user_ata` is replaced
 * by `issuer_pda` (readonly), `issuer_ata` (writable) and `freebet_pda` (writable) at indices 2–4.
 */
export async function getFreebetFillRfqBetIx(
   fill: FillRfqBetIxData,
   feepayer: Address,
   user: Address,
   issuerAuth: Address,
   freebetId: number,
   mmProgram: Address,
   hasActiveNetting: boolean,
): Promise<Instruction> {
   requireFreebetId(freebetId);
   validateFillRfqBetIxData(fill, 'fill');
   const mint = fill.marketId.mint;
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [freebetPda] = await getFreebetPda(issuerAuth, mint, freebetId);
   const [betPda] = await getBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [eventStatePda] = await getEventStatePda(mmProgram, fill.marketId.eventId);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, fill.marketId);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const liabilityAta = await getAta(
      mmEncumbrancePda,
      mint,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const nettingPda = hasActiveNetting
      ? (await getNettingPda(mmProgram, fill.marketId.eventId, fill.marketId.operator, mint))[0]
      : SYSTEM_PROGRAM_ID;
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(feepayer),
         rs(user),
         ro(issuerPda),
         rw(issuerAta),
         rw(freebetPda),
         rw(betPda),
         rw(betAta),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
         ro(mmProgram),
         rw(mmConfigPda),
         rw(eventStatePda),
         rw(marketDataPda),
         rw(mmEncumbrancePda),
         rw(liabilityAta),
         rw(mmTokenAta),
         rw(nettingPda),
      ],
      data: encodeAggregatorInstructionData({ kind: 'freebetFillRfqBet', freebetId, data: fill }),
   };
}

/**
 * **`freebet_fill_rfq_parlay`** — RFQ parlay fill funded from the issuer ATA. Signed RFQ payload is unprefixed.
 *
 * **Rust:** `aggregator::instructions::freebet_fill_rfq_parlay::process` (`FREEBET_FILL_RFQ_PARLAY_IX_DISCRIMINATOR` = 23).
 * Accounts: 15 fixed + 6 MM accounts. Same as {@link getFillRfqParlayIx} except `user_ata` is replaced
 * by `issuer_pda` (readonly), `issuer_ata` (writable) and `freebet_pda` (writable) at indices 2–4.
 */
export async function getFreebetFillRfqParlayIx(
   fill: FillRfqParlayIxData,
   feepayer: Address,
   user: Address,
   issuerAuth: Address,
   freebetId: number,
   mmProgram: Address,
): Promise<Instruction> {
   requireFreebetId(freebetId);
   validateFillRfqParlayIxData(fill, 'fill');
   const mint = fill.legs[0]!.marketId.mint;
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [freebetPda] = await getFreebetPda(issuerAuth, mint, freebetId);
   const [betPda] = await getParlayBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const liabilityAta = await getAta(
      mmEncumbrancePda,
      mint,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(feepayer),
         rs(user),
         ro(issuerPda),
         rw(issuerAta),
         rw(freebetPda),
         rw(betPda),
         rw(betAta),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
         ro(mmProgram),
         rw(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(liabilityAta),
         rw(mmTokenAta),
      ],
      data: encodeAggregatorInstructionData({ kind: 'freebetFillRfqParlay', freebetId, data: fill }),
   };
}

/**
 * **`boosted_fill_bet`** — user pays the stake. Issuer ATA is checked and not debited.
 * Accounts: `fill_bet`'s 12, with issuer PDA, issuer ATA, and boost PDA inserted after `user_ata`.
 */
export async function getBoostedFillBetIx(
   fill: FillBetIxData,
   feepayer: Address,
   user: Address,
   issuerAuth: Address,
   boostId: number,
   mmPrograms: readonly Address[],
   hasActiveNetting: boolean,
): Promise<Instruction> {
   requireFreebetId(boostId);
   validateFillBetIxData(fill, 'fill');
   if (mmPrograms.length === 0 || mmPrograms.length > MAX_NUMBER_OF_MMS) {
      throw new RangeError(`mmPrograms.length must be in [1, ${MAX_NUMBER_OF_MMS}]`);
   }
   const mint = fill.marketId.mint;
   const userAta = await getAta(user, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [boostPda] = await getBoostPda(issuerAuth, mint, boostId);
   const [betPda] = await getBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const accounts: { address: Address; role: AccountRole }[] = [
      ws(feepayer),
      rs(user),
      rw(userAta),
      ro(issuerPda),
      ro(issuerAta),
      rw(boostPda),
      rw(betPda),
      rw(betAta),
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SYSVAR_RENT_ID),
      ro(SYSTEM_PROGRAM_ID),
      ro(CLOCK_ID),
   ];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [eventStatePda] = await getEventStatePda(mmProgram, fill.marketId.eventId);
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, fill.marketId);
      const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
      const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
      const liabilityAta = await getAta(mmEncumbrancePda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
      const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
      const nettingPda = hasActiveNetting
         ? (await getNettingPda(mmProgram, fill.marketId.eventId, fill.marketId.operator, mint))[0]
         : SYSTEM_PROGRAM_ID;
      accounts.push(
         ro(mmProgram),
         rw(mmConfigPda),
         rw(eventStatePda),
         rw(marketDataPda),
         rw(mmQuoteBufferPda),
         rw(mmEncumbrancePda),
         rw(liabilityAta),
         rw(mmTokenAta),
         rw(nettingPda),
      );
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts,
      data: encodeAggregatorInstructionData({ kind: 'boostedFillBet', boostId, data: fill }),
   };
}

/**
 * **`boosted_fill_parlay`** — user pays the stake. Same fixed prefix as {@link getBoostedFillBetIx}.
 */
export async function getBoostedFillParlayIx(
   fill: FillParlayIxData,
   feepayer: Address,
   user: Address,
   issuerAuth: Address,
   boostId: number,
   mmProgram: Address,
): Promise<Instruction> {
   requireFreebetId(boostId);
   validateFillParlayIxData(fill, 'fill');
   const mint = fill.legs[0]!.marketId.mint;
   const userAta = await getAta(user, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [boostPda] = await getBoostPda(issuerAuth, mint, boostId);
   const [betPda] = await getParlayBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const liabilityAta = await getAta(mmEncumbrancePda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const accounts = [
      ws(feepayer),
      rs(user),
      rw(userAta),
      ro(issuerPda),
      ro(issuerAta),
      rw(boostPda),
      rw(betPda),
      rw(betAta),
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SYSVAR_RENT_ID),
      ro(SYSTEM_PROGRAM_ID),
      ro(CLOCK_ID),
      ro(mmProgram),
      rw(mmConfigPda),
      rw(mmParlayQuoteBufferPda),
      rw(mmEncumbrancePda),
      rw(liabilityAta),
      rw(mmTokenAta),
   ];
   for (let legIdx = 0; legIdx < fill.numLegs; legIdx++) {
      const leg = fill.legs[legIdx]!;
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, leg.marketId);
      const [eventStatePda] = await getEventStatePda(mmProgram, leg.marketId.eventId);
      accounts.push(ro(marketDataPda), ro(eventStatePda));
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts,
      data: encodeAggregatorInstructionData({ kind: 'boostedFillParlay', boostId, data: fill }),
   };
}

/**
 * **`boosted_fill_rfq_bet`** — user pays the stake. Signed RFQ payload is unprefixed.
 */
export async function getBoostedFillRfqBetIx(
   fill: FillRfqBetIxData,
   feepayer: Address,
   user: Address,
   issuerAuth: Address,
   boostId: number,
   mmProgram: Address,
   hasActiveNetting: boolean,
): Promise<Instruction> {
   requireFreebetId(boostId);
   validateFillRfqBetIxData(fill, 'fill');
   const mint = fill.marketId.mint;
   const userAta = await getAta(user, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [boostPda] = await getBoostPda(issuerAuth, mint, boostId);
   const [betPda] = await getBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [eventStatePda] = await getEventStatePda(mmProgram, fill.marketId.eventId);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, fill.marketId);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const liabilityAta = await getAta(mmEncumbrancePda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const nettingPda = hasActiveNetting
      ? (await getNettingPda(mmProgram, fill.marketId.eventId, fill.marketId.operator, mint))[0]
      : SYSTEM_PROGRAM_ID;
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(feepayer),
         rs(user),
         rw(userAta),
         ro(issuerPda),
         ro(issuerAta),
         rw(boostPda),
         rw(betPda),
         rw(betAta),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
         ro(mmProgram),
         rw(mmConfigPda),
         rw(eventStatePda),
         rw(marketDataPda),
         rw(mmEncumbrancePda),
         rw(liabilityAta),
         rw(mmTokenAta),
         rw(nettingPda),
      ],
      data: encodeAggregatorInstructionData({ kind: 'boostedFillRfqBet', boostId, data: fill }),
   };
}

/**
 * **`boosted_fill_rfq_parlay`** — user pays the stake. Signed RFQ payload is unprefixed.
 */
export async function getBoostedFillRfqParlayIx(
   fill: FillRfqParlayIxData,
   feepayer: Address,
   user: Address,
   issuerAuth: Address,
   boostId: number,
   mmProgram: Address,
): Promise<Instruction> {
   requireFreebetId(boostId);
   validateFillRfqParlayIxData(fill, 'fill');
   const mint = fill.legs[0]!.marketId.mint;
   const userAta = await getAta(user, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [boostPda] = await getBoostPda(issuerAuth, mint, boostId);
   const [betPda] = await getParlayBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const liabilityAta = await getAta(mmEncumbrancePda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(feepayer),
         rs(user),
         rw(userAta),
         ro(issuerPda),
         ro(issuerAta),
         rw(boostPda),
         rw(betPda),
         rw(betAta),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
         ro(mmProgram),
         rw(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(liabilityAta),
         rw(mmTokenAta),
      ],
      data: encodeAggregatorInstructionData({ kind: 'boostedFillRfqParlay', boostId, data: fill }),
   };
}

/**
 * **`fill_cashout`** — auction cashout of a single bet; creates cashout ticket (+ optional live escrow).
 * `fillingMm` must be the expected winning MM (cashout PDA seeds); requote via proxy if unsure.
 * Fixed accounts: **17** (`ticket_feepayer` at index 1). Delay is derived from the ticket + quoted
 * sequence (`cashoutRequiresDelay`). Quoted `eventStateSequence` must be ≥ the ticket sequence.
 * The aggregator spends free liability toward the quoted payment, then CPIs the MM with
 * `amount_to_send` remainder (still CPIs when remainder is 0 so the quote buffer is marked used).
 *
 * @param bet - **TS:** {@link BetAccountData} — original ticket; `bet.feepayer` is the rent dest on full pregame close.
 */
export async function getFillCashoutIx(
   fill: FillCashoutIxData,
   feepayer: Address,
   bet: BetAccountData,
   marketId: MarketId,
   fillingMm: Address,
   mmPrograms: readonly Address[],
): Promise<Instruction> {
   validateFillCashoutIxData(fill, 'fill', {
      isPregame: marketId.isPregame,
      origEventStateSequence: bet.eventStateSequence,
   });
   validateMarketId(marketId, 'marketId');
   if (bet.betId !== fill.origBetId) {
      throw new RangeError('bet.betId must equal fill.origBetId');
   }
   if (bet.promoType === PROMO_FREEBET || bet.promoType === PROMO_BOOST) {
      throw new RangeError('cannot cash out a promo ticket');
   }
   const mint = bet.marketId.mint;
   if (mmPrograms.length === 0 || mmPrograms.length > MAX_NUMBER_OF_MMS) {
      throw new RangeError(`mmPrograms.length must be in [1, ${MAX_NUMBER_OF_MMS}]`);
   }
   if (!mmPrograms.includes(fillingMm)) {
      throw new RangeError('fillingMm must be included in mmPrograms');
   }
   const user = bet.owner;
   const userAta = await getAta(user, mint);
   const [betPda] = await getBetPda(user, fill.origBetId);
   const betAta = await getAta(betPda, mint);
   const [cashoutPda] = await getCashoutPda(fillingMm, fill.cashoutId);
   const cashoutAta = await getAta(cashoutPda, mint);
   const delay = cashoutRequiresDelay(
      marketId.isPregame,
      bet.eventStateSequence,
      fill.eventStateSequence,
   );
   const [escrowPdaMeta, escrowAtaMeta] = await cashoutEscrowAccountMetas(
      user,
      fill.origBetId,
      delay,
      mint,
   );
   const [configPda] = await getConfigPda();
   const accounts = [
      ws(feepayer),
      rw(bet.feepayer),
      rs(user),
      rw(userAta),
      rw(betPda),
      rw(betAta),
      rw(cashoutPda),
      rw(cashoutAta),
      escrowPdaMeta,
      escrowAtaMeta,
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SYSVAR_RENT_ID),
      ro(SYSTEM_PROGRAM_ID),
      ro(CLOCK_ID),
   ];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [eventStatePda] = await getEventStatePda(mmProgram, marketId.eventId);
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, marketId);
      const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
      const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
      const mmLiabilityAta = await getAta(mmEncumbrancePda, mint);
      const mmTokenAta = await getAta(mmConfigPda, mint);
      accounts.push(
         ro(mmProgram),
         rw(mmConfigPda),
         rw(eventStatePda),
         rw(marketDataPda),
         rw(mmQuoteBufferPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         rw(mmTokenAta),
      );
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts,
      data: encodeAggregatorInstructionData({ kind: 'fillCashout', data: fill }),
   };
}

/**
 * **`fill_parlay_cashout`** — single-MM auction cashout of a parlay ticket.
 * Same first **17** accounts as {@link getFillCashoutIx}, then 6 MM accounts + 2 per leg.
 * Free liability covers as much of the quoted payment as possible; the MM CPI sends the remainder.
 *
 * @param parlay - **TS:** {@link ParlayBetAccountData} — original ticket; `parlay.feepayer` is the rent dest on full pregame close.
 */
export async function getFillParlayCashoutIx(
   fill: FillParlayCashoutIxData,
   feepayer: Address,
   parlay: ParlayBetAccountData,
   marketIds: MarketId[],
   fillingMm: Address,
): Promise<Instruction> {
   if (parlay.legs.length !== fill.numLegs) {
      throw new RangeError('parlay.legs.length must equal fill.numLegs');
   }
   validateFillParlayCashoutIxData(fill, 'fill', {
      origLegSequences: parlay.legs.map((leg) => leg.eventStateSequence),
   });
   if (parlay.betId !== fill.origBetId) {
      throw new RangeError('parlay.betId must equal fill.origBetId');
   }
   if (parlay.promoType === PROMO_FREEBET || parlay.promoType === PROMO_BOOST) {
      throw new RangeError('cannot cash out a promo ticket');
   }
   const mint = parlay.legs[0]!.marketId.mint;
   if (marketIds.length !== fill.numLegs) {
      throw new RangeError('marketIds.length must equal fill.numLegs');
   }
   const user = parlay.owner;
   const userAta = await getAta(user, mint);
   const [betPda] = await getParlayBetPda(user, fill.origBetId);
   const betAta = await getAta(betPda, mint);
   const [cashoutPda] = await getCashoutParlayPda(fillingMm, fill.cashoutId);
   const cashoutAta = await getAta(cashoutPda, mint);
   const delay = parlayCashoutRequiresDelay(parlay.legs, fill.snapshots);
   const [escrowPdaMeta, escrowAtaMeta] = await cashoutEscrowAccountMetas(
      user,
      fill.origBetId,
      delay,
      mint,
   );
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(fillingMm);
   const [mmParlayQuoteBuffer] = await getMmParlayQuoteBufferPda(fillingMm);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(fillingMm, mint);
   const mmLiabilityAta = await getAta(mmEncumbrancePda, mint);
   const mmTokenAta = await getAta(mmConfigPda, mint);
   const legAccounts: { address: Address; role: AccountRole }[] = [];
   for (const mid of marketIds) {
      const [marketDataPda] = await getMmMarketDataPda(fillingMm, mid);
      const [eventStatePda] = await getEventStatePda(fillingMm, mid.eventId);
      legAccounts.push(ro(marketDataPda), ro(eventStatePda));
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(feepayer),
         rw(parlay.feepayer),
         rs(user),
         rw(userAta),
         rw(betPda),
         rw(betAta),
         rw(cashoutPda),
         rw(cashoutAta),
         escrowPdaMeta,
         escrowAtaMeta,
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
         ro(fillingMm),
         rw(mmConfigPda),
         rw(mmParlayQuoteBuffer),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         rw(mmTokenAta),
         ...legAccounts,
      ],
      data: encodeAggregatorInstructionData({ kind: 'fillParlayCashout', data: fill }),
   };
}

/**
 * **`fill_rfq_cashout`** — RFQ cashout of a single bet (one MM).
 * Signed `maxPayment` is the full cash; the MM CPI `amount_to_send` is the remainder after free liability.
 *
 * @param bet - **TS:** {@link BetAccountData} — original ticket; `bet.feepayer` is the rent dest on full pregame close.
 */
export async function getFillRfqCashoutIx(
   fill: FillRfqCashoutIxData,
   feepayer: Address,
   bet: BetAccountData,
   marketId: MarketId,
   mmProgram: Address,
): Promise<Instruction> {
   validateFillRfqCashoutIxData(fill, 'fill', undefined, {
      isPregame: marketId.isPregame,
      origEventStateSequence: bet.eventStateSequence,
   });
   validateMarketId(marketId, 'marketId');
   if (bet.betId !== fill.origBetId) {
      throw new RangeError('bet.betId must equal fill.origBetId');
   }
   if (bet.promoType === PROMO_FREEBET || bet.promoType === PROMO_BOOST) {
      throw new RangeError('cannot cash out a promo ticket');
   }
   const mint = bet.marketId.mint;
   const user = bet.owner;
   const userAta = await getAta(user, mint);
   const [betPda] = await getBetPda(user, fill.origBetId);
   const betAta = await getAta(betPda, mint);
   const [cashoutPda] = await getCashoutPda(mmProgram, fill.cashoutId);
   const cashoutAta = await getAta(cashoutPda, mint);
   const delay = cashoutRequiresDelay(
      marketId.isPregame,
      bet.eventStateSequence,
      fill.eventStateSequence,
   );
   const [escrowPdaMeta, escrowAtaMeta] = await cashoutEscrowAccountMetas(
      user,
      fill.origBetId,
      delay,
      mint,
   );
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [eventStatePda] = await getEventStatePda(mmProgram, marketId.eventId);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, marketId);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const mmLiabilityAta = await getAta(mmEncumbrancePda, mint);
   const mmTokenAta = await getAta(mmConfigPda, mint);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(feepayer),
         rw(bet.feepayer),
         rs(user),
         rw(userAta),
         rw(betPda),
         rw(betAta),
         rw(cashoutPda),
         rw(cashoutAta),
         escrowPdaMeta,
         escrowAtaMeta,
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
         ro(mmProgram),
         rw(mmConfigPda),
         rw(eventStatePda),
         rw(marketDataPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         rw(mmTokenAta),
      ],
      data: encodeAggregatorInstructionData({ kind: 'fillRfqCashout', data: fill }),
   };
}

/**
 * **`fill_rfq_parlay_cashout`** — RFQ cashout of a parlay ticket (one MM).
 *
 * Same first **17** accounts as {@link getFillCashoutIx}, then **exactly 5** MM
 * accounts (program, config, encumbrance, liability ATA, MM ATA). No per-leg
 * market-data / event-state accounts — legs are in the signed RFQ message.
 * Signed `maxPayment` is the full cash; the MM CPI `amount_to_send` is the remainder after free liability.
 *
 * @param parlay - **TS:** {@link ParlayBetAccountData} — original ticket; `parlay.feepayer` is the rent dest on full pregame close.
 * @param origLegs - length check only (`origLegs.length` must equal `fill.numLegs`); not placed in the account list.
 */
export async function getFillRfqParlayCashoutIx(
   fill: FillRfqParlayCashoutIxData,
   feepayer: Address,
   parlay: ParlayBetAccountData,
   marketIds: MarketId[],
   fillingMm: Address,
): Promise<Instruction> {
   if (parlay.legs.length !== fill.numLegs) {
      throw new RangeError('parlay.legs.length must equal fill.numLegs');
   }
   validateFillRfqParlayCashoutIxData(fill, 'fill', undefined, {
      origLegSequences: parlay.legs.map((leg) => leg.eventStateSequence),
   });
   if (parlay.betId !== fill.origBetId) {
      throw new RangeError('parlay.betId must equal fill.origBetId');
   }
   if (parlay.promoType === PROMO_FREEBET || parlay.promoType === PROMO_BOOST) {
      throw new RangeError('cannot cash out a promo ticket');
   }
   const mint = parlay.legs[0]!.marketId.mint;
   if (marketIds.length !== fill.numLegs) {
      throw new RangeError('marketIds.length must equal fill.numLegs');
   }
   const user = parlay.owner;
   const userAta = await getAta(user, mint);
   const [betPda] = await getParlayBetPda(user, fill.origBetId);
   const betAta = await getAta(betPda, mint);
   const [cashoutPda] = await getCashoutParlayPda(fillingMm, fill.cashoutId);
   const cashoutAta = await getAta(cashoutPda, mint);
   const delay = parlayCashoutRequiresDelay(parlay.legs, fill.snapshots);
   const [escrowPdaMeta, escrowAtaMeta] = await cashoutEscrowAccountMetas(
      user,
      fill.origBetId,
      delay,
      mint,
   );
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(fillingMm);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(fillingMm, mint);
   const mmLiabilityAta = await getAta(mmEncumbrancePda, mint);
   const mmTokenAta = await getAta(mmConfigPda, mint);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(feepayer),
         rw(parlay.feepayer),
         rs(user),
         rw(userAta),
         rw(betPda),
         rw(betAta),
         rw(cashoutPda),
         rw(cashoutAta),
         escrowPdaMeta,
         escrowAtaMeta,
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
         ro(fillingMm),
         rw(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         rw(mmTokenAta),
      ],
      data: encodeAggregatorInstructionData({ kind: 'fillRfqParlayCashout', data: fill }),
   };
}

/**
 * **`claim_cashout_escrow`** — permissionless claim after `LIVE_CASHOUT_DELAY`.
 *
 * @param feepayer - **TS:** `Address` — writable signer paying tx fees. **Rust:** `feepayer` (writable signer); not the rent destination.
 * @param escrow - **TS:** {@link CashoutEscrow} — decoded escrow; `escrow.feepayer` is passed as writable `rent_recipient`.
 * @param ticket - **TS:** original {@link BetAccountData} or {@link ParlayBetAccountData}; `ticket.feepayer` receives orig PDA/ATA rent on full cashout.
 */
export async function getClaimCashoutEscrowIx(
   feepayer: Address,
   escrow: CashoutEscrowAccountData,
   ticket: Pick<BetAccountData, 'feepayer'> | Pick<ParlayBetAccountData, 'feepayer'>,
   mint: Address,
): Promise<Instruction> {
   const user = escrow.owner;
   const userAta = await getAta(user, mint);
   const [escrowPda] = await getCashoutEscrowPda(user, escrow.origBetId);
   const escrowAta = await getAta(escrowPda, mint);
   const [originalBetPda] = escrow.isParlay
      ? await getParlayBetPda(user, escrow.origBetId)
      : await getBetPda(user, escrow.origBetId);
   const originalBetAta = await getAta(originalBetPda, mint);
   const [cashoutPda] = escrow.isParlay
      ? await getCashoutParlayPda(escrow.marketMaker, escrow.cashoutId)
      : await getCashoutPda(escrow.marketMaker, escrow.cashoutId);
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(feepayer),
         rw(escrow.feepayer),
         rw(ticket.feepayer),
         ro(user),
         rw(userAta),
         rw(escrowPda),
         rw(escrowAta),
         rw(originalBetPda),
         rw(originalBetAta),
         ro(cashoutPda),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SYSTEM_PROGRAM_ID),
         ro(CLOCK_ID),
      ],
      data: encodeAggregatorInstructionData({ kind: 'claimCashoutEscrow' }),
   };
}

/**
 * **`revert_cashout`** — permissionless revert when original or cashout is RolledBack.
 * Returns escrowed payment to the filling MM **liability ATA** (authority = encumbrance PDA).
 *
 * @param feepayer - **TS:** `Address` — writable signer paying tx fees. **Rust:** `feepayer` (writable signer); not the rent destination.
 * @param escrow - **TS:** {@link CashoutEscrow} — decoded escrow; `escrow.feepayer` is passed as writable `rent_recipient`.
 */
export async function getRevertCashoutIx(
   feepayer: Address,
   escrow: CashoutEscrowAccountData,
   mint: Address,
): Promise<Instruction> {
   const user = escrow.owner;
   const userAta = await getAta(user, mint);
   const [originalBetPda] = escrow.isParlay
      ? await getParlayBetPda(user, escrow.origBetId)
      : await getBetPda(user, escrow.origBetId);
   const originalBetAta = await getAta(originalBetPda, mint);
   const [cashoutPda] = escrow.isParlay
      ? await getCashoutParlayPda(escrow.marketMaker, escrow.cashoutId)
      : await getCashoutPda(escrow.marketMaker, escrow.cashoutId);
   const cashoutAta = await getAta(cashoutPda, mint);
   const [escrowPda] = await getCashoutEscrowPda(user, escrow.origBetId);
   const escrowAta = await getAta(escrowPda, mint);
   const [mmConfigPda] = await getMmConfigPda(escrow.marketMaker);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(escrow.marketMaker, mint);
   const mmLiabilityAta = await getAta(mmEncumbrancePda, mint);
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(feepayer),
         rw(escrow.feepayer),
         ro(user),
         rw(userAta),
         rw(originalBetPda),
         rw(originalBetAta),
         rw(cashoutPda),
         rw(cashoutAta),
         rw(escrowPda),
         rw(escrowAta),
         ro(escrow.marketMaker),
         ro(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SYSTEM_PROGRAM_ID),
      ],
      data: encodeAggregatorInstructionData({ kind: 'revertCashout' }),
   };
}

/**
 * **`get_cashout_quote_proxy`** — soft-fail cashout quote auction; return `ProxyCashoutQuoteData[]`.
 */
export async function getGetCashoutQuoteProxyIx(
   quote: FillCashoutIxData,
   user: Address,
   marketId: MarketId,
   mmPrograms: readonly Address[],
): Promise<Instruction> {
   validateFillCashoutIxData(quote, 'quote', { isPregame: marketId.isPregame });
   validateMarketId(marketId, 'marketId');
   if (mmPrograms.length === 0 || mmPrograms.length > MAX_NUMBER_OF_MMS_PROXY) {
      throw new RangeError(`mmPrograms.length must be in [1, ${MAX_NUMBER_OF_MMS_PROXY}]`);
   }
   const [originalBetPda] = await getBetPda(user, quote.origBetId);
   const perMarketMakerAccounts: { address: Address; role: AccountRole }[] = [];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [eventStatePda] = await getEventStatePda(mmProgram, marketId.eventId);
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, marketId);
      const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
      perMarketMakerAccounts.push(
         ro(mmProgram),
         ro(mmConfigPda),
         ro(eventStatePda),
         ro(marketDataPda),
         rw(mmQuoteBufferPda),
      );
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ro(user), ro(CLOCK_ID), ro(originalBetPda), ...perMarketMakerAccounts],
      data: encodeAggregatorInstructionData({ kind: 'getCashoutQuoteProxy', data: quote }),
   };
}

/**
 * **`get_parlay_cashout_quote_proxy`** — soft-fail parlay cashout quote auction.
 */
export async function getGetParlayCashoutQuoteProxyIx(
   quote: FillParlayCashoutIxData,
   user: Address,
   origLegs: readonly { marketId: MarketId }[],
   mmPrograms: readonly Address[],
): Promise<Instruction> {
   validateFillParlayCashoutIxData(quote, 'quote');
   if (origLegs.length !== quote.numLegs) {
      throw new RangeError('origLegs.length must equal quote.numLegs');
   }
   if (mmPrograms.length === 0 || mmPrograms.length > MAX_NUMBER_OF_MMS_PROXY) {
      throw new RangeError(`mmPrograms.length must be in [1, ${MAX_NUMBER_OF_MMS_PROXY}]`);
   }
   const [originalParlayPda] = await getParlayBetPda(user, quote.origBetId);
   const perMarketMakerAccounts: { address: Address; role: AccountRole }[] = [];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [mmParlayQuoteBuffer] = await getMmParlayQuoteBufferPda(mmProgram);
      perMarketMakerAccounts.push(ro(mmProgram), ro(mmConfigPda), rw(mmParlayQuoteBuffer));
      for (const leg of origLegs) {
         const [marketDataPda] = await getMmMarketDataPda(mmProgram, leg.marketId);
         const [eventStatePda] = await getEventStatePda(mmProgram, leg.marketId.eventId);
         perMarketMakerAccounts.push(ro(marketDataPda), ro(eventStatePda));
      }
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ro(user), ro(CLOCK_ID), ro(originalParlayPda), ...perMarketMakerAccounts],
      data: encodeAggregatorInstructionData({ kind: 'getParlayCashoutQuoteProxy', data: quote }),
   };
}

/**
 * **`settle_bet`** for a cashout ticket — same discriminator as {@link getSettleBetIx}.
 * Payout lands in the filling MM **liability ATA**; escrow is `["cashout_escrow", origOwner, origBetId]`;
 * `dest_encumbrance` is the filling MM encumbrance PDA.
 */
export async function getSettleCashoutIx(
   signer: Address,
   cashoutPda: Address,
   cashout: CashoutAccountData,
): Promise<Instruction> {
   validatePositiveU64(cashout.cashoutId, 'cashout.cashoutId');
   if (cashout.result === BetResult.Pending) {
      throw new Error('cashout.result must be not Pending');
   }
   if (cashout.result === BetResult.CashedOut) {
      throw new Error('cashout.result CashedOut is not settleable');
   }
   const mint = cashout.marketId.mint;
   const cashoutAta = await getAta(cashoutPda, mint);
   const [encumbrancePda] = await getMmEncumbrancePda(cashout.mm, mint);
   const liabilityAta = await getAta(encumbrancePda, mint);
   const [configPda] = await getConfigPda();
   const [cashoutEscrowPda] = await getCashoutEscrowPda(cashout.origOwner, cashout.origBetId);
   const baseAccounts = [
      rs(signer),
      rw(cashoutPda),
      rw(cashoutAta),
      rw(cashout.feepayer),
      ro(cashout.mm),
      rw(liabilityAta),
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(cashoutEscrowPda),
      rw(encumbrancePda),
   ];
   const fillerAccounts: { address: Address; role: AccountRole }[] = [];
   if (cashout.fillers.length === 0 || cashout.fillers.length !== cashout.numFillers) {
      throw new RangeError(`cashout.fillers.length must equal cashout.numFillers (${cashout.numFillers})`);
   }
   for (const filler of cashout.fillers) {
      const row = await settleFillerAccountRow(filler, cashout.marketId.eventId, cashout.marketId.operator, mint);
      const nettingRole = filler.isPotentiallyNetted ? rw(row[4]!) : ro(row[4]!);
      fillerAccounts.push(ro(row[0]!), ro(row[1]!), rw(row[2]!), rw(row[3]!), nettingRole);
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [...baseAccounts, ...fillerAccounts],
      data: encodeAggregatorInstructionData({ kind: 'settleBet' }),
   };
}

/**
 * **`settle_parlay`** for a cashout-parlay ticket — same discriminator as {@link getSettleParlayIx}.
 * Payout lands in the filling MM **liability ATA**; escrow is `origOwner` + `origBetId`;
 * `dest_encumbrance` is the filling MM encumbrance PDA. Filler accounts are the **original** parlay MM.
 */
export async function getSettleCashoutParlayIx(
   signer: Address,
   cashoutPda: Address,
   cashout: CashoutParlayAccountData,
): Promise<Instruction> {
   validatePositiveU64(cashout.cashoutId, 'cashout.cashoutId');
   if (cashout.result === BetResult.Pending) {
      throw new Error('cashout.result must be not Pending');
   }
   if (cashout.result === BetResult.CashedOut) {
      throw new Error('cashout.result CashedOut is not settleable');
   }
   const mint = cashout.legs[0]!.marketId.mint;
   const cashoutAta = await getAta(cashoutPda, mint);
   const [destEncumbrancePda] = await getMmEncumbrancePda(cashout.mm, mint);
   const destLiabilityAta = await getAta(destEncumbrancePda, mint);
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(cashout.originalFillerAddress);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(cashout.originalFillerAddress, mint);
   const mmLiabilityAta = await getAta(mmEncumbrancePda, mint);
   const [cashoutEscrowPda] = await getCashoutEscrowPda(cashout.origOwner, cashout.origBetId);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         rs(signer),
         rw(cashoutPda),
         rw(cashoutAta),
         rw(cashout.feepayer),
         ro(cashout.mm),
         rw(destLiabilityAta),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(cashout.originalFillerAddress),
         ro(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         ro(cashoutEscrowPda),
         rw(destEncumbrancePda),
      ],
      data: encodeAggregatorInstructionData({ kind: 'settleParlay' }),
   };
}

/**
 * **`get_quote_proxy`** — CPI each MM `get_quote`, return `ProxyQuoteData[]` via transaction return data (no bet accounts).
 *
 * **Rust:** `get_quote_proxy::get_quote_proxy` (`GET_QUOTE_PROXY_IX_DISCRIMINATOR` = 200). Instruction body matches `fill_bet` (`FillBetIxData`; `bet_id` unused). Per MM: 5 accounts (program, config, event state, market data, quote buffer).
 *
 * @param quote - Same fields as {@link getFillBetIx} / {@link FillBetIxData}.
 * @param user - User pubkey passed to MM `get_quote` CPI (readonly; not required to sign).
 * @param mmPrograms - One MM program id per quote source (1..={@link MAX_NUMBER_OF_MMS_PROXY}).
 */
export async function getGetQuoteProxyIx(
   quote: FillBetIxData,
   user: Address,
   mmPrograms: readonly Address[],
): Promise<Instruction> {
   validateFillBetIxData(quote, 'quote');
   if (mmPrograms.length === 0 || mmPrograms.length > MAX_NUMBER_OF_MMS_PROXY) {
      throw new RangeError(`mmPrograms.length must be in [1, ${MAX_NUMBER_OF_MMS_PROXY}]`);
   }
   const perMarketMakerAccounts: { address: Address; role: AccountRole }[] = [];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [eventStatePda] = await getEventStatePda(mmProgram, quote.marketId.eventId);
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, quote.marketId);
      const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
      perMarketMakerAccounts.push(
         ro(mmProgram),
         ro(mmConfigPda),
         ro(eventStatePda),
         ro(marketDataPda),
         rw(mmQuoteBufferPda),
      );
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ro(user), ro(CLOCK_ID),
         ...perMarketMakerAccounts],
      data: encodeAggregatorInstructionData({
         kind: 'getQuoteProxy',
         data: quote,
      }),
   };
}

/**
 * **`get_market_quotes_proxy`** — CPI each MM `get_quote` for every side in the market; return packed quotes via transaction return data.
 *
 * **Rust:** `get_market_quotes_proxy::get_market_quotes_proxy` (`GET_MARKET_QUOTES_PROXY_IX_DISCRIMINATOR` = 202). Body matches `fill_bet` (`bet_id` / `side` unused). Return data is odds-only per side (`decodeMarketQuotesProxyReturnData` in `codex.ts`). `N` ≤ `min(20, maxProxyMmsForMarketQuotes(numSidesForMkt(mkt)))`.
 *
 * @param quote - Same fields as {@link getFillBetIx} / {@link FillBetIxData}.
 * @param user - User pubkey for MM CPI (readonly).
 * @param mmPrograms - MM program ids to query; count must fit return-data cap for the market's side count.
 */
export async function getGetMarketQuotesProxyIx(
   quote: FillBetIxData,
   user: Address,
   mmPrograms: readonly Address[],
): Promise<Instruction> {
   validateFillBetIxData(quote, 'quote');
   const numSides = numSidesForMkt(quote.marketId.mkt);
   if (numSides === undefined) {
      throw new RangeError(`unsupported mkt ${quote.marketId.mkt} for market quotes`);
   }
   const maxMms = Math.min(MAX_NUMBER_OF_MMS_PROXY, maxProxyMmsForMarketQuotes(numSides));
   if (mmPrograms.length === 0 || mmPrograms.length > maxMms) {
      throw new RangeError(
         `mmPrograms.length must be in [1, ${maxMms}] for ${numSides}-side market (mkt=${quote.marketId.mkt})`,
      );
   }
   const perMarketMakerAccounts: { address: Address; role: AccountRole }[] = [];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [eventStatePda] = await getEventStatePda(mmProgram, quote.marketId.eventId);
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, quote.marketId);
      const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
      perMarketMakerAccounts.push(
         ro(mmProgram),
         ro(mmConfigPda),
         ro(eventStatePda),
         ro(marketDataPda),
         rw(mmQuoteBufferPda),
      );
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ro(user), ro(CLOCK_ID),
         ...perMarketMakerAccounts],
      data: encodeAggregatorInstructionData({
         kind: 'getMarketQuotesProxy',
         data: quote,
      }),
   };
}

/**
 * **`get_parlay_quote_proxy`** — CPI each MM `get_quote_parlay`, return `ProxyParlayQuoteData[]` via transaction return data.
 *
 * **Rust:** `get_parlay_quote_proxy::get_parlay_quote_proxy` (`GET_PARLAY_QUOTE_PROXY_IX_DISCRIMINATOR` = 201). Body matches `fill_parlay` (`FillParlayIxData`; `bet_id` unused). Per MM: `3 + 2 × num_legs` accounts.
 *
 * @param quote - Same fields as {@link getFillParlayIx} / {@link FillParlayIxData}.
 * @param user - User pubkey for MM CPI (readonly).
 * @param mmPrograms - MM program ids to query (1..={@link MAX_NUMBER_OF_MMS_PROXY}).
 */
export async function getGetParlayQuoteProxyIx(
   quote: FillParlayIxData,
   user: Address,
   mmPrograms: readonly Address[],
): Promise<Instruction> {
   validateFillParlayIxData(quote, 'quote');
   if (mmPrograms.length === 0 || mmPrograms.length > MAX_NUMBER_OF_MMS_PROXY) {
      throw new RangeError(`mmPrograms.length must be in [1, ${MAX_NUMBER_OF_MMS_PROXY}]`);
   }
   if (quote.numLegs < 2 || quote.numLegs > MAX_PARLAY_LEGS) {
      throw new RangeError(`quote.numLegs must be in [2, ${MAX_PARLAY_LEGS}]`);
   }
   const perMarketMakerAccounts: { address: Address; role: AccountRole }[] = [];
   for (const mmProgram of mmPrograms) {
      const [mmConfigPda] = await getMmConfigPda(mmProgram);
      const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
      perMarketMakerAccounts.push(ro(mmProgram), ro(mmConfigPda), rw(mmParlayQuoteBufferPda));
      for (let legIdx = 0; legIdx < quote.numLegs; legIdx++) {
         const leg = quote.legs[legIdx]!;
         const [marketDataPda] = await getMmMarketDataPda(mmProgram, leg.marketId);
         const [eventStatePda] = await getEventStatePda(mmProgram, leg.marketId.eventId);
         perMarketMakerAccounts.push(ro(marketDataPda), ro(eventStatePda));
      }
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ro(user), ro(CLOCK_ID),
         ...perMarketMakerAccounts],
      data: encodeAggregatorInstructionData({
         kind: 'getParlayQuoteProxy',
         data: quote,
      }),
   };
}

/**
 * **`fill_parlay`** — CPI MM `get_quote_parlay` / `fill_parlay_quote`, open parlay bet PDA + ATA (no netting; **exactly one** MM).
 *
 * **Rust:** `aggregator::instructions::fill_parlay::process` (`FILL_PARLAY_IX_DISCRIMINATOR` = 11). Header is `bet_id`, `amount`, `min_odds_scaled`, `num_legs` then [`ParlayLegSel`] × `num_legs` (not the `fill_bet` layout). Bet PDA seeds are **`["parlay", user, bet_id]`**. Per MM: program, config, parlay quote buffer, encumbrance, liability ATA, MM token ATA, then `(market_data, event_state)` × `num_legs`.
 *
 * @param fill - **TS:** {@link FillParlayIxData}. **Rust:** `FillParlayIxData` after router discriminator.
 * @param feepayer - **TS:** `Address` — writable signer paying rent. **Rust:** `feepayer` (writable signer).
 * @param user - **TS:** `Address` — bet owner (readonly signer). **Rust:** `user` (readonly signer).
 * @param mmProgram - **TS:** `mmProgram`. **Rust:** `6 + 2 * num_legs` accounts for MM.
 */
export async function getFillParlayIx(
   fill: FillParlayIxData,
   feepayer: Address,
   user: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validateFillParlayIxData(fill, 'fill');
   const mint = fill.legs[0]!.marketId.mint;
   const userAta = await getAta(user, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [betPda] = await getParlayBetPda(user, fill.betId);
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const liabilityAta = await getAta(
      mmEncumbrancePda,
      mint,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const accounts = [
      ws(feepayer),
      rs(user),
      rw(userAta),
      rw(betPda),
      rw(betAta),
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SYSVAR_RENT_ID),
      ro(SYSTEM_PROGRAM_ID),
      ro(CLOCK_ID),
      ro(mmProgram),
      rw(mmConfigPda),
      rw(mmParlayQuoteBufferPda),
      rw(mmEncumbrancePda),
      rw(liabilityAta),
      rw(mmTokenAta),
   ];

   for (let legIdx = 0; legIdx < fill.numLegs; legIdx++) {
      const leg = fill.legs[legIdx]!;
      const [marketDataPda] = await getMmMarketDataPda(mmProgram, leg.marketId);
      const [eventStatePda] = await getEventStatePda(mmProgram, leg.marketId.eventId);
      accounts.push(ro(marketDataPda), ro(eventStatePda));
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts,
      data: encodeAggregatorInstructionData({
         kind: 'fillParlay',
         data: fill,
      }),
   };
}

/**
 * Build a **market-maker `get_quote_parlay`** instruction (`programAddress` = MM program).
 *
 * **Rust:** MM `get_quote_parlay::process` (`GET_QUOTE_PARLAY_IX_DISCRIMINATOR` = 122); accounts: `user`, clock sysvar, MM config, parlay quote buffer, then `(market_data, event_state)` × L.
 */
export async function getMmGetQuoteParlayIx(
   quote: MmGetQuoteParlay,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   const numLegs = quote.legs.length;
   validateGetQuoteParlayIxData(
      {
         amount: quote.amount,
         oddsScaled: quote.minOddsScaled,
         numLegs,
         legs: quote.legs,
      },
      'quote',
   );
   const ixData = encodeGetQuoteParlayIxData({
      instructionDiscriminator: MM_GET_QUOTE_PARLAY_IX_DISCRIMINATOR,
      amount: quote.amount,
      oddsScaled: quote.minOddsScaled,
      numLegs,
      legs: quote.legs,
   });
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
 * Build a **market-maker `get_quote`** instruction (invoked **on the MM program**, not the aggregator router).
 * Used to preview a quote off-chain or from a client; aggregator `fill_bet` performs the same CPI internally.
 *
 * **Rust:** MM program `get_quote` handler (`MM_GET_QUOTE_IX_DISCRIMINATOR` = 120).
 * Accounts (6), matching MM `get_quote.rs` and aggregator CPI in `fill_bet.rs`:
 * 0. `user`, 1. `clock`, 2. `mm_market_data_pda`, 3. `event_state_pda`, 4. `mm_config_pda`, 5. `mm_quote_buffer`.
 *
 * @param quote - **TS:** {@link MmGetQuote} — amount, min odds (scaled), side, `eventGameState` / sequence, `marketId`. **Rust:** `GetQuoteIxData` (includes MM ix discriminator byte + fields).
 * @param mmProgram - **TS:** `Address` — MM program id (`programAddress` of returned instruction). **Rust:** MM `program_id` for the ix.
 * @param user - **TS:** `Address` — user pubkey passed as first account. **Rust:** first CPI account (readonly).
 * @returns **`Promise<Instruction>`** — `programAddress` = `mmProgram`; six accounts in Rust order above; `data` = encoded MM get-quote payload. **Note:** validates odds, side, market, sequence, and game state before encoding.
 */
export async function getMmGetQuoteIx(
   quote: MmGetQuote,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   validateMmGetQuote(quote);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, quote.marketId);
   const [eventStatePda] = await getEventStatePda(mmProgram, quote.marketId.eventId);
   const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
   const ixData = encodeGetQuoteIxData({
      instructionDiscriminator: MM_GET_QUOTE_IX_DISCRIMINATOR,
      amount: quote.amount,
      oddsScaled: quote.minOddsScaled,
      marketId: quote.marketId,
      side: quote.side,
      eventGameState: quote.eventGameState,
      eventStateSequence: quote.eventStateSequence,
   });
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
 * Build a **market-maker `get_cashout_quote`** instruction (`programAddress` = MM program).
 *
 * **Rust:** MM `get_cashout_quote::process` (`MM_GET_CASHOUT_QUOTE_IX_DISCRIMINATOR` = 140).
 * Accounts (6): `user`, clock sysvar, `mm_market_data_pda`, `event_state_pda`, `mm_config_pda`, `mm_quote_buffer`.
 * Return data: 8-byte LE `max_payment` (0 = no quote).
 *
 * @param quote - {@link MmGetCashoutQuote} — stake slice, remaining payout, min payment, market context.
 * @param mmProgram - MM program id (`programAddress` of returned instruction).
 * @param user - User pubkey (readonly first account).
 */
export async function getMmGetCashoutQuoteIx(
   quote: MmGetCashoutQuote,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   validateMmGetCashoutQuote(quote);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, quote.marketId);
   const [eventStatePda] = await getEventStatePda(mmProgram, quote.marketId.eventId);
   const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
   const ixData = encodeGetCashoutQuoteIxData({
      instructionDiscriminator: MM_GET_CASHOUT_QUOTE_IX_DISCRIMINATOR,
      amount: quote.amount,
      payout: quote.payout,
      minPayout: quote.minPayout,
      marketId: quote.marketId,
      side: quote.side,
      eventGameState: quote.eventGameState,
      eventStateSequence: quote.eventStateSequence,
   });
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
 * Build a **market-maker `fill_cashout_quote`** instruction (`programAddress` = MM program).
 *
 * **Rust:** MM `fill_cashout_quote::process` (`MM_FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR` = 141).
 * Transfers `amountToSend` from MM ATA to `paymentDest`; marks quote buffer used.
 *
 * @param params - {@link FillCashoutQuoteIxData} fields except `instructionDiscriminator`.
 * @param mmProgram - MM program id.
 * @param user - User pubkey (readonly first account).
 * @param paymentDest - Writable token account receiving MM payment.
 */
export async function getMmFillCashoutQuoteIx(
   params: Omit<FillCashoutQuoteIxData, 'instructionDiscriminator'>,
   mmProgram: Address,
   user: Address,
   paymentDest: Address,
): Promise<Instruction> {
   const full: FillCashoutQuoteIxData = {
      instructionDiscriminator: MM_FILL_CASHOUT_QUOTE_IX_DISCRIMINATOR,
      ...params,
   };
   validateFillCashoutQuoteIxData(full);
   const mint = params.marketId.mint;
   const ixData = encodeFillCashoutQuoteIxData(full);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [marketDataPda] = await getMmMarketDataPda(mmProgram, params.marketId);
   const [eventStatePda] = await getEventStatePda(mmProgram, params.marketId.eventId);
   const [mmQuoteBufferPda] = await getMmQuoteBufferPda(mmProgram);
   const mmTokenAta = await getAta(mmConfigPda, mint);
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         rs(CONFIG_PDA),
         rw(marketDataPda),
         rw(eventStatePda),
         rw(mmConfigPda),
         rw(mmQuoteBufferPda),
         rw(mmTokenAta),
         rw(paymentDest),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      data: ixData,
   };
}

/**
 * Build a **market-maker `get_cashout_quote_parlay`** instruction (`programAddress` = MM program).
 *
 * **Rust:** MM `get_cashout_quote_parlay::process` (`MM_GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR` = 142).
 * Accounts: `user`, clock, MM config, parlay quote buffer, then `(market_data, event_state)` × L.
 */
export async function getMmGetCashoutQuoteParlayIx(
   quote: MmGetCashoutQuoteParlay,
   mmProgram: Address,
   user: Address,
): Promise<Instruction> {
   const numLegs = quote.legs.length;
   validateGetCashoutQuoteParlayIxData(
      {
         amount: quote.amount,
         payout: quote.payout,
         minPayout: quote.minPayout,
         numLegs,
         legs: quote.legs,
      },
      'quote',
   );
   const ixData = encodeGetCashoutQuoteParlayIxData({
      instructionDiscriminator: MM_GET_CASHOUT_QUOTE_PARLAY_IX_DISCRIMINATOR,
      amount: quote.amount,
      payout: quote.payout,
      minPayout: quote.minPayout,
      numLegs,
      legs: quote.legs,
   });
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
 * Build a **market-maker `fill_cashout_parlay_quote`** instruction (`programAddress` = MM program).
 *
 * **Rust:** MM `fill_cashout_parlay_quote::process` (`MM_FILL_CASHOUT_PARLAY_QUOTE_IX_DISCRIMINATOR` = 143).
 * Transfers `amountToSend` from MM ATA to `paymentDest`; marks parlay quote buffer used.
 */
export async function getMmFillCashoutParlayQuoteIx(
   params: Omit<FillCashoutParlayQuoteIxData, 'instructionDiscriminator'>,
   mmProgram: Address,
   user: Address,
   paymentDest: Address,
   mint: Address,
): Promise<Instruction> {
   const full: FillCashoutParlayQuoteIxData = {
      instructionDiscriminator: MM_FILL_CASHOUT_PARLAY_QUOTE_IX_DISCRIMINATOR,
      ...params,
   };
   validateFillCashoutParlayQuoteIxData(full);
   const ixData = encodeFillCashoutParlayQuoteIxData(full);
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmParlayQuoteBufferPda] = await getMmParlayQuoteBufferPda(mmProgram);
   const mmTokenAta = await getAta(mmConfigPda, mint);
   return {
      programAddress: mmProgram,
      accounts: [
         ro(user),
         rs(CONFIG_PDA),
         rw(mmConfigPda),
         rw(mmParlayQuoteBufferPda),
         rw(mmTokenAta),
         rw(paymentDest),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      data: ixData,
   };
}

/**
 * **`grade_bets`** — admin sets `BetResult` on many bet / cashout PDAs (no token movement).
 *
 * **Rust:** `aggregator::instructions::grade_bets::process` (`GRADE_BETS_IX_DISCRIMINATOR` = 100). Data: one `u8` result per bet account (`data.len() == bet_accounts.len()`).
 * Accepts single-bet PDAs (`BET_ACCOUNT_DISCRIMINATOR`) or cashout tickets (`CASHOUT_ACCOUNT_DISCRIMINATOR`).
 *
 * @param admin - **TS:** `Address` — config admin signer. **Rust:** `admin` (signer).
 * @param betResults - **TS:** `Uint8Array` — one byte per bet, valid graded `BetResult` discriminant. **Rust:** `&[u8]` same length as bet accounts.
 * @param betAccounts - **TS:** `readonly Address[]` — bet / cashout PDA addresses (writable). **Rust:** `bet_accounts @ ..` slice.
 * @returns **`Promise<Instruction>`** — `data` = discriminator + raw `betResults` bytes. Config PDA is readonly second account.
 */
export async function getGradeBetsIx(
   admin: Address,
   betResults: Uint8Array,
   betAccounts: readonly Address[],
): Promise<Instruction> {
   validateGradeBetResults(betResults, 'betResults');
   if (betAccounts.length !== betResults.length) {
      throw new RangeError('betAccounts.length must match betResults.length');
   }
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [rs(admin), ro(configPda), ...betAccounts.map((address) => rw(address))],
      data: encodeAggregatorInstructionData({ kind: 'gradeBets', betResults }),
   };
}

/**
 * **`grade_parlay`** — operator or admin grades legs on one parlay / cashout-parlay (`255` = skip leg).
 *
 * **Rust:** `aggregator::instructions::grade_parlay::process` (`GRADE_PARLAY_IX_DISCRIMINATOR` = 101).
 * Data: grade mask for the parlay account.
 */
export async function getGradeParlayIx(
   authority: Address,
   legGradeMask: Uint8Array,
   parlayBetAccount: Address,
): Promise<Instruction> {
   validateGradeParlayMask(legGradeMask, 'legGradeMask');
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [rs(authority), ro(configPda), rw(parlayBetAccount)],
      data: encodeAggregatorInstructionData({ kind: 'gradeParlay', legGradeMask }),
   };
}

/**
 * **`settle_bet`** — pay winner, release encumbrances to fillers, close bet / cashout PDA + ATA to feepayer (must not be `Pending` or `CashedOut`).
 *
 * **Rust:** `aggregator::instructions::settle_bet::process` (`SETTLE_BET_IX_DISCRIMINATOR` = 110). Instruction data: none after router discriminator.
 * For cashout tickets use {@link getSettleCashoutIx}.
 *
 * @param bet - **TS:** {@link BetAccountData} — decoded on-chain bet layout (owner, feepayer, fillers, result, etc.). **Rust:** `BetAccountData` read from `bet_account` account.
 * @param signer - **TS:** `Address` — any signer paying/authorizing the settle flow as implemented on-chain. **Rust:** `signer` (signer).
 * @param betPda - **TS:** `Address` — bet PDA address. **Rust:** `bet_account` (writable PDA owned by aggregator program).
 * @returns **`Promise<Instruction>`** — 11 fixed accounts + 5×N filler accounts (`N` = `bet.numFillers`). Fixed prefix includes `cashout_escrow_pda` (unused for this ticket) and `dest_encumbrance` ({@link SYSTEM_PROGRAM_ID} placeholder — ignored on-chain for normal bets). Last filler slot is the netting PDA when `isPotentiallyNetted`, otherwise the system program.
 */
export async function getSettleBetIx(
   signer: Address,
   betPda: Address,
   bet: BetAccountData,
): Promise<Instruction> {
   validatePositiveU64(bet.betId, 'bet.betId');
   if (bet.result === BetResult.Pending) {
      throw new Error('bet.result must be not Pending');
   }
   if (bet.result === BetResult.CashedOut) {
      throw new Error('bet.result CashedOut is not settleable');
   }
   if (bet.promoType === PROMO_FREEBET) {
      throw new Error('use getSettleFreebetIx for freebet tickets');
   }
   if (bet.promoType === PROMO_BOOST) {
      throw new Error('use getSettleBoostedBetIx for boosted tickets');
   }
   const mint = bet.marketId.mint;
   const user = bet.owner;
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const userAta = await getAta(user, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   const [cashoutEscrowPda] = await getCashoutEscrowPda(user, bet.betId);
   const baseAccounts = [
      rs(signer),
      rw(betPda),
      rw(betAta),
      rw(bet.feepayer),
      ro(user),
      rw(userAta),
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(cashoutEscrowPda),
      ro(SYSTEM_PROGRAM_ID),
   ];
   const fillerAccounts: { address: Address; role: AccountRole }[] = [];
   if (bet.fillers.length === 0 || bet.fillers.length !== bet.numFillers) {
      throw new RangeError(`bet.fillers.length must equal bet.numFillers (${bet.numFillers})`);
   }
   for (const filler of bet.fillers) {
      const row = await settleFillerAccountRow(filler, bet.marketId.eventId, bet.marketId.operator, mint);
      const nettingRole = filler.isPotentiallyNetted ? rw(row[4]!) : ro(row[4]!);
      fillerAccounts.push(ro(row[0]!), ro(row[1]!), rw(row[2]!), rw(row[3]!), nettingRole);
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [...baseAccounts, ...fillerAccounts],
      data: encodeAggregatorInstructionData({ kind: 'settleBet' }),
   };
}

/**
 * **`settle_parlay`** — settle a graded parlay bet (no payload after router discriminator).
 *
 * **Rust:** `aggregator::instructions::settle_parlay::process` (`SETTLE_PARLAY_IX_DISCRIMINATOR` = 111). Instruction data: none after router discriminator.
 * For cashout-parlay tickets use {@link getSettleCashoutParlayIx}.
 *
 * @param parlay - **TS:** {@link ParlayBetAccountData}. **Rust:** `ParlayBetAccountData` from parlay bet PDA.
 * @param signer - **TS:** `Address`. **Rust:** `signer` (signer).
 * @param betPda - **TS:** parlay bet PDA. **Rust:** `bet_account` (writable).
 * @returns **`Promise<Instruction>`** — 15 accounts: `signer`, `bet_account`, `bet_ata`, `bet_feepayer`, `user`, `user_ata`, `config_pda`, `mint`, `token_program`, `mm_address`, `mm_config_pda`, `mm_encumbrance_pda`, `mm_liability_token_account`, `cashout_escrow_pda`, `dest_encumbrance` ({@link SYSTEM_PROGRAM_ID} placeholder for normal parlays).
 */
export async function getSettleParlayIx(
   signer: Address,
   betPda: Address,
   parlay: ParlayBetAccountData,
): Promise<Instruction> {
   validatePositiveU64(parlay.betId, 'parlay.betId');
   if (parlay.result === BetResult.Pending) {
      throw new Error('parlay.result must be not Pending');
   }
   if (parlay.result === BetResult.CashedOut) {
      throw new Error('parlay.result CashedOut is not settleable');
   }
   if (parlay.promoType === PROMO_FREEBET) {
      throw new Error('use getSettleFreebetParlayIx for freebet parlays');
   }
   if (parlay.promoType === PROMO_BOOST) {
      throw new Error('use getSettleBoostedParlayIx for boosted parlays');
   }
   const mint = parlay.legs[0]!.marketId.mint;
   const user = parlay.owner;
   const betAta = await getAta(betPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const userAta = await getAta(user, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();

   const [mmConfigPda] = await getMmConfigPda(parlay.fillerAddress);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(parlay.fillerAddress, mint);
   const mmLiabilityTokenAccount = await getAta(mmEncumbrancePda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [cashoutEscrowPda] = await getCashoutEscrowPda(user, parlay.betId);
   const accounts = [
      rs(signer),
      rw(betPda),
      rw(betAta),
      rw(parlay.feepayer),
      ro(user),
      rw(userAta),
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(parlay.fillerAddress),
      ro(mmConfigPda),
      rw(mmEncumbrancePda),
      rw(mmLiabilityTokenAccount),
      ro(cashoutEscrowPda),
      ro(SYSTEM_PROGRAM_ID),
   ];
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts,
      data: encodeAggregatorInstructionData({ kind: 'settleParlay' }),
   };
}

/**
 * **`settle_freebet`** — same math as `settle_bet`, but leftover stake/dust goes to the issuer ATA.
 * No cashout escrow / dest-encumbrance metas; clock is required for freebet expiry checks.
 */
export async function getSettleFreebetIx(
   signer: Address,
   betPda: Address,
   bet: BetAccountData,
   issuerAuth: Address,
): Promise<Instruction> {
   if (bet.promoType !== PROMO_FREEBET) {
      throw new Error('bet is not a freebet ticket');
   }
   const mint = bet.marketId.mint;
   validatePositiveU64(bet.betId, 'bet.betId');
   if (bet.result === BetResult.Pending) {
      throw new Error('bet.result must be not Pending');
   }
   if (bet.result === BetResult.CashedOut) {
      throw new Error('bet.result CashedOut is not settleable');
   }
   const user = bet.owner;
   const betAta = await getAta(betPda, mint);
   const userAta = await getAta(user, mint);
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint);
   const freebetPda = bet.promoAccount;
   const [configPda] = await getConfigPda();
   const baseAccounts = [
      rs(signer),
      rw(betPda),
      rw(betAta),
      rw(bet.feepayer),
      ro(user),
      rw(userAta),
      rw(issuerAuth),
      rw(issuerPda),
      rw(issuerAta),
      rw(freebetPda),
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(CLOCK_ID),
   ];
   const fillerAccounts: { address: Address; role: AccountRole }[] = [];
   if (bet.fillers.length === 0 || bet.fillers.length !== bet.numFillers) {
      throw new RangeError(`bet.fillers.length must equal bet.numFillers (${bet.numFillers})`);
   }
   for (const filler of bet.fillers) {
      const row = await settleFillerAccountRow(filler, bet.marketId.eventId, bet.marketId.operator, mint);
      const nettingRole = filler.isPotentiallyNetted ? rw(row[4]!) : ro(row[4]!);
      fillerAccounts.push(ro(row[0]!), ro(row[1]!), rw(row[2]!), rw(row[3]!), nettingRole);
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [...baseAccounts, ...fillerAccounts],
      data: encodeAggregatorInstructionData({ kind: 'settleFreebet' }),
   };
}

/**
 * **`settle_freebet_parlay`** — same math as `settle_parlay`, but leftover stake/dust goes to the issuer ATA.
 * No cashout escrow / dest-encumbrance metas; clock is required for freebet expiry checks.
 */
export async function getSettleFreebetParlayIx(
   signer: Address,
   betPda: Address,
   parlay: ParlayBetAccountData,
   issuerAuth: Address,
): Promise<Instruction> {
   if (parlay.promoType !== PROMO_FREEBET) {
      throw new Error('parlay is not a freebet ticket');
   }
   const mint = parlay.legs[0]!.marketId.mint;
   validatePositiveU64(parlay.betId, 'parlay.betId');
   if (parlay.result === BetResult.Pending) {
      throw new Error('parlay.result must be not Pending');
   }
   if (parlay.result === BetResult.CashedOut) {
      throw new Error('parlay.result CashedOut is not settleable');
   }
   const user = parlay.owner;
   const betAta = await getAta(betPda, mint);
   const userAta = await getAta(user, mint);
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint);
   const freebetPda = parlay.promoAccount;
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(parlay.fillerAddress);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(parlay.fillerAddress, mint);
   const mmLiabilityAta = await getAta(mmEncumbrancePda, mint);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         rs(signer),
         rw(betPda),
         rw(betAta),
         rw(parlay.feepayer),
         ro(user),
         rw(userAta),
         rw(issuerAuth),
         rw(issuerPda),
         rw(issuerAta),
         rw(freebetPda),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(CLOCK_ID),
         ro(parlay.fillerAddress),
         ro(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
      ],
      data: encodeAggregatorInstructionData({ kind: 'settleFreebetParlay' }),
   };
}

/**
 * **`settle_boosted_bet`** — normal stake and market-maker profit, then the issuer ATA pays the boost top-up.
 */
export async function getSettleBoostedBetIx(
   signer: Address,
   betPda: Address,
   bet: BetAccountData,
   issuerAuth: Address,
): Promise<Instruction> {
   if (bet.promoType !== PROMO_BOOST) {
      throw new Error('bet is not a boost ticket');
   }
   const mint = bet.marketId.mint;
   validatePositiveU64(bet.betId, 'bet.betId');
   if (bet.result === BetResult.Pending) {
      throw new Error('bet.result must be not Pending');
   }
   if (bet.result === BetResult.CashedOut) {
      throw new Error('bet.result CashedOut is not settleable');
   }
   const user = bet.owner;
   const betAta = await getAta(betPda, mint);
   const userAta = await getAta(user, mint);
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint);
   const boostPda = bet.promoAccount;
   const [configPda] = await getConfigPda();
   const baseAccounts = [
      rs(signer),
      rw(betPda),
      rw(betAta),
      rw(bet.feepayer),
      ro(user),
      rw(userAta),
      rw(issuerAuth),
      rw(issuerPda),
      rw(issuerAta),
      rw(boostPda),
      ro(configPda),
      ro(mint),
      ro(SPL_TOKEN_PROGRAM_ID),
      ro(CLOCK_ID),
   ];
   const fillerAccounts: { address: Address; role: AccountRole }[] = [];
   if (bet.fillers.length === 0 || bet.fillers.length !== bet.numFillers) {
      throw new RangeError(`bet.fillers.length must equal bet.numFillers (${bet.numFillers})`);
   }
   for (const filler of bet.fillers) {
      const row = await settleFillerAccountRow(filler, bet.marketId.eventId, bet.marketId.operator, mint);
      const nettingRole = filler.isPotentiallyNetted ? rw(row[4]!) : ro(row[4]!);
      fillerAccounts.push(ro(row[0]!), ro(row[1]!), rw(row[2]!), rw(row[3]!), nettingRole);
   }
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [...baseAccounts, ...fillerAccounts],
      data: new Uint8Array([SETTLE_BOOSTED_BET_IX_DISCRIMINATOR]),
   };
}

/**
 * **`settle_boosted_parlay`** — normal parlay settle, then the issuer ATA pays the boost top-up.
 */
export async function getSettleBoostedParlayIx(
   signer: Address,
   betPda: Address,
   parlay: ParlayBetAccountData,
   issuerAuth: Address,
): Promise<Instruction> {
   if (parlay.promoType !== PROMO_BOOST) {
      throw new Error('parlay is not a boost ticket');
   }
   const mint = parlay.legs[0]!.marketId.mint;
   validatePositiveU64(parlay.betId, 'parlay.betId');
   if (parlay.result === BetResult.Pending) {
      throw new Error('parlay.result must be not Pending');
   }
   if (parlay.result === BetResult.CashedOut) {
      throw new Error('parlay.result CashedOut is not settleable');
   }
   const user = parlay.owner;
   const betAta = await getAta(betPda, mint);
   const userAta = await getAta(user, mint);
   const [issuerPda] = await getFreebetIssuerPda(issuerAuth);
   const issuerAta = await getAta(issuerPda, mint);
   const boostPda = parlay.promoAccount;
   const [configPda] = await getConfigPda();
   const [mmConfigPda] = await getMmConfigPda(parlay.fillerAddress);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(parlay.fillerAddress, mint);
   const mmLiabilityAta = await getAta(mmEncumbrancePda, mint);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         rs(signer),
         rw(betPda),
         rw(betAta),
         rw(parlay.feepayer),
         ro(user),
         rw(userAta),
         rw(issuerAuth),
         rw(issuerPda),
         rw(issuerAta),
         rw(boostPda),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(CLOCK_ID),
         ro(parlay.fillerAddress),
         ro(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
      ],
      data: new Uint8Array([SETTLE_BOOSTED_PARLAY_IX_DISCRIMINATOR]),
   };
}

/**
 * **`create_netting_account`** — MM admin creates per-event netting PDA under the aggregator for liability netting.
 *
 * **Rust:** `aggregator::instructions::create_netting_account::process` (`CREATE_NETTING_ACCOUNT_IX_DISCRIMINATOR` = 130). Data: `EventId` wire bytes only (after discriminator).
 *
 * @param eventId - **TS:** {@link EventId}. **Rust:** `EventId` decoded from instruction data.
 * @param mmAdmin - **TS:** `Address` — must match MM config admin. **Rust:** `mm_admin` (writable signer).
 * @param mmProgram - **TS:** `Address` — MM program id. **Rust:** `mm_program_account` (executable).
 * @returns **`Promise<Instruction>`** — six accounts (admin, mm program, mm config, netting PDA, rent sysvar, system program).
 */
export async function getCreateNettingAccountIx(
   eventId: EventId,
   operator: Address,
   mint: Address,
   mmAdmin: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [nettingPda] = await getNettingPda(mmProgram, eventId, operator, mint);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(mmAdmin), ro(mmProgram), ro(mmConfigPda), rw(nettingPda), ro(SYSVAR_RENT_ID), ro(SYSTEM_PROGRAM_ID)],
      data: encodeAggregatorInstructionData({ kind: 'createNettingAccount', eventId, operator, mint }),
   };
}

/**
 * **`add_line_to_netting_account`** — MM admin adds `(event_id, period, mkt)` line to an existing netting account.
 *
 * **Rust:** `aggregator::instructions::add_line_to_netting_account::process` (`ADD_LINE_TO_NETTING_ACCOUNT_IX_DISCRIMINATOR` = 131). Payload: `EventId` + `period: u8` + `mkt: u16` (`AddLineToLiabilityNettingIxData`).
 *
 * @param eventId - **TS:** {@link EventId}. **Rust:** `event_id` in parsed ix data.
 * @param period - **TS:** `number` — `u8` market period. **Rust:** `u8` / `period`.
 * @param mkt - **TS:** `number` — `u16` market index. **Rust:** `u16` / `mkt`.
 * @param admin - **TS:** `Address` — MM admin writable signer (pays extra rent if the PDA must grow). **Rust:** `admin` (writable signer).
 * @param mmProgram - **TS:** `Address` — MM program id. **Rust:** `mm_program`.
 * @returns **`Promise<Instruction>`** — six accounts: admin, mm program, mm config, netting PDA, rent sysvar, system program (rent Transfer when the PDA grows).
 */
export async function getAddLineToNettingAccountIx(
   eventId: EventId,
   operator: Address,
   mint: Address,
   period: number,
   mkt: number,
   admin: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   validateU8(period, 'period');
   validateU16(mkt, 'mkt');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [nettingPda] = await getNettingPda(mmProgram, eventId, operator, mint);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(admin), ro(mmProgram), ro(mmConfigPda), rw(nettingPda), ro(SYSVAR_RENT_ID), ro(SYSTEM_PROGRAM_ID)],
      data: encodeAggregatorInstructionData({
         kind: 'addLineToNettingAccount',
         data: { eventId, operator, mint, period, mkt },
      }),
   };
}

/**
 * **`remove_line_from_netting_account`** — MM admin removes a netting line keyed by `(event_id, period, mkt)`.
 *
 * **Rust:** `aggregator::instructions::remove_line_from_netting_account::process` (`REMOVE_LINE_FROM_NETTING_ACCOUNT_IX_DISCRIMINATOR` = 132). Same payload shape as add-line.
 *
 * @param eventId - **TS:** {@link EventId}. **Rust:** `event_id`.
 * @param period - **TS:** `number` — `u8`. **Rust:** `u8`.
 * @param mkt - **TS:** `number` — `u16`. **Rust:** `u16`.
 * @param admin - **TS:** `Address`. **Rust:** `admin` (signer).
 * @param mmProgram - **TS:** `Address`. **Rust:** `mm_program`.
 * @returns **`Promise<Instruction>`** — same four-account layout as add-line.
 */
export async function getRemoveLineFromNettingAccountIx(
   eventId: EventId,
   operator: Address,
   mint: Address,
   period: number,
   mkt: number,
   admin: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   validateU8(period, 'period');
   validateU16(mkt, 'mkt');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [nettingPda] = await getNettingPda(mmProgram, eventId, operator, mint);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [rs(admin), ro(mmProgram), ro(mmConfigPda), rw(nettingPda)],
      data: encodeAggregatorInstructionData({
         kind: 'removeLineFromNettingAccount',
         data: { eventId, operator, mint, period, mkt },
      }),
   };
}

/**
 * **`close_netting_account`** — MM admin closes netting PDA for an event and returns rent (requires `EventId` in data).
 *
 * **Rust:** `aggregator::instructions::close_netting_account::process` (`CLOSE_NETTING_ACCOUNT_IX_DISCRIMINATOR` = 133). Data: `EventId` wire bytes after discriminator.
 *
 * @param eventId - **TS:** {@link EventId}. **Rust:** `EventId` from instruction data.
 * @param admin - **TS:** `Address` — MM admin (writable signer). **Rust:** `admin`.
 * @param mmProgram - **TS:** `Address`. **Rust:** `mm_program`.
 * @returns **`Promise<Instruction>`** — five accounts (admin, mm program, mm config, netting PDA, system program) per on-chain ordering.
 */
export async function getCloseNettingAccountIx(
   eventId: EventId,
   operator: Address,
   mint: Address,
   admin: Address,
   mmProgram: Address,
): Promise<Instruction> {
   validateEventId(eventId, 'eventId');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [nettingPda] = await getNettingPda(mmProgram, eventId, operator, mint);
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(admin), ro(mmProgram), ro(mmConfigPda), rw(nettingPda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeAggregatorInstructionData({ kind: 'closeNettingAccount', eventId, operator, mint }),
   };
}

/**
 * **`withdraw_from_liability_account`** — MM admin pulls free liability vault balance to the MM collateral token account (subject to encumbrance accounting on-chain).
 *
 * **Rust:** `aggregator::instructions::withdraw_from_liability_account::process` (`WITHDRAW_FROM_LIABILITY_ACCOUNT_IX_DISCRIMINATOR` = 150). Data: `amount: u64` (LE) after discriminator.
 *
 * @param amount - **TS:** `bigint` — must fit `u64` and be > 0 where enforced. **Rust:** `u64` read from ix data.
 * @param mmAdmin - **TS:** `Address` — MM admin signer. **Rust:** `mm_admin` (writable signer).
 * @param mmProgram - **TS:** `Address`. **Rust:** `mm_program_account`.
 * @returns **`Promise<Instruction>`** — nine accounts: mm admin, mm program, mm config (readonly), encumbrance, liability ATA, MM token ATA, aggregator config, mint, token program.
 */
export async function getWithdrawFromLiabilityAccountIx(
   amount: bigint,
   mmAdmin: Address,
   mmProgram: Address,
   mint: Address,
): Promise<Instruction> {
   validatePositiveU64(amount, 'amount');
   const [mmConfigPda] = await getMmConfigPda(mmProgram);
   const [mmEncumbrancePda] = await getMmEncumbrancePda(mmProgram, mint);
   const mmLiabilityAta = await getAta(
      mmEncumbrancePda,
      mint,
      SPL_TOKEN_PROGRAM_ID,
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   );
   const mmTokenAta = await getAta(mmConfigPda, mint, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [
         ws(mmAdmin),
         ro(mmProgram),
         ro(mmConfigPda),
         rw(mmEncumbrancePda),
         rw(mmLiabilityAta),
         rw(mmTokenAta),
         ro(configPda),
         ro(mint),
         ro(SPL_TOKEN_PROGRAM_ID),
      ],
      data: encodeAggregatorInstructionData({
         kind: 'withdrawFromLiabilityAccount',
         amount,
      }),
   };
}

/**
 * **`force_close_pda`** — dev-only: admin closes an arbitrary PDA owned by the aggregator program and recovers rent.
 *
 * **Rust:** `aggregator::instructions::force_close_pda::process` (`FORCE_CLOSE_PDA_IX_DISCRIMINATOR` = 255). No instruction data after discriminator.
 *
 * @param admin - **TS:** `Address` — config admin (writable signer). **Rust:** `admin` (writable signer).
 * @param pda - **TS:** `Address` — PDA to close. **Rust:** `pda` (writable).
 * @returns **`Promise<Instruction>`** — four accounts: admin, config PDA (readonly), target PDA, system program. **Note:** production deployments should gate or omit this ix.
 */
export async function getForceClosePdaIx(admin: Address, pda: Address): Promise<Instruction> {
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(admin), ro(configPda), rw(pda), ro(SYSTEM_PROGRAM_ID)],
      data: encodeAggregatorInstructionData({ kind: 'forceClosePda' }),
   };
}

export async function getWriteArbitraryDataIx(admin: Address, account: Address, data: Uint8Array): Promise<Instruction> {
   const [configPda] = await getConfigPda();
   return {
      programAddress: AGGREGATOR_PROGRAM_ID,
      accounts: [ws(admin), ro(configPda), rw(account)],
      data: encodeAggregatorInstructionData({ kind: 'writeArbitraryData', data }),
   };
}

/** Tagged router input: wire-ish fields and addresses in one object per `kind`. */
export type AggregatorInstructionInput =
   | { kind: 'initProgram'; admin: Address }
   | { kind: 'changeConfigStatus'; status: 0 | 1; admin: Address }
   | { kind: 'registerMm'; mmAdmin: Address; mmProgram: Address }
   | { kind: 'deregisterMm'; aggregatorAdmin: Address; mmAdmin: Address; mmProgram: Address; mint: Address }
   | { kind: 'initMmMintVault'; mmAdmin: Address; mmProgram: Address; mint: Address }
   | { kind: 'closeMmMintVault'; mmAdmin: Address; mmProgram: Address; mint: Address }
   | { kind: 'initFreebetIssuer'; auth: Address }
   | { kind: 'removeFreebetIssuer'; auth: Address }
   | { kind: 'createPromoIssuerAta'; auth: Address; mint: Address }
   | { kind: 'closePromoIssuerAta'; auth: Address; mint: Address }
   | { kind: 'withdrawFreebetFunds'; auth: Address; mint: Address; amount: bigint }
   | { kind: 'issueFreebet'; auth: Address; user: Address; data: IssueFreebetIxData; mint: Address }
   | { kind: 'revokeFreebet'; auth: Address; mint: Address; freebetId: number }
   | { kind: 'issueBoost'; auth: Address; user: Address; data: IssueBoostIxData; mint: Address }
   | { kind: 'revokeBoost'; auth: Address; mint: Address; boostId: number }
   | {
        kind: 'fillBet';
        fill: FillBetIxData;
        feepayer: Address;
        user: Address;
        mmPrograms: readonly Address[];
        hasActiveNetting: boolean;
     }
   | {
        kind: 'fillParlay';
        fill: FillParlayIxData;
        feepayer: Address;
        user: Address;
        mmProgram: Address;
     }
   | {
        kind: 'fillRfqBet';
        fill: FillRfqBetIxData;
        feepayer: Address;
        user: Address;
        mmProgram: Address;
        hasActiveNetting: boolean;
     }
   | {
        kind: 'fillRfqParlay';
        fill: FillRfqParlayIxData;
        feepayer: Address;
        user: Address;
        mmProgram: Address;
     }
   | {
        kind: 'freebetFillBet';
        fill: FillBetIxData;
        feepayer: Address;
        user: Address;
        issuerAuth: Address;
        freebetId: number;
        mmPrograms: readonly Address[];
        hasActiveNetting: boolean;
     }
   | {
        kind: 'freebetFillParlay';
        fill: FillParlayIxData;
        feepayer: Address;
        user: Address;
        issuerAuth: Address;
        freebetId: number;
        mmProgram: Address;
     }
   | {
        kind: 'freebetFillRfqBet';
        fill: FillRfqBetIxData;
        feepayer: Address;
        user: Address;
        issuerAuth: Address;
        freebetId: number;
        mmProgram: Address;
        hasActiveNetting: boolean;
     }
   | {
        kind: 'freebetFillRfqParlay';
        fill: FillRfqParlayIxData;
        feepayer: Address;
        user: Address;
        issuerAuth: Address;
        freebetId: number;
        mmProgram: Address;
     }
   | {
        kind: 'boostedFillBet';
        fill: FillBetIxData;
        feepayer: Address;
        user: Address;
        issuerAuth: Address;
        boostId: number;
        mmPrograms: readonly Address[];
        hasActiveNetting: boolean;
     }
   | {
        kind: 'boostedFillParlay';
        fill: FillParlayIxData;
        feepayer: Address;
        user: Address;
        issuerAuth: Address;
        boostId: number;
        mmProgram: Address;
     }
   | {
        kind: 'boostedFillRfqBet';
        fill: FillRfqBetIxData;
        feepayer: Address;
        user: Address;
        issuerAuth: Address;
        boostId: number;
        mmProgram: Address;
        hasActiveNetting: boolean;
     }
   | {
        kind: 'boostedFillRfqParlay';
        fill: FillRfqParlayIxData;
        feepayer: Address;
        user: Address;
        issuerAuth: Address;
        boostId: number;
        mmProgram: Address;
     }
   | {
        kind: 'fillCashout';
        fill: FillCashoutIxData;
        feepayer: Address;
        bet: BetAccountData;
        marketId: MarketId;
        fillingMm: Address;
        mmPrograms: readonly Address[];
     }
   | {
        kind: 'fillParlayCashout';
        fill: FillParlayCashoutIxData;
        feepayer: Address;
        parlay: ParlayBetAccountData;
        marketIds: MarketId[];
        fillingMm: Address;
     }
   | {
        kind: 'fillRfqCashout';
        fill: FillRfqCashoutIxData;
        feepayer: Address;
        bet: BetAccountData;
        marketId: MarketId;
        mmProgram: Address;
     }
   | {
        kind: 'fillRfqParlayCashout';
        fill: FillRfqParlayCashoutIxData;
        feepayer: Address;
        parlay: ParlayBetAccountData;
        marketIds: MarketId[];
        fillingMm: Address;
     }
   | {
        kind: 'claimCashoutEscrow';
        feepayer: Address;
        escrow: CashoutEscrowAccountData;
        ticket: Pick<BetAccountData, 'feepayer'> | Pick<ParlayBetAccountData, 'feepayer'>;
        mint: Address;
     }
   | { kind: 'revertCashout'; feepayer: Address; escrow: CashoutEscrowAccountData; mint: Address }
   | {
        kind: 'getMarketQuotesProxy';
        quote: FillBetIxData;
        user: Address;
        mmPrograms: readonly Address[];
     }
   | {
        kind: 'getQuoteProxy';
        quote: FillBetIxData;
        user: Address;
        mmPrograms: readonly Address[];
     }
   | {
        kind: 'getParlayQuoteProxy';
        quote: FillParlayIxData;
        user: Address;
        mmPrograms: readonly Address[];
     }
   | {
        kind: 'getCashoutQuoteProxy';
        quote: FillCashoutIxData;
        user: Address;
        marketId: MarketId;
        mmPrograms: readonly Address[];
     }
   | {
        kind: 'getParlayCashoutQuoteProxy';
        quote: FillParlayCashoutIxData;
        user: Address;
        origLegs: { marketId: MarketId }[];
        mmPrograms: readonly Address[];
     }
   | {
        kind: 'gradeBets';
        betResults: Uint8Array;
        admin: Address;
        betAccounts: readonly Address[];
     }
   | {
        kind: 'gradeParlay';
        legGradeMask: Uint8Array;
        authority: Address;
        parlayBetAccount: Address;
     }
   | { kind: 'settleBet'; bet: BetAccountData; signer: Address; betPda: Address }
   | { kind: 'settleParlay'; parlay: ParlayBetAccountData; signer: Address; betPda: Address }
   | {
        kind: 'settleCashout';
        cashout: CashoutAccountData;
        signer: Address;
        cashoutPda: Address;
     }
   | {
        kind: 'settleCashoutParlay';
        cashout: CashoutParlayAccountData;
        signer: Address;
        cashoutPda: Address;
     }
   | {
        kind: 'settleFreebet';
        bet: BetAccountData;
        signer: Address;
        betPda: Address;
        issuerAuth: Address;
     }
   | {
        kind: 'settleFreebetParlay';
        parlay: ParlayBetAccountData;
        signer: Address;
        betPda: Address;
        issuerAuth: Address;
     }
   | {
        kind: 'settleBoostedBet';
        bet: BetAccountData;
        signer: Address;
        betPda: Address;
        issuerAuth: Address;
     }
   | {
        kind: 'settleBoostedParlay';
        parlay: ParlayBetAccountData;
        signer: Address;
        betPda: Address;
        issuerAuth: Address;
     }
   | { kind: 'createNettingAccount'; eventId: EventId; operator: Address; mint: Address; mmAdmin: Address; mmProgram: Address }
   | {
        kind: 'addLineToNettingAccount';
        eventId: EventId;
        operator: Address;
        mint: Address;
        period: number;
        mkt: number;
        admin: Address;
        mmProgram: Address;
     }
   | {
        kind: 'removeLineFromNettingAccount';
        eventId: EventId;
        operator: Address;
        mint: Address;
        period: number;
        mkt: number;
        admin: Address;
        mmProgram: Address;
     }
   | { kind: 'closeNettingAccount'; eventId: EventId; operator: Address; mint: Address; admin: Address; mmProgram: Address }
   | { kind: 'withdrawFromLiabilityAccount'; amount: bigint; mmAdmin: Address; mmProgram: Address; mint: Address }
   | { kind: 'writeArbitraryData'; admin: Address; account: Address; data: Uint8Array }
   | { kind: 'forceClosePda'; admin: Address; pda: Address };

export type AggregatorInstructionKind = AggregatorInstructionInput['kind'];

/**
 * Dispatch **aggregator router** instructions by **`input.kind`**, delegating to the typed `get*Ix` builders.
 *
 * **Rust:** Each variant maps to the corresponding `aggregator` router arm in `instructions/mod.rs` (same discriminators as module constants).
 *
 * @param input - **TS:** {@link AggregatorInstructionInput} — discriminated union: `kind` plus the same fields as the matching `get*Ix` function. **Rust:** N/A (client-only helper).
 * @returns **`Promise<Instruction>`** — always `programAddress` = {@link AGGREGATOR_PROGRAM_ID} for router variants. **Note:** does **not** handle MM CPI helpers ({@link getMmGetQuoteIx}, {@link getMmGetCashoutQuoteIx}, etc.).
 */
export async function getInstructionIx(input: AggregatorInstructionInput): Promise<Instruction> {
   switch (input.kind) {
      case 'initProgram':
         return getInitProgramIx(input.admin);
      case 'changeConfigStatus':
         return getChangeConfigStatusIx(input.admin, input.status);
      case 'registerMm':
         return getRegisterMmIx(input.mmAdmin, input.mmProgram);
      case 'deregisterMm':
         return getDeregisterMmIx(input.aggregatorAdmin, input.mmAdmin, input.mmProgram, input.mint);
      case 'initMmMintVault':
         return getInitMmMintVaultIx(input.mmAdmin, input.mmProgram, input.mint);
      case 'closeMmMintVault':
         return getCloseMmMintVaultIx(input.mmAdmin, input.mmProgram, input.mint);
      case 'initFreebetIssuer':
         return getInitFreebetIssuerIx(input.auth);
      case 'removeFreebetIssuer':
         return getRemoveFreebetIssuerIx(input.auth);
      case 'createPromoIssuerAta':
         return getCreatePromoIssuerAtaIx(input.auth, input.mint);
      case 'closePromoIssuerAta':
         return getClosePromoIssuerAtaIx(input.auth, input.mint);
      case 'withdrawFreebetFunds':
         return getWithdrawFreebetFundsIx(input.auth, input.mint, input.amount);
      case 'issueFreebet':
         return getIssueFreebetIx(input.auth, input.user, input.data, input.mint);
      case 'revokeFreebet':
         return getRevokeFreebetIx(input.auth, input.mint, input.freebetId);
      case 'issueBoost':
         return getIssueBoostIx(input.auth, input.user, input.data, input.mint);
      case 'revokeBoost':
         return getRevokeBoostIx(input.auth, input.mint, input.boostId);
      case 'fillBet':
         return getFillBetIx(
            input.fill,
            input.feepayer,
            input.user,
            input.mmPrograms,
            input.hasActiveNetting,
         );
      case 'fillParlay':
         return getFillParlayIx(input.fill, input.feepayer, input.user, input.mmProgram);
      case 'fillRfqBet':
         return getFillRfqBetIx(
            input.fill,
            input.feepayer,
            input.user,
            input.mmProgram,
            input.hasActiveNetting,
         );
      case 'fillRfqParlay':
         return getFillRfqParlayIx(input.fill, input.feepayer, input.user, input.mmProgram);
      case 'freebetFillBet':
         return getFreebetFillBetIx(
            input.fill,
            input.feepayer,
            input.user,
            input.issuerAuth,
            input.freebetId,
            input.mmPrograms,
            input.hasActiveNetting,
         );
      case 'freebetFillParlay':
         return getFreebetFillParlayIx(
            input.fill,
            input.feepayer,
            input.user,
            input.issuerAuth,
            input.freebetId,
            input.mmProgram,
         );
      case 'freebetFillRfqBet':
         return getFreebetFillRfqBetIx(
            input.fill,
            input.feepayer,
            input.user,
            input.issuerAuth,
            input.freebetId,
            input.mmProgram,
            input.hasActiveNetting,
         );
      case 'freebetFillRfqParlay':
         return getFreebetFillRfqParlayIx(
            input.fill,
            input.feepayer,
            input.user,
            input.issuerAuth,
            input.freebetId,
            input.mmProgram,
         );
      case 'boostedFillBet':
         return getBoostedFillBetIx(
            input.fill,
            input.feepayer,
            input.user,
            input.issuerAuth,
            input.boostId,
            input.mmPrograms,
            input.hasActiveNetting,
         );
      case 'boostedFillParlay':
         return getBoostedFillParlayIx(
            input.fill,
            input.feepayer,
            input.user,
            input.issuerAuth,
            input.boostId,
            input.mmProgram,
         );
      case 'boostedFillRfqBet':
         return getBoostedFillRfqBetIx(
            input.fill,
            input.feepayer,
            input.user,
            input.issuerAuth,
            input.boostId,
            input.mmProgram,
            input.hasActiveNetting,
         );
      case 'boostedFillRfqParlay':
         return getBoostedFillRfqParlayIx(
            input.fill,
            input.feepayer,
            input.user,
            input.issuerAuth,
            input.boostId,
            input.mmProgram,
         );
      case 'fillCashout':
         return getFillCashoutIx(
            input.fill,
            input.feepayer,
            input.bet,
            input.marketId,
            input.fillingMm,
            input.mmPrograms,
         );
      case 'fillParlayCashout':
         return getFillParlayCashoutIx(
            input.fill,
            input.feepayer,
            input.parlay,
            input.marketIds,
            input.fillingMm,
         );
      case 'fillRfqCashout':
         return getFillRfqCashoutIx(
            input.fill,
            input.feepayer,
            input.bet,
            input.marketId,
            input.mmProgram,
         );
      case 'fillRfqParlayCashout':
         return getFillRfqParlayCashoutIx(
            input.fill,
            input.feepayer,
            input.parlay,
            input.marketIds,
            input.fillingMm,
         );
      case 'claimCashoutEscrow':
         return getClaimCashoutEscrowIx(input.feepayer, input.escrow, input.ticket, input.mint);
      case 'revertCashout':
         return getRevertCashoutIx(input.feepayer, input.escrow, input.mint);
      case 'getQuoteProxy':
         return getGetQuoteProxyIx(input.quote, input.user, input.mmPrograms);
      case 'getParlayQuoteProxy':
         return getGetParlayQuoteProxyIx(input.quote, input.user, input.mmPrograms);
      case 'getMarketQuotesProxy':
         return getGetMarketQuotesProxyIx(input.quote, input.user, input.mmPrograms);
      case 'getCashoutQuoteProxy':
         return getGetCashoutQuoteProxyIx(input.quote, input.user, input.marketId, input.mmPrograms);
      case 'getParlayCashoutQuoteProxy':
         return getGetParlayCashoutQuoteProxyIx(
            input.quote,
            input.user,
            input.origLegs,
            input.mmPrograms,
         );
      case 'gradeBets':
         return getGradeBetsIx(input.admin, input.betResults, input.betAccounts);
      case 'gradeParlay':
         return getGradeParlayIx(
            input.authority,
            input.legGradeMask,
            input.parlayBetAccount,
         );
      case 'settleBet':
         return getSettleBetIx(input.signer, input.betPda, input.bet);
      case 'settleParlay':
         return getSettleParlayIx(input.signer, input.betPda, input.parlay);
      case 'settleCashout':
         return getSettleCashoutIx(input.signer, input.cashoutPda, input.cashout);
      case 'settleCashoutParlay':
         return getSettleCashoutParlayIx(input.signer, input.cashoutPda, input.cashout);
      case 'settleFreebet':
         return getSettleFreebetIx(input.signer, input.betPda, input.bet, input.issuerAuth);
      case 'settleFreebetParlay':
         return getSettleFreebetParlayIx(input.signer, input.betPda, input.parlay, input.issuerAuth);
      case 'settleBoostedBet':
         return getSettleBoostedBetIx(input.signer, input.betPda, input.bet, input.issuerAuth);
      case 'settleBoostedParlay':
         return getSettleBoostedParlayIx(input.signer, input.betPda, input.parlay, input.issuerAuth);
      case 'createNettingAccount':
         return getCreateNettingAccountIx(input.eventId, input.operator, input.mint, input.mmAdmin, input.mmProgram);
      case 'addLineToNettingAccount':
         return getAddLineToNettingAccountIx(
            input.eventId,
            input.operator,
            input.mint,
            input.period,
            input.mkt,
            input.admin,
            input.mmProgram,
         );
      case 'removeLineFromNettingAccount':
         return getRemoveLineFromNettingAccountIx(
            input.eventId,
            input.operator,
            input.mint,
            input.period,
            input.mkt,
            input.admin,
            input.mmProgram,
         );
      case 'closeNettingAccount':
         return getCloseNettingAccountIx(input.eventId, input.operator, input.mint, input.admin, input.mmProgram);
      case 'withdrawFromLiabilityAccount':
         return getWithdrawFromLiabilityAccountIx(input.amount, input.mmAdmin, input.mmProgram, input.mint);
      case 'writeArbitraryData':
         return getWriteArbitraryDataIx(input.admin, input.account, input.data);
      case 'forceClosePda':
         return getForceClosePdaIx(input.admin, input.pda);
      default: {
         const _exhaustive: never = input;
         throw new Error(`unknown instruction: ${String(_exhaustive)}`);
      }
   }
}
